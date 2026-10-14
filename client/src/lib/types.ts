// Frontend copy of the server's response shapes (server/src/jobs.ts jobView, server/src/schemas.ts).
// Hand-written on purpose so the Next build never imports from the server workspace.

export type Mode = "api" | "chat";
export type Provider = "gemini" | "qwen" | "mistral" | "kimi" | "llama";

/** Display names for the API providers, in the order the pickers list them. */
export const PROVIDER_NAMES: Record<Provider, string> = {
  gemini: "Gemini",
  qwen: "Qwen",
  mistral: "Mistral",
  kimi: "Kimi",
  llama: "Llama",
};
export const PROVIDER_OPTIONS = Object.entries(PROVIDER_NAMES).map(([value, label]) => ({ value: value as Provider, label }));
export type JobStatus = "running" | "awaiting_chat" | "done" | "failed";
export type Role = "A1" | "A2" | "A3" | "A4" | "A5";
export type Severity = "blocking" | "review" | "info";
export type Origin = "source_extracted" | "inferred";

/** What each agent does, in the words users see. Agent codes (A1-A5) stay internal. */
export const ROLE_NAMES: Record<Role, string> = {
  A1: "Read text",
  A2: "Read diagrams",
  A3: "Combine findings",
  A4: "Draw process flow",
  A5: "Check against sources",
};

/** Trace roles in user-facing words ("system" = deterministic code steps). */
export const stepOwner = (role: Role | "system") => (role === "system" ? "Automatic check" : ROLE_NAMES[role]);

export type Issue = {
  code: string;
  severity: Severity;
  message: string;
  element_ids: string[];
  evidence_refs: string[];
};

/**
 * schema: the JSON the pasted reply must match; "A3_PATCH" for the claim audit, "A4_PATCH" for an
 * A4 repair, otherwise the role. step: which pass of the role this is (missing on older saved runs).
 */
export type ChatHandoff = { role: Role; step?: string; schema: Role | "A3_PATCH" | "A4_PATCH"; roleName: string; prompt: string; chars?: number; maxChars?: number; cutChars?: number; attachments: string[] };

export type JobError = { code: string; message: string; retryable: boolean; details?: unknown };

export type TraceEntry = {
  role: Role | "system";
  step: string;
  provider: string;
  model: string | null;
  ms: number;
  ok: boolean;
  note?: string;
  /** What the pass produced, for developers. Missing on runs saved before it was recorded. */
  output?: unknown;
};

export type EvidenceView = {
  id: string;
  /** layout = a table page render A1 used to read columns; not citable evidence. */
  kind: "text" | "image" | "layout";
  source: string;
  page: number | null;
  excerpt?: string;
};

export type A4Graph = {
  title: string;
  lanes: { id: string; name: string; evidence_refs: string[] }[];
  nodes: {
    id: string;
    type: "start" | "end" | "task" | "exclusive_gateway";
    label: string;
    lane_id: string;
    evidence_refs: string[];
    origin: Origin;
  }[];
  edges: {
    id: string;
    source_id: string;
    target_id: string;
    label: string | null;
    evidence_refs: string[];
    origin: Origin;
  }[];
  annotations: { id: string; text: string; attached_element_id: string | null; evidence_refs: string[] }[];
  issues: Issue[];
};

export type RefineChange = {
  type: "merged" | "linked" | "relabelled" | "actor_merged" | "flagged" | "dropped" | "added" | "retyped";
  upstream_ids: string[];
  result_id: string | null;
  reason: string;
};

export type JobView = {
  id: string;
  mode: Mode;
  provider: Provider;
  /** Uploaded file names, plus "Pasted text". Missing on runs saved before history existed. */
  sources?: string[];
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  /** A saved run from an earlier server session: viewable, but it cannot be resumed or switched. */
  archived: boolean;
  pending: ChatHandoff | null;
  error: JobError | null;
  /** Issues a reviewer marked complete: index into result.issues → when. Missing on older runs. */
  resolved?: Record<string, string>;
  progress: {
    /** Graph nodes queued next (the running, interrupted or failed one), e.g. ["a3_refine"]. */
    next: string[];
    /** Graph node → ISO time it started, for nodes running or paused for chat now. Missing on older saved runs. */
    runningSince?: Record<string, string>;
    repairCount: number;
    maxRepairs: number;
    requestCount: number;
    maxRequests: number;
    /** Optional passes the server runs: focused text readers, claim audit. Missing on older saved runs. */
    passes?: { lenses: boolean; audit: boolean };
  };
  trace: TraceEntry[];
  evidence: EvidenceView[];
  // Stage outputs are only inspected for presence here, so they stay loosely typed.
  stages: { a1: unknown; a2: unknown; a3: unknown; a4: A4Graph | null; a5: unknown };
  result: {
    graph: A4Graph | null;
    issues: Issue[];
    changes: RefineChange[];
    bpmnXml: string | null;
    /** The BPMN was built despite blocking structure errors, for the analyst to fix in the editor. */
    draft?: boolean;
  } | null;
};

/** One row of GET /v1/jobs (server/src/runs.ts RunSummary). */
export type RunSummary = {
  id: string;
  title: string | null;
  sources: string[];
  status: JobStatus;
  mode: Mode;
  provider: Provider;
  createdAt: string;
  updatedAt: string;
  /** Open issues per severity; resolved = marked complete (missing on older servers). */
  issues: { blocking: number; review: number; info: number; resolved?: number } | null;
  hasBpmn: boolean;
  draft?: boolean;
  archived: boolean;
};

export type Health = { ok: boolean; provider: Provider };
