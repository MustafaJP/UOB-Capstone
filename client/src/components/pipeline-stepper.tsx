"use client";

import {
  ArrowRightIcon,
  CheckIcon,
  FileCode2Icon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  MergeIcon,
  MessageSquareTextIcon,
  MinusIcon,
  RepeatIcon,
  ShieldCheckIcon,
  TimerIcon,
  TriangleAlertIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import { formatStepTime, useNow } from "@/components/elapsed-time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ROLE_NAMES, type JobView, type Role } from "@/lib/types";

type StepState = "done" | "active" | "waiting" | "failed" | "skipped" | "blocked" | "pending";
/** One pass inside a step, e.g. the decisions pass of "Read text". detail: its result in a few words. */
type SubStep = { label: string; state: StepState; detail?: string };
/** time: total time spent in the step so far (finished runs plus the one running now). */
type Step = { key: Role | "BPMN"; title: string; state: StepState; caption: string; time?: string; substeps?: SubStep[] };

type Trace = JobView["trace"][number];
type Passes = NonNullable<JobView["progress"]["passes"]>;

/**
 * The passes inside "Read text" (step 0) and "Combine findings" (step 2), in the order they run.
 * nodes: the server graph nodes behind the pass. expect: whether this server runs it (shown as
 * pending until it does); older saved runs carry no pass settings, so only what ran is shown.
 */
const SUBSTEPS: {
  step: number;
  label: string;
  nodes: string[];
  match: (t: Trace) => boolean;
  expect: (p: Passes, hasText: boolean) => boolean;
  detail?: (ts: Trace[]) => string | undefined;
}[] = [
  { step: 0, label: "Steps", nodes: ["a1_text_extract"], match: (t) => t.step === "extract text", expect: (_, text) => text, detail: (ts) => found(ts) },
  { step: 0, label: "Decisions", nodes: ["a1_decisions"], match: (t) => t.step === "extract decisions", expect: (p, text) => text && p.lenses, detail: (ts) => found(ts) },
  { step: 0, label: "Owners", nodes: ["a1_actors"], match: (t) => t.step === "extract actors", expect: (p, text) => text && p.lenses, detail: (ts) => actorsFound(ts) },
  { step: 0, label: "Coverage", nodes: ["coverage_check", "a1_gap_fill"], match: (t) => t.step === "coverage check" || t.step === "fill coverage gaps", expect: (_, text) => text, detail: coverageDetail },
  { step: 2, label: "Merge", nodes: ["a3_refine"], match: (t) => t.step === "refine extraction", expect: () => true, detail: (ts) => (ts[0]?.note?.startsWith("skipped") ? "nothing to merge" : undefined) },
  { step: 2, label: "Audit against sources", nodes: ["a3_audit"], match: (t) => t.step === "audit claims", expect: (p) => p.audit, detail: auditDetail },
  { step: 2, label: "Nothing lost", nodes: ["check_refine"], match: (t) => t.step === "check refine", expect: () => true, detail: (ts) => (ts[0] && !ts[0].ok ? "problems found" : undefined) },
];

const found = (ts: Trace[]) => {
  const n = /(\d+) claims/.exec(ts[0]?.note ?? "")?.[1];
  return n ? `${n} found` : undefined;
};
const actorsFound = (ts: Trace[]) => {
  const n = /(\d+) actors/.exec(ts[0]?.note ?? "")?.[1];
  return n ? `${n} roles` : undefined;
};
function coverageDetail(ts: Trace[]): string | undefined {
  const check = ts.find((t) => t.step === "coverage check")?.note ?? "";
  if (/all procedure text cited/.test(check)) return "all text used";
  const uncited = /^(\d+) of \d+ text blocks uncited/.exec(check)?.[1];
  const recovered = /(\d+) of (\d+) gaps now cited/.exec(ts.find((t) => t.step === "fill coverage gaps")?.note ?? "");
  if (recovered) return `re-read ${recovered[2]} missed, ${recovered[1]} recovered`;
  return uncited ? `${uncited} missed, re-reading` : undefined;
}
function auditDetail(ts: Trace[]): string | undefined {
  const m = /audit: (\d+) added, (\d+) updated, (\d+) removed/.exec(ts[0]?.note ?? "");
  if (!m) return undefined;
  const parts = [m[1] !== "0" && `${m[1]} added`, m[2] !== "0" && `${m[2]} fixed`, m[3] !== "0" && `${m[3]} removed`].filter(Boolean);
  return parts.length ? parts.join(", ") : "no fixes";
}

/** The passes of one step and how far each got, from the trace and the nodes queued now. */
function subSteps(job: JobView, step: number, current: number): SubStep[] | undefined {
  const { next, passes } = job.progress;
  const hasText = job.evidence.some((e) => e.kind === "text");
  const live = job.status !== "done";
  const queuedState: StepState = job.status === "awaiting_chat" ? "waiting" : job.status === "failed" ? "failed" : "active";
  const subs = SUBSTEPS.filter((s) => s.step === step).flatMap((s): SubStep[] => {
    const ran = job.trace.filter(s.match);
    const queued = live && s.nodes.some((n) => next.includes(n));
    // Not run, not queued: still to come if this server runs it and the job has not moved past it.
    if (!ran.length && !queued && !(live && passes && s.expect(passes, hasText) && current <= step)) return [];
    const state: StepState = queued ? queuedState : ran.length ? "done" : "pending";
    return [{ label: s.label, state, detail: state === "done" || queued ? s.detail?.(ran) : undefined }];
  });
  return subs.length ? subs : undefined;
}

const ROLES: Role[] = ["A1", "A2", "A3", "A4", "A5"];

// Server graph node → step index (A1..A5, then 5 = validate + compile BPMN).
const NODE_STEP: Record<string, number> = {
  a1_text_extract: 0,
  a1_decisions: 0,
  a1_actors: 0,
  coverage_check: 0,
  a1_gap_fill: 0,
  a2_diagram_interpret: 1,
  a3_refine: 2,
  a3_audit: 2,
  check_refine: 2,
  a4_compose: 3,
  a5_critique: 4,
  validate: 5,
  compile_bpmn: 5,
};

// Trace entry → step index. Agent entries map by role; code steps by name (normalize has no step).
const TRACE_STEP: Record<string, number> = { A1: 0, A2: 1, A3: 2, A4: 3, A5: 4, "coverage check": 0, "check refine": 2, validate: 5, "compile bpmn": 5 };
const traceStep = (t: JobView["trace"][number]) => TRACE_STEP[t.role === "system" ? t.step : t.role];

const CAPTION: Record<StepState, string> = {
  done: "Done",
  active: "Running",
  waiting: "Needs chat result",
  failed: "Failed",
  skipped: "Skipped",
  blocked: "Not compiled",
  pending: "Pending",
};

/** Builds the six steps from the server's checkpoint: which outputs exist and which node runs next. */
function buildSteps(job: JobView, now: number): Step[] {
  const { next, repairCount, maxRepairs } = job.progress;
  const nextNode = next[0];
  const current = nextNode != null && job.status !== "done" ? NODE_STEP[nextNode] ?? -1 : -1;
  const outputs = ROLES.map((r) => job.stages[r.toLowerCase() as keyof JobView["stages"]] != null);

  const steps: Step[] = ROLES.map((role, i) => {
    // No output and the graph has already moved past it (or finished): that agent was routed out.
    const state: StepState = outputs[i] ? "done" : (current >= 0 && i < current) || job.status === "done" ? "skipped" : "pending";
    return { key: role, title: ROLE_NAMES[role], state, caption: CAPTION[state] };
  });
  // Read text and Combine findings run several passes: list them, and a step is only done once all are.
  for (const i of [0, 2]) {
    const substeps = subSteps(job, i, current);
    if (!substeps) continue;
    const unfinished = substeps.some((s) => s.state !== "done");
    steps[i] = { ...steps[i], substeps, ...(unfinished && steps[i].state === "done" ? { state: "pending", caption: CAPTION.pending } : {}) };
  }
  // Once the sources are read, the server routes past a reader with nothing to read: say so straight away.
  if (job.evidence.length) {
    const kinds = new Set(job.evidence.map((e) => e.kind));
    if (!kinds.has("text") && !outputs[0]) steps[0] = { ...steps[0], state: "skipped", caption: "Not needed · no text" };
    if (!kinds.has("image") && !outputs[1]) steps[1] = { ...steps[1], state: "skipped", caption: "Not needed · no diagrams" };
  }
  const bpmnState: StepState =
    job.status === "done" ? (job.result?.bpmnXml && !job.result.draft ? "done" : "blocked") : "pending";
  const bpmnCaption = bpmnState === "blocked" && job.result?.draft ? "Draft · fix in editor" : CAPTION[bpmnState];
  steps.push({ key: "BPMN", title: "Validate & export", state: bpmnState, caption: bpmnCaption });

  if (current >= 0) {
    const state: StepState =
      job.status === "awaiting_chat" ? "waiting" : job.status === "failed" ? "failed" : "active";
    let caption = CAPTION[state];
    if (state === "active") {
      // A4 queued while a critique exists = repair; A5 after a repair = re-review.
      if (nextNode === "a4_compose" && job.stages.a5 != null) caption = `Fix ${repairCount + 1} of ${maxRepairs}`;
      else if (nextNode === "a5_critique" && repairCount > 0) caption = `Re-checking after fix ${repairCount}`;
      else if (nextNode === "check_refine") caption = "Checking nothing was lost";
      else if (nextNode === "validate") caption = "Validating graph";
      else if (nextNode === "compile_bpmn") caption = "Building BPMN";
    }
    steps[current] = { ...steps[current], state, caption };
    // A1 and A2 can run in parallel: mark the other queued agents too.
    for (const node of next.slice(1)) {
      const i = NODE_STEP[node];
      if (i != null && i !== current && steps[i].state !== "done") steps[i] = { ...steps[i], state, caption: CAPTION[state] };
    }
  }

  // Time per step: finished runs from the trace, plus how long the running node has been going.
  const spent = steps.map(() => 0);
  const seen = steps.map(() => false);
  for (const t of job.trace) {
    const i = traceStep(t);
    if (i == null) continue;
    spent[i] += t.ms;
    seen[i] = true;
  }
  for (const [node, since] of Object.entries(job.progress.runningSince ?? {})) {
    const i = NODE_STEP[node];
    if (i == null) continue;
    spent[i] += Math.max(0, now - Date.parse(since));
    seen[i] = true;
  }
  return steps.map((step, i) => (seen[i] && step.state !== "skipped" ? { ...step, time: formatStepTime(spent[i]) } : step));
}

const ICON: Record<StepState, React.ReactNode> = {
  done: <CheckIcon />,
  active: <Loader2Icon className="animate-spin" />,
  waiting: <MessageSquareTextIcon />,
  failed: <XIcon />,
  skipped: <MinusIcon />,
  blocked: <TriangleAlertIcon />,
  pending: null,
};

const CIRCLE: Record<StepState, string> = {
  done: "bg-primary text-primary-foreground border-primary",
  active: "border-blue-500 text-blue-600 dark:text-blue-400",
  waiting: "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  failed: "border-destructive bg-destructive/10 text-destructive",
  skipped: "border-dashed text-muted-foreground",
  blocked: "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  pending: "text-muted-foreground",
};

// Each step's idle icon, so the stepper never needs the internal agent codes.
const STEP_ICON: Record<Step["key"], React.ReactNode> = {
  A1: <FileTextIcon />,
  A2: <ImageIcon />,
  A3: <MergeIcon />,
  A4: <WorkflowIcon />,
  A5: <ShieldCheckIcon />,
  BPMN: <FileCode2Icon />,
};

function StepCircle({ step, className }: { step: Step; className?: string }) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-background [&_svg]:size-4",
        CIRCLE[step.state],
        className,
      )}
    >
      {ICON[step.state] ?? STEP_ICON[step.key]}
    </span>
  );
}

const captionClass = (step: Step) =>
  cn("text-[11px]", step.state === "active" ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground");

function StepItem({ step }: { step: Step }) {
  return (
    <li className="relative flex flex-col items-center gap-1.5 self-start text-center">
      <span aria-hidden className="absolute top-4 right-1/2 h-px w-full -translate-y-1/2 bg-border" />
      <StepCircle step={step} />
      <span className="text-xs font-medium">{step.title}</span>
      <span className={captionClass(step)}>{step.caption}</span>
      <StepTime step={step} />
      <SubStepList substeps={step.substeps} />
    </li>
  );
}

const DOT: Record<StepState, string> = {
  done: "bg-primary",
  active: "bg-blue-500 animate-pulse",
  waiting: "bg-amber-500",
  failed: "bg-destructive",
  skipped: "border border-dashed border-muted-foreground",
  blocked: "bg-amber-500",
  pending: "bg-muted-foreground/30",
};

/** The passes inside a step, one line each: a state dot, the pass and its result. */
function SubStepList({ substeps }: { substeps?: SubStep[] }) {
  if (!substeps?.length) return null;
  return (
    <ul className="mt-0.5 flex flex-col gap-0.5 text-left text-[11px]">
      {substeps.map((s) => (
        <li key={s.label} className="flex items-baseline gap-1.5">
          <span aria-hidden className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", DOT[s.state])} />
          <span className={cn(s.state === "pending" ? "text-muted-foreground" : s.state === "active" && "text-blue-600 dark:text-blue-400")}>
            {s.label}
            {s.detail && <span className="text-muted-foreground"> · {s.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StepTime({ step }: { step: Step }) {
  if (!step.time) return null;
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
      <TimerIcon className="size-3" />
      {step.time}
    </span>
  );
}

/** Reading text and reading diagrams run side by side, so they share the first column. */
function ReadColumn({ steps }: { steps: Step[] }) {
  return (
    <li className="relative z-10 flex flex-col gap-2 rounded-lg border border-dashed bg-background p-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase">Read sources</span>
      {steps.map((step) => (
        <div key={step.key} className="flex items-start gap-2 text-left">
          <StepCircle step={step} className="size-7" />
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-medium">{step.title}</span>
            <span className={captionClass(step)}>
              {step.caption}
              {step.time && <span className="text-muted-foreground tabular-nums"> · {step.time}</span>}
            </span>
            <SubStepList substeps={step.substeps} />
          </div>
        </div>
      ))}
    </li>
  );
}

type LoopEvent = { label: string; detail?: string; time?: string; tone: "ok" | "warn" | "running" | "neutral" };

/** The draw / check / fix history (agents A4 and A5), from the trace plus what is running now. */
function loopEvents(job: JobView, now: number): LoopEvent[] {
  const events: LoopEvent[] = [];
  let repairs = 0;
  for (const t of job.trace) {
    if (t.role === "A4") {
      const isRepair = t.step === "repair graph";
      if (isRepair) repairs++;
      // Repair notes carry the patch size, e.g. "patch: 2 added, 1 updated, 0 removed".
      const patch = /patch: ([^;]+)/.exec(t.note ?? "")?.[1];
      events.push({ label: isRepair ? `Fix ${repairs}` : "Draw", detail: patch, time: formatStepTime(t.ms), tone: "neutral" });
      if (t.note?.includes("re-review skipped")) {
        events.push({ label: "Re-check", detail: "skipped after final fix", tone: "neutral" });
      }
    } else if (t.role === "A5") {
      const toFix = /(\d+) findings to fix/.exec(t.note ?? "")?.[1];
      events.push({
        label: t.step === "re-review" ? "Re-check" : "Check",
        detail: toFix ? `${toFix} to fix` : t.note?.includes("no fixes needed") ? "passed" : undefined,
        time: formatStepTime(t.ms),
        tone: toFix ? "warn" : "ok",
      });
    }
  }
  const nextNode = job.progress.next[0];
  if (job.status !== "done" && (nextNode === "a4_compose" || nextNode === "a5_critique")) {
    const repairing = nextNode === "a4_compose" && job.stages.a5 != null;
    const since = job.progress.runningSince?.[nextNode];
    events.push({
      label:
        nextNode === "a4_compose"
          ? repairing
            ? `Fix ${job.progress.repairCount + 1}`
            : "Draw"
          : job.progress.repairCount > 0
            ? "Re-check"
            : "Check",
      detail: job.status === "awaiting_chat" ? "waiting for chat" : job.status === "failed" ? "failed" : "running",
      time: since ? formatStepTime(Math.max(0, now - Date.parse(since))) : undefined,
      tone: job.status === "running" ? "running" : "warn",
    });
  }
  return events;
}

const TONE: Record<LoopEvent["tone"], string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  running: "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300 animate-pulse",
  neutral: "border-border bg-muted/50",
};

function RepairLoop({ job, now }: { job: JobView; now: number }) {
  const events = loopEvents(job, now);
  if (!events.length) return null;
  const { repairCount, maxRepairs } = job.progress;
  const lastReview = [...job.trace].reverse().find((t) => t.role === "A5");
  const lastLoopStep = [...job.trace].reverse().find((t) => t.role === "A4" || t.role === "A5");
  const lastNeedsFix = /findings to fix/.test(lastReview?.note ?? "");
  const finalUnreviewed = lastLoopStep?.role === "A4" && !!lastLoopStep.note?.includes("re-review skipped");
  const pastLoop = job.status === "done" || ["validate", "compile_bpmn"].includes(job.progress.next[0] ?? "");

  let outcome: React.ReactNode = null;
  if (pastLoop && finalUnreviewed) {
    outcome =
      "Fix limit reached. The final fix was not re-checked, so the problems it targeted are listed in the Issues tab as \"not re-checked\".";
  } else if (pastLoop && lastReview) {
    outcome = lastNeedsFix
      ? "The fix limit or model request budget ran out before another fix. The remaining problems are listed in the Issues tab."
      : "The check found nothing that needs fixing.";
  }
  if (outcome && job.result?.draft) {
    outcome = `${outcome} The diagram still has structure errors, so it was built as a draft: open the diagram and fix the highlighted elements.`;
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <RepeatIcon className="size-4 text-muted-foreground" />
          Draw, check and fix loop
        </div>
        <Badge variant="outline" className="tabular-nums">
          Fixes used {repairCount} of {maxRepairs}
        </Badge>
      </div>
      <ol className="flex flex-wrap items-center gap-1.5">
        {events.map((e, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <ArrowRightIcon className="size-3.5 text-muted-foreground" />}
            <span className={cn("rounded-md border px-2 py-1 text-xs font-medium", TONE[e.tone])}>
              {e.label}
              {e.detail && <span className="font-normal opacity-80"> · {e.detail}</span>}
              {e.time && <span className="font-normal tabular-nums opacity-60"> · {e.time}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {outcome ??
          `The drawn flow is checked against the source documents and for valid BPMN structure (start and end events, connected flows). Any problem that needs review sends it back to be fixed, up to ${maxRepairs} times, and only the fixed parts are checked again. The final fix is not re-checked, and info-only notes never trigger a fix.`}
      </p>
    </div>
  );
}

export function PipelineStepper({ job }: { job: JobView }) {
  const live = !job.archived && (job.status === "running" || job.status === "awaiting_chat");
  const now = useNow(live);
  const steps = buildSteps(job, now);
  const reading = job.status === "running" && (job.progress.next.length === 0 || job.progress.next[0] === "normalize");
  return (
    <div className="flex flex-col gap-4">
      {reading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Reading sources and building evidence…
        </p>
      )}
      <ol className="grid grid-cols-5 gap-2">
        <ReadColumn steps={steps.slice(0, 2)} />
        {steps.slice(2).map((step) => (
          <StepItem key={step.key} step={step} />
        ))}
      </ol>
      <RepairLoop job={job} now={now} />
    </div>
  );
}
