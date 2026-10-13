import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Saved runs: each job's view is written to RUNS_DIR/<id>.json whenever it settles
 * (done, failed or paused for chat), so past results survive a server restart.
 * A saved run is a read-only snapshot: the LangGraph checkpoint itself stays in memory.
 */
const RUNS_DIR = process.env.RUNS_DIR
  ? path.resolve(process.env.RUNS_DIR)
  : fileURLToPath(new URL("../runs/", import.meta.url));

// Job IDs are UUIDs; anything else must never reach the filesystem.
const SAFE_ID = /^[0-9a-f-]{36}$/i;
const fileFor = (id: string) => (SAFE_ID.test(id) ? path.join(RUNS_DIR, `${id}.json`) : null);

export type SavedRun = Record<string, any> & { id: string; createdAt: string; updatedAt: string };

/** One row of the run history list. */
export type RunSummary = {
  id: string;
  title: string | null;
  sources: string[];
  status: string;
  mode: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
  issues: { blocking: number; review: number; info: number } | null;
  hasBpmn: boolean;
  draft: boolean; // the BPMN was built despite blocking structure errors
  archived: boolean;
};

export async function saveRun(view: SavedRun): Promise<void> {
  const file = fileFor(view.id);
  if (!file) return;
  await mkdir(RUNS_DIR, { recursive: true });
  // Write then rename would be safer, but one process writes each run, so a plain write is enough.
  await writeFile(file, JSON.stringify(view), "utf8");
}

export async function loadRun(id: string): Promise<SavedRun | null> {
  const file = fileFor(id);
  if (!file) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as SavedRun;
  } catch {
    return null;
  }
}

export async function deleteRun(id: string): Promise<boolean> {
  const file = fileFor(id);
  if (!file) return false;
  try {
    await rm(file);
    return true;
  } catch {
    return false;
  }
}

export async function listSavedRuns(): Promise<SavedRun[]> {
  let names: string[];
  try {
    names = await readdir(RUNS_DIR);
  } catch {
    return [];
  }
  const runs = await Promise.all(
    names.filter((n) => n.endsWith(".json")).map((n) => loadRun(n.slice(0, -".json".length))),
  );
  return runs.filter((r): r is SavedRun => r !== null);
}

export function summarize(view: SavedRun, archived: boolean): RunSummary {
  const issues: { severity: string }[] | undefined = view.result?.issues;
  const count = (s: string) => issues?.filter((i) => i.severity === s).length ?? 0;
  return {
    id: view.id,
    title: view.result?.graph?.title ?? view.stages?.a4?.title ?? null,
    sources: view.sources ?? [],
    status: view.status,
    mode: view.mode,
    provider: view.provider,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    issues: issues ? { blocking: count("blocking"), review: count("review"), info: count("info") } : null,
    hasBpmn: !!view.result?.bpmnXml,
    draft: !!view.result?.draft,
    archived,
  };
}
