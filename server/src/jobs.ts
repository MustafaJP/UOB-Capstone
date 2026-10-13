import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { AppError, parseRoleOutput } from "./agents.js";
import type { JobInput } from "./evidence.js";
import { clearRunning, graph, MAX_REPAIRS, MAX_REQUESTS, mergedA1, PASSES, runningSince, type ChatHandoff } from "./graph.js";
import type { Provider } from "./llm.js";
import { deleteRun, listSavedRuns, loadRun, saveRun, summarize, type RunSummary, type SavedRun } from "./runs.js";

export type Mode = "api" | "chat";
export type JobStatus = "running" | "awaiting_chat" | "done" | "failed";

export type Job = {
  id: string;
  mode: Mode;
  provider: Provider;
  sources: string[]; // uploaded file names, plus "Pasted text"; shown in the run history
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  pending: ChatHandoff | null;
  error: { code: string; message: string; retryable: boolean; details?: unknown } | null;
};

// In-memory job store (FSD uses Postgres; enough for a single-process demo).
const jobs = new Map<string, Job>();
const cfg = (id: string) => ({ configurable: { thread_id: id } });

export function getJob(id: string): Job {
  const job = jobs.get(id);
  if (!job) throw new AppError("JOB_NOT_FOUND", `No job ${id}`);
  return job;
}

async function advance(job: Job, input: unknown): Promise<void> {
  job.status = "running";
  job.error = null;
  job.updatedAt = new Date().toISOString();
  try {
    await graph.invoke(input as never, cfg(job.id));
    const snap = await graph.getState(cfg(job.id));
    const interrupts = snap.tasks.flatMap((t) => t.interrupts ?? []);
    job.pending = interrupts.length ? (interrupts[0].value as ChatHandoff) : null;
    job.status = job.pending ? "awaiting_chat" : "done";
  } catch (e) {
    const err = e instanceof AppError ? e : new AppError("INTERNAL", (e as Error).message ?? String(e));
    clearRunning(job.id);
    job.status = "failed";
    job.error = { code: err.code, message: err.message, retryable: err.retryable, details: err.details };
  }
  job.updatedAt = new Date().toISOString();
  await persist(job);
}

/** Save the settled job so it can still be shown after a restart. A failed save never fails the job. */
async function persist(job: Job): Promise<void> {
  try {
    await saveRun(await jobView(job));
  } catch (e) {
    console.error(`Could not save run ${job.id}:`, (e as Error).message);
  }
}

/** Start a job. Returns the job immediately plus a promise that settles when it pauses or ends. */
export function createJob(input: JobInput, mode: Mode, provider: Provider): { job: Job; done: Promise<void> } {
  const now = new Date().toISOString();
  const sources = [...(input.files ?? []).map((f) => f.name), ...(input.text?.trim() ? ["Pasted text"] : [])];
  const job: Job = { id: randomUUID(), mode, provider, sources, status: "running", createdAt: now, updatedAt: now, pending: null, error: null };
  jobs.set(job.id, job);
  const done = advance(job, { input, mode, provider });
  return { job, done };
}

/** Copilot Chat fallback: validate the pasted JSON before the graph is allowed to continue (FSD F23/F24). */
export function resumeJob(job: Job, raw: string): Promise<void> {
  if (job.status !== "awaiting_chat" || !job.pending) {
    throw new AppError("PACKET_STALE", "This job is not waiting for a chat result", false);
  }
  const parsed = parseRoleOutput(job.pending.schema, raw, true);
  if (!parsed.ok) {
    throw new AppError("CHAT_RESULT_INVALID", `The pasted ${job.pending.role} response failed validation`, false, parsed.errors);
  }
  job.pending = null;
  return advance(job, new Command({ resume: parsed.value }));
}

/**
 * Switch a failed or paused job between API and Copilot Chat (simple FSD F21).
 * Completed agent outputs are kept; only unfinished work runs on the new route.
 */
export function switchMode(job: Job, mode: Mode, provider?: Provider): Promise<void> {
  if (job.status === "running" || job.status === "done") {
    throw new AppError("MODE_SWITCH_NOT_ALLOWED", `Cannot switch mode while the job is ${job.status}`);
  }
  if (job.status === "awaiting_chat" && mode === "chat") throw new AppError("MODE_SWITCH_NOT_ALLOWED", "Job is already in chat mode");
  job.mode = mode;
  if (provider) job.provider = provider;
  job.pending = null;
  job.status = "running";
  clearRunning(job.id);
  // Re-runs the unfinished node from the last checkpoint on the new route.
  return graph.updateState(cfg(job.id), { mode, provider: job.provider }).then(() => advance(job, null));
}

/** Everything the frontend needs, minus raw image bytes. */
export async function jobView(job: Job) {
  const snap = await graph.getState(cfg(job.id));
  const v = snap.values as Record<string, any>;
  return {
    ...job,
    archived: false, // true only for saved runs read back from disk (see viewFor)
    // next = graph nodes queued to run (or interrupted/failed), straight from the checkpoint.
    progress: {
      next: [...snap.next],
      runningSince: runningSince(job.id), // graph node → when it started, for the live step timer
      repairCount: v.repairCount ?? 0,
      maxRepairs: MAX_REPAIRS,
      requestCount: v.requestCount ?? 0,
      maxRequests: MAX_REQUESTS,
      passes: PASSES, // optional passes this server runs (focused readers, claim audit)
    },
    trace: v.trace ?? [],
    evidence: (v.evidence ?? []).map((e: any) => ({
      id: e.id,
      kind: e.kind,
      source: e.source,
      page: e.page,
      excerpt: e.kind === "text" ? e.text.slice(0, 300) : undefined,
    })).concat(
      (v.layouts ?? []).map((l: any) => ({
        id: l.id,
        kind: "layout",
        source: l.source,
        page: l.page,
        excerpt: "Page render shown to A1 to read table columns. Not evidence; claims cite this page's E blocks.",
      })),
    ),
    // a1: every text pass (steps, decisions, actors, coverage gaps) as one extraction.
    stages: { a1: mergedA1(v as never), a2: v.a2 ?? null, a3: v.refined ?? null, a4: v.candidate ?? null, a5: v.critique ?? null },
    result:
      job.status === "done"
        ? { graph: v.candidate ?? null, issues: v.issues ?? v.stageIssues ?? [], changes: v.refined?.changes ?? [], bpmnXml: v.bpmnXml ?? null, draft: v.bpmnDraft ?? false }
        : null,
  };
}

/**
 * A live job's view, or the saved snapshot of a past run (from before a restart).
 * Saved runs come back with archived: true; they can be viewed but not resumed or switched.
 */
export async function viewFor(id: string): Promise<SavedRun> {
  const job = jobs.get(id);
  if (job) return jobView(job);
  const saved = await loadRun(id);
  if (!saved) throw new AppError("JOB_NOT_FOUND", `No job ${id}`);
  // The checkpoint is gone, so a saved chat handoff can no longer be answered.
  return { ...saved, archived: true, pending: null };
}

/** Run history, newest first: live jobs plus saved runs from earlier server sessions. */
export async function listRuns(): Promise<RunSummary[]> {
  const live = await Promise.all([...jobs.values()].map(async (j) => summarize(await jobView(j), false)));
  const liveIds = new Set(live.map((r) => r.id));
  const saved = (await listSavedRuns()).filter((r) => !liveIds.has(r.id)).map((r) => summarize(r, true));
  return [...live, ...saved].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Remove a run from history. A running job cannot be deleted. */
export async function removeRun(id: string): Promise<void> {
  const job = jobs.get(id);
  if (job?.status === "running") throw new AppError("RUN_BUSY", "Cannot delete a job while it is running");
  const deleted = await deleteRun(id);
  if (!job && !deleted) throw new AppError("JOB_NOT_FOUND", `No job ${id}`);
  jobs.delete(id);
}

export async function bpmnFor(id: string): Promise<string | null> {
  const job = jobs.get(id);
  if (!job) return (await loadRun(id))?.result?.bpmnXml ?? null;
  const v = (await graph.getState(cfg(job.id))).values as Record<string, any>;
  return v.bpmnXml ?? null;
}
