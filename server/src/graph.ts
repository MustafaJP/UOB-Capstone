import { Annotation, END, MemorySaver, START, StateGraph, interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { AppError, callAgent } from "./agents.js";
import { compileBpmn } from "./bpmn.js";
import { normalize, type JobInput, type LayoutView } from "./evidence.js";
import type { Provider } from "./llm.js";
import { applyClaimPatch, applyPatch } from "./patch.js";
import { attachmentLabel, buildChatPacket, buildPrompt, type PromptInputs, type PromptMode } from "./prompts.js";
import type { A1Output, A2Output, A3Output, A3Refined, A4Graph, A5Critique, Evidence, Finding, Issue, OutputKind, Role, TraceEntry } from "./schemas.js";
import { OUTPUT_SCHEMAS, ROLE_NAMES } from "./schemas.js";
import { checkRefine, draftable, isStructural, placeEvents, structuralFindings, validateGraph } from "./validate.js";

export const MAX_REQUESTS = 24; // per job: includes format corrections and the repair pass
export const MAX_REPAIRS = 2;
// Accuracy passes before the graph is drawn. Each costs model requests, so either can be turned
// off in .env (e.g. on a small daily quota, or to compare runs with and without it).
// EXTRACT_LENSES: the decisions and actors passes beside A1 (2 requests, plus A3 on text-only input).
// CLAIM_AUDIT: A3 checks the merged claims against the source and patches them (1 request).
const EXTRACT_LENSES = process.env.EXTRACT_LENSES !== "off";
const CLAIM_AUDIT = process.env.CLAIM_AUDIT !== "off";
/** Which optional passes this server runs, so the UI can show the steps still to come. */
export const PASSES = { lenses: EXTRACT_LENSES, audit: CLAIM_AUDIT };

const last = <T>() => Annotation<T>({ reducer: (_, b) => b, default: () => null as T });
const append = <T>() => Annotation<T[]>({ reducer: (a, b) => a.concat(b), default: () => [] });
// Nodes return the requests they used; A1 and A2 can run in parallel, so the counts are added.
const sum = () => Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 });

export const State = Annotation.Root({
  mode: last<"api" | "chat">(),
  provider: last<Provider>(),
  input: last<JobInput | null>(),
  evidence: last<Evidence[]>(),
  layouts: last<LayoutView[]>(), // table-page renders shown to A1 for layout only; never citable
  a1: last<A1Output | null>(),
  a1Decisions: last<A1Output | null>(), // focused A1 pass: decisions, outcomes and controls (TD_ IDs)
  a1Actors: last<A1Output | null>(), // focused A1 pass: actors, external parties and hand-offs (TA_ IDs)
  a1Gaps: last<A1Output | null>(), // A1 re-read of text blocks no pass cited (TG_ IDs)
  gapBlocks: last<string[] | null>(), // IDs of the uncited process-like text blocks
  a2: last<A2Output | null>(),
  refined: last<A3Refined | null>(),
  candidate: last<A4Graph | null>(),
  critique: last<A5Critique | null>(),
  repairCount: last<number>(),
  requestCount: sum(),
  priorFindings: last<Finding[] | null>(), // the critique a repair worked from (for the focused re-review)
  changedIds: last<string[] | null>(), // element IDs the last repair patch touched
  unreviewedRepair: last<boolean>(), // the final repair skipped its re-review

  stageIssues: append<Issue>(), // issues from deterministic steps (normalize, check_refine, budget)
  issues: last<Issue[]>(), // final combined list, computed in validate
  compilable: last<boolean>(),
  bpmnXml: last<string | null>(),
  bpmnDraft: last<boolean>(), // compiled despite blocking structure errors, for the analyst to fix in the editor
  trace: append<TraceEntry>(),
});
type S = typeof State.State;

// schema: which output the pasted reply must match (A3_PATCH for the claim audit, A4_PATCH for a
// repair, otherwise the role). step: which pass of the role this is, e.g. "extract decisions".
// chars / maxChars: the prompt's length against Copilot's message limit (it is shrunk to fit when needed).
// cutChars: how many characters of source text were cut to make it fit (0 when none).
export type ChatHandoff = { role: Role; step: string; schema: OutputKind; roleName: string; prompt: string; chars: number; maxChars: number; cutChars: number; attachments: string[] };

/**
 * Run one specialist. API mode calls the provider; chat mode pauses the graph with interrupt()
 * and resumes with a JSON result that the server has already validated against the output schema.
 * Everything before interrupt() is pure, because LangGraph replays the node on resume.
 */
async function runRole<K extends OutputKind>(
  role: Role,
  kind: K,
  s: S,
  inputs: PromptInputs,
  step: string,
  mode: PromptMode = "full",
) {
  const prompt = buildPrompt(role, inputs, mode);
  if (prompt.kind !== kind) throw new Error(`Prompt for ${role}/${mode} returns ${prompt.kind}, expected ${kind}`);

  if (s.mode === "chat") {
    // Copilot Chat takes one message of limited length, so the packet is shrunk to fit.
    const chat = buildChatPacket(role, inputs, mode);
    const handoff: ChatHandoff = {
      role,
      step,
      schema: kind,
      roleName: ROLE_NAMES[role],
      prompt: chat.packet,
      chars: chat.chars,
      maxChars: chat.max,
      cutChars: chat.cutChars,
      attachments: chat.prompt.images.map((i) => `${i.id}: ${attachmentLabel(i)}`),
    };
    const resumed = interrupt(handoff);
    const output = OUTPUT_SCHEMAS[kind].parse(resumed) as (typeof OUTPUT_SCHEMAS)[K]["_output"];
    const cutNote = chat.cutChars ? `${chat.cutChars.toLocaleString()} characters of source text cut to fit Copilot's limit` : undefined;
    const trace: TraceEntry = { role, step, provider: "copilot_chat", model: null, ms: 0, ok: true, note: joinNotes("imported by analyst", cutNote), output };
    return { output, requests: 1, trace };
  }

  if (s.requestCount >= MAX_REQUESTS) {
    throw new AppError("BUDGET_EXCEEDED", `Job request budget (${MAX_REQUESTS}) exhausted before ${role}`);
  }
  const t0 = Date.now();
  const { output, requests, modelId, notes } = await callAgent(kind, prompt, s.provider);
  const trace: TraceEntry = {
    role,
    step,
    provider: s.provider,
    model: modelId,
    ms: Date.now() - t0,
    ok: true,
    note: notes.length ? notes.join("; ") : undefined,
    output,
  };
  return { output, requests, trace };
}

const evidenceIds = (s: S) => new Set(s.evidence.map((e) => e.id));
const hasText = (s: S) => s.evidence.some((e) => e.kind === "text");
const hasImages = (s: S) => s.evidence.some((e) => e.kind === "image");

type GraphElement = { id: string; evidence_refs: string[] };
const graphElements = (g: A4Graph): GraphElement[] => [...g.lanes, ...g.nodes, ...g.edges, ...g.annotations];

/**
 * Evidence IDs a repair or re-review needs: what the findings cite plus what the named elements cite.
 * Falls back to all evidence when nothing is cited, so a finding is never judged without its source.
 */
function focusEvidence(s: S, findings: Finding[], extraIds: string[] = []): Evidence[] {
  const named = new Set([...findings.flatMap((f) => f.element_ids), ...extraIds]);
  const ids = new Set(findings.flatMap((f) => f.evidence_refs));
  for (const el of graphElements(s.candidate!)) if (named.has(el.id)) el.evidence_refs.forEach((r) => ids.add(r));
  const picked = s.evidence.filter((e) => ids.has(e.id));
  return picked.length ? picked : s.evidence;
}

/** Only the A3 actors, claims and relations that cite the focus evidence. */
function focusRefined(refined: A3Refined, evidence: Evidence[]) {
  const ids = new Set(evidence.map((e) => e.id));
  const cites = (x: { evidence_refs: string[] }) => x.evidence_refs.some((r) => ids.has(r));
  return {
    actors: refined.actors.filter(cites),
    claims: refined.claims.filter(cites),
    relations: refined.relations.filter(cites),
  };
}

// ---------- nodes ----------

async function normalizeNode(s: S): Promise<Partial<S>> {
  const t0 = Date.now();
  const { evidence, layouts, issues } = await normalize(s.input ?? {});
  const texts = evidence.filter((e) => e.kind === "text").length;
  const layoutNote = layouts.length ? `, ${layouts.length} table-page layout views (${layouts.map((l) => `p${l.page}`).join(", ")})` : "";
  return {
    evidence,
    layouts,
    input: null, // raw upload no longer needed in the checkpoint
    stageIssues: issues,
    repairCount: 0,
    requestCount: 0, // adds nothing; the counter starts at 0
    trace: [{ role: "system", step: "normalize", provider: "code", model: null, ms: Date.now() - t0, ok: true, note: `${texts} text blocks, ${evidence.length - texts} images${layoutNote}`, output: { evidence: evidence.map((e) => ({ id: e.id, kind: e.kind, source: e.source, page: e.page, chars: e.kind === "text" ? e.text.length : undefined })), layouts: layouts.map((l) => ({ id: l.id, source: l.source, page: l.page })), issues } }],
  };
}

async function a1Node(s: S): Promise<Partial<S>> {
  const r = await runRole("A1", "A1", s, { evidence: s.evidence, layouts: s.layouts ?? [] }, "extract text");
  return { a1: r.output, requestCount: r.requests, trace: [{ ...r.trace, note: joinNotes(r.trace.note, passNote(r.output)) }] };
}

/**
 * Give every ID an A1 pass defines its pass prefix (TD_, TA_, TG_), so passes run in parallel
 * never collide when merged. References to IDs the pass did not define (the gap pass links to
 * existing claims) are left as they are.
 */
function namespaceIds(out: A1Output, prefix: string): A1Output {
  const map = new Map<string, string>();
  for (const x of [...out.actors, ...out.claims, ...out.relations]) {
    if (!x.id.startsWith(prefix)) map.set(x.id, prefix + x.id.replace(/^T_?/, ""));
  }
  const ref = (id: string) => map.get(id) ?? id;
  return {
    actors: out.actors.map((a) => ({ ...a, id: ref(a.id) })),
    claims: out.claims.map((c) => ({ ...c, id: ref(c.id), actor_id: c.actor_id && ref(c.actor_id) })),
    relations: out.relations.map((r) => ({ ...r, id: ref(r.id), from: ref(r.from), to: ref(r.to) })),
    issues: out.issues.map((i) => ({ ...i, element_ids: i.element_ids.map(ref) })),
  };
}

const passNote = (o: A1Output) => `${o.claims.length} claims, ${o.relations.length} relations, ${o.actors.length} actors`;

async function a1DecisionsNode(s: S): Promise<Partial<S>> {
  const r = await runRole("A1", "A1", s, { evidence: s.evidence, layouts: s.layouts ?? [] }, "extract decisions", "decisions");
  const out = namespaceIds(r.output, "TD_");
  return { a1Decisions: out, requestCount: r.requests, trace: [{ ...r.trace, note: joinNotes(r.trace.note, passNote(out)), output: out }] };
}

async function a1ActorsNode(s: S): Promise<Partial<S>> {
  const r = await runRole("A1", "A1", s, { evidence: s.evidence, layouts: s.layouts ?? [] }, "extract actors", "actors");
  const out = namespaceIds(r.output, "TA_");
  return { a1Actors: out, requestCount: r.requests, trace: [{ ...r.trace, note: joinNotes(r.trace.note, passNote(out)), output: out }] };
}

const textPasses = (s: S) => [s.a1, s.a1Decisions, s.a1Actors, s.a1Gaps].filter((o): o is A1Output => o != null);

/** All A1 passes as one extraction (their IDs never overlap), for A3 and the checks after it. */
export function mergedA1(s: Pick<S, "a1" | "a1Decisions" | "a1Actors" | "a1Gaps">): A1Output | null {
  const passes = textPasses(s as S);
  if (!passes.length) return null;
  return {
    actors: passes.flatMap((p) => p.actors),
    claims: passes.flatMap((p) => p.claims),
    relations: passes.flatMap((p) => p.relations),
    issues: passes.flatMap((p) => p.issues),
  };
}

// A text block worth re-reading when no pass cited it: long enough to be more than a heading, and
// worded like a procedure (a numbered or bulleted line, an instruction or a condition).
const PROCESS_WORDING =
  /^\s*(\d+(\.\d+)*[.)]?|[•\-–])\s|\b(if|where|when|unless|only|otherwise|must|shall|should|ensure|confirm|check|verify|approve|review|escalate|record|submit|request|notify|send|assign|update|reject|close|reopen)\b/im;
const MIN_GAP_CHARS = 60;

function uncitedBlocks(s: S, passes: A1Output[]): Evidence[] {
  const cited = new Set(passes.flatMap((p) => [...p.actors, ...p.claims, ...p.relations].flatMap((x) => x.evidence_refs)));
  return s.evidence.filter((e) => e.kind === "text" && !cited.has(e.id) && e.text.length >= MIN_GAP_CHARS && PROCESS_WORDING.test(e.text));
}

/** Code check after the readers: which procedure-like text blocks did no extraction pass cite? */
function coverageNode(s: S): Partial<S> {
  const textBlocks = s.evidence.filter((e) => e.kind === "text").length;
  const gaps = textBlocks ? uncitedBlocks(s, textPasses(s)) : [];
  return {
    gapBlocks: gaps.map((e) => e.id),
    trace: [{ role: "system", step: "coverage check", provider: "code", model: null, ms: 0, ok: true, note: gaps.length ? `${gaps.length} of ${textBlocks} text blocks uncited: ${gaps.map((e) => e.id).join(", ")}` : `all procedure text cited (${textBlocks} blocks)`, output: { textBlocks, uncited: gaps.map((e) => ({ id: e.id, text: e.kind === "text" ? e.text : "" })) } }],
  };
}

/** A1 re-reads only the uncited blocks, seeing what was already found so it links instead of repeating. */
async function gapFillNode(s: S): Promise<Partial<S>> {
  const ids = new Set(s.gapBlocks ?? []);
  const passes = textPasses(s);
  const existing = {
    actors: passes.flatMap((p) => p.actors.map((a) => ({ id: a.id, name: a.name }))),
    claims: passes.flatMap((p) => p.claims.map((c) => ({ id: c.id, kind: c.kind, label: c.label, actor_id: c.actor_id }))),
  };
  const r = await runRole("A1", "A1", s, { evidence: s.evidence.filter((e) => ids.has(e.id)), existing }, "fill coverage gaps", "gaps");
  const out = namespaceIds(r.output, "TG_");
  // Blocks still uncited after the re-read are listed for the analyst rather than retried.
  const still = uncitedBlocks(s, [...passes, out]).filter((e) => ids.has(e.id));
  const stageIssues: Issue[] = still.length
    ? [{ code: "COVERAGE_UNCITED", severity: "info", message: `No extracted step cites these text blocks, even after a second read: ${still.map((e) => e.id).join(", ")}. Check they hold no process steps.`, element_ids: [], evidence_refs: still.map((e) => e.id) }]
    : [];
  return { a1Gaps: out, stageIssues, requestCount: r.requests, trace: [{ ...r.trace, note: joinNotes(r.trace.note, passNote(out), `${ids.size - still.length} of ${ids.size} gaps now cited`), output: { pass: out, stillUncited: still.map((e) => e.id) } }] };
}

async function a2Node(s: S): Promise<Partial<S>> {
  const r = await runRole("A2", "A2", s, { evidence: s.evidence }, "interpret diagram");
  return { a2: r.output, requestCount: r.requests, trace: [r.trace] };
}

/**
 * Text-only input: A3 has no diagram to merge, so pass A1's claims through unchanged in code
 * instead of paying for a model call that would only rewrite them. IDs keep A1's "T" prefix.
 */
function refinedFromA1(a1: A1Output): A3Refined {
  return {
    actors: a1.actors.map((a) => ({ ...a, aliases: [] })),
    claims: a1.claims.map((c) => ({ ...c, source_label: c.label, from_ids: [c.id] })),
    relations: a1.relations,
    changes: [],
    issues: a1.issues,
  };
}

async function a3Node(s: S): Promise<Partial<S>> {
  const a1 = mergedA1(s);
  // Text-only input from a single pass has nothing to merge. Several passes overlap, so A3 dedupes them.
  if (!hasImages(s) && a1 && textPasses(s).length === 1) {
    return {
      refined: refinedFromA1(a1),
      trace: [{ role: "A3", step: "refine extraction", provider: "code", model: null, ms: 0, ok: true, note: "skipped: text-only input, A1 claims passed through", output: refinedFromA1(a1) }],
    };
  }
  const r = await runRole("A3", "A3", s, { evidence: s.evidence, a1, a2: s.a2 }, "refine extraction");
  const refined = withDerivedChanges(withSourceLabels(r.output, a1, s.a2), a1, s.a2);
  return { refined, requestCount: r.requests, trace: [{ ...r.trace, output: { model: r.output, refined } }] };
}

// Change types A3 no longer writes: they follow from from_ids and aliases (see withDerivedChanges).
const DERIVED_CHANGES = new Set(["merged", "linked", "actor_merged", "relabelled"]);

/**
 * Record merges, links and actor aliases in code instead of asking A3 to write them out, which
 * cost output time on every run. A claim built from several upstream items is a merge, or a link
 * when it joins A1 text with A2 diagram items.
 */
function withDerivedChanges(r: A3Refined, a1: A1Output | null, a2: A2Output | null): A3Refined {
  const fromDiagram = new Set([...(a2?.shapes ?? []), ...(a2?.continuations ?? [])].map((x) => x.id));
  const claimChanges: A3Refined["changes"] = r.claims
    .filter((c) => c.from_ids.length > 1)
    .map((c) => {
      const linked = c.from_ids.some((id) => fromDiagram.has(id)) && c.from_ids.some((id) => !fromDiagram.has(id));
      return {
        type: linked ? "linked" : "merged",
        upstream_ids: c.from_ids,
        result_id: c.id,
        reason: linked ? "text step matched to diagram shape" : `same step in ${c.from_ids.length} extraction passes`,
      };
    });
  const upstreamActors = [...(a1?.actors ?? []), ...(a2?.lanes ?? [])];
  const actorChanges: A3Refined["changes"] = r.actors
    .filter((a) => a.aliases.length)
    .map((a) => {
      const names = new Set([a.name, ...a.aliases].map((n) => n.trim().toLowerCase()));
      return {
        type: "actor_merged",
        upstream_ids: upstreamActors.filter((u) => names.has(u.name.trim().toLowerCase())).map((u) => u.id),
        result_id: a.id,
        reason: `aliases: ${a.aliases.join(", ")}`,
      };
    });
  const modelChanges = r.changes.filter((c) => !DERIVED_CHANGES.has(c.type));
  return { ...r, changes: [...actorChanges, ...claimChanges, ...modelChanges] };
}

/**
 * Check the claims against the source before anything is drawn: a missing step, branch or owner
 * is cheaper to add to the claim list than to patch into a graph afterwards.
 */
async function auditNode(s: S): Promise<Partial<S>> {
  if (!CLAIM_AUDIT || !s.refined) return {};
  const r = await runRole("A3", "A3_PATCH", s, { evidence: s.evidence, refined: s.refined }, "audit claims", "audit");
  const { refined, summary } = applyClaimPatch(s.refined, r.output);
  return { refined, requestCount: r.requests, trace: [{ ...r.trace, note: joinNotes(r.trace.note, summary), output: { patch: r.output, refined } }] };
}

/**
 * A3 does not repeat the original wording (it costs output time); restore it from the
 * A1 claims and A2 shapes / continuations each refined claim came from.
 */
function withSourceLabels(out: A3Output, a1: A1Output | null, a2: A2Output | null): A3Refined {
  const original = new Map<string, string>();
  for (const c of a1?.claims ?? []) original.set(c.id, c.label);
  for (const sh of a2?.shapes ?? []) if (sh.label) original.set(sh.id, sh.label);
  for (const c of a2?.continuations ?? []) original.set(c.id, c.label);
  return {
    ...out,
    claims: out.claims.map((c) => {
      const labels = [...new Set(c.from_ids.map((id) => original.get(id)).filter((l): l is string => !!l))];
      return { ...c, source_label: labels.length ? labels.join(" | ") : c.label };
    }),
  };
}

function checkRefineNode(s: S): Partial<S> {
  const issues = checkRefine(mergedA1(s), s.a2, s.refined!, evidenceIds(s));
  return {
    stageIssues: issues,
    trace: [{ role: "system", step: "check refine", provider: "code", model: null, ms: 0, ok: !issues.some((i) => i.severity === "blocking"), note: `${s.refined!.changes.length} changes, ${issues.length} issues`, output: { changes: s.refined!.changes, issues } }],
  };
}

const joinNotes = (...notes: (string | undefined)[]) => notes.filter(Boolean).join("; ");

async function a4Node(s: S): Promise<Partial<S>> {
  const repair = s.critique !== null && s.repairCount < MAX_REPAIRS && needsRepair(s.critique);
  if (!repair) {
    const r = await runRole("A4", "A4", s, { evidence: s.evidence, refined: s.refined }, "compose graph");
    return { candidate: r.output, requestCount: r.requests, trace: [r.trace] };
  }

  // Repair: send only the findings and what they touch, get back a patch, apply it in code.
  const findings = actionable(s.critique!);
  const evidence = focusEvidence(s, findings);
  const r = await runRole(
    "A4",
    "A4_PATCH",
    s,
    { evidence, refined: focusRefined(s.refined!, evidence), candidate: s.candidate, findings },
    "repair graph",
    "repair",
  );
  const patched = applyPatch(s.candidate!, r.output);
  const repairCount = s.repairCount + 1;
  // The last allowed repair skips its re-review: no further repair could follow it anyway.
  // Its findings stay in the critique and are reported as "not re-checked" by validate.
  const final = repairCount >= MAX_REPAIRS;
  return {
    candidate: patched.graph,
    changedIds: patched.changedIds,
    priorFindings: s.critique!.findings,
    critique: final ? s.critique : null,
    unreviewedRepair: final,
    repairCount,
    requestCount: r.requests,
    trace: [{ ...r.trace, note: joinNotes(r.trace.note, patched.summary, final ? "final repair, re-review skipped" : undefined), output: { findings, patch: r.output, changedIds: patched.changedIds, graph: patched.graph } }],
  };
}

async function a5Node(s: S): Promise<Partial<S>> {
  if (s.mode === "api" && s.requestCount >= MAX_REQUESTS) {
    // Out of budget for a re-review: continue, but the review is explicitly incomplete (FSD F07).
    return {
      stageIssues: [{ code: "REVIEW_INCOMPLETE", severity: "blocking", message: "Request budget exhausted before the critic could re-review the repaired graph.", element_ids: [], evidence_refs: [] }],
    };
  }

  let critique: A5Critique;
  let r: Awaited<ReturnType<typeof runRole<"A5">>>;
  // Structure findings are re-derived in code below, so the critic never re-reviews them.
  const previous = (s.priorFindings ?? []).filter((f) => isActionable(f) && !isStructural(f));
  if (s.repairCount > 0 && s.priorFindings && s.changedIds && !previous.length) {
    // The repair only fixed structure errors: nothing for the critic to re-check, so skip the model call.
    r = {
      output: { findings: [], review_complete: true },
      requests: 0,
      trace: { role: "A5", step: "re-review", provider: "code", model: null, ms: 0, ok: true, note: "only structure errors were fixed; re-checked in code" },
    };
    critique = { ...r.output, findings: s.priorFindings.filter((f) => !isActionable(f)) };
  } else if (s.repairCount > 0 && s.priorFindings && s.changedIds) {
    // Focused re-review: only the findings the repair targeted and the elements it changed.
    const changedSet = new Set(s.changedIds);
    const changed = {
      ids: s.changedIds,
      elements: graphElements(s.candidate!).filter((el) => changedSet.has(el.id)),
    };
    r = await runRole(
      "A5",
      "A5",
      s,
      { evidence: focusEvidence(s, previous, s.changedIds), candidate: s.candidate, findings: previous, changed },
      "re-review",
      "recheck",
    );
    // Info-only findings were never sent for repair, so carry them forward unchanged.
    critique = { ...r.output, findings: [...r.output.findings, ...s.priorFindings.filter((f) => !isActionable(f))] };
  } else {
    r = await runRole("A5", "A5", s, { evidence: s.evidence, candidate: s.candidate }, "review");
    critique = r.output;
  }
  // Structure check in code (start/end events, lanes, dangling flows), so errors that would stop
  // the BPMN build go into the repair loop instead of surfacing only after it.
  const structure = structuralFindings(s.candidate!, evidenceIds(s));
  critique = { ...critique, findings: [...critique.findings.filter((f) => !isStructural(f)), ...structure] };
  // Record how many findings would trigger a repair, so the UI can explain the loop.
  const toFix = actionable(critique).length;
  const fixNote = toFix
    ? `${toFix} findings to fix${structure.length ? ` (${structure.length} structure)` : ""}`
    : "no fixes needed";
  const trace = { ...r.trace, note: joinNotes(r.trace.note, fixNote), output: critique };
  return { critique, requestCount: r.requests, trace: [trace] };
}

const SEVERITY_RANK: Record<Issue["severity"], number> = { info: 0, review: 1, blocking: 2 };

/**
 * A1, A3 and A4 each carry forward the upstream issues that still apply, so the same issue
 * arrives several times. Merge issues with the same code and message (ignoring case and spacing):
 * keep the first position, the most severe level and the union of element and evidence IDs.
 */
function dedupeIssues(issues: Issue[]): Issue[] {
  const merged = new Map<string, Issue>();
  for (const i of issues) {
    const key = `${i.code}|${i.message.trim().replace(/\s+/g, " ").toLowerCase()}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...i, element_ids: [...i.element_ids], evidence_refs: [...i.evidence_refs] });
      continue;
    }
    if (SEVERITY_RANK[i.severity] > SEVERITY_RANK[prev.severity]) prev.severity = i.severity;
    prev.element_ids = [...new Set([...prev.element_ids, ...i.element_ids])];
    prev.evidence_refs = [...new Set([...prev.evidence_refs, ...i.evidence_refs])];
  }
  return [...merged.values()];
}

function validateNode(s: S): Partial<S> {
  const placed = placeEvents(s.candidate!);
  const g = placed.graph;
  const { issues: validation, compilable } = validateGraph(g, evidenceIds(s));
  // Drop critic findings that only complained about the lanes placeEvents has just fixed.
  const fixed = new Set([...placed.moved, ...placed.removedLanes]);
  const stale = (f: A5Critique["findings"][number]) =>
    fixed.size > 0 && f.element_ids.length > 0 && f.element_ids.every((id) => fixed.has(id)) && /lane/i.test(`${f.code} ${f.rationale}`);
  // After a final repair with no re-review, the findings it targeted may already be fixed.
  const unverified = (f: Finding) =>
    s.unreviewedRepair && isActionable(f) ? "Not re-checked after the final repair, so it may already be fixed. " : "";
  // Structure findings are re-derived just below by validateGraph on the final graph.
  const findings: Issue[] = (s.critique?.findings ?? []).filter((f) => !stale(f) && !isStructural(f)).map((f) => ({
    code: `A5_${f.code}`,
    severity: f.severity,
    message: unverified(f) + (f.suggested_change ? `${f.rationale} Suggested: ${f.suggested_change}` : f.rationale),
    element_ids: f.element_ids,
    evidence_refs: f.evidence_refs,
  }));
  const issues = dedupeIssues([
    ...s.stageIssues,
    ...(mergedA1(s)?.issues ?? []),
    ...(s.a2?.issues ?? []),
    ...(s.refined?.issues ?? []),
    ...g.issues,
    ...findings,
    ...placed.issues,
    ...validation,
  ]);
  return {
    candidate: g,
    issues,
    compilable,
    trace: [{ role: "system", step: "validate", provider: "code", model: null, ms: 0, ok: compilable, note: `${validation.length} validation issues`, output: { compilable, validation, moved: placed.moved, removedLanes: placed.removedLanes, issues } }],
  };
}

function compileNode(s: S): Partial<S> {
  const t0 = Date.now();
  if (s.compilable) {
    return {
      bpmnXml: compileBpmn(s.candidate!),
      bpmnDraft: false,
      trace: [{ role: "system", step: "compile bpmn", provider: "code", model: null, ms: Date.now() - t0, ok: true }],
    };
  }
  // FSD F08: a structurally invalid graph is never presented as valid. It is still compiled as a
  // marked draft so the analyst can fix the blocking issues in the diagram editor.
  const { graph, dropped } = draftable(s.candidate!);
  const issues = dropped.length
    ? [
        ...s.issues,
        {
          code: "DRAFT_ELEMENTS_DROPPED",
          severity: "blocking" as const,
          message: `Left out of the draft diagram because they cannot be drawn: ${dropped.join(", ")}. Add them back in the editor if needed.`,
          element_ids: dropped,
          evidence_refs: [],
        },
      ]
    : s.issues;
  return {
    bpmnXml: compileBpmn(graph),
    bpmnDraft: true,
    issues,
    trace: [{ role: "system", step: "compile bpmn", provider: "code", model: null, ms: Date.now() - t0, ok: false, note: "draft: critical structure errors must be fixed in the editor" }],
  };
}

// ---------- step timing ----------

// When each running node of a job started, keyed by job (thread) ID, so the UI can time the current step.
const started = new Map<string, Map<string, number>>();

/** Start times of the nodes running (or paused for chat) right now, as ISO strings. */
export const runningSince = (jobId: string): Record<string, string> =>
  Object.fromEntries([...(started.get(jobId) ?? [])].map(([node, t]) => [node, new Date(t).toISOString()]));

/** Forget start times after a failure or a mode switch, so a retried node times from its retry. */
export const clearRunning = (jobId: string) => started.delete(jobId);

function timed(name: string, fn: (s: S) => Partial<S> | Promise<Partial<S>>) {
  return async (s: S, config: LangGraphRunnableConfig): Promise<Partial<S>> => {
    const id = String(config.configurable?.thread_id);
    const nodes = started.get(id) ?? new Map<string, number>();
    started.set(id, nodes);
    // A chat handoff replays the node on resume; keep the first start so the wait is counted.
    if (!nodes.has(name)) nodes.set(name, Date.now());
    const out = await fn(s);
    const t0 = nodes.get(name) ?? Date.now();
    nodes.delete(name);
    if (!nodes.size) started.delete(id);
    // Chat steps record 0 ms; their real time is handoff to pasted reply.
    if (out.trace) out.trace = out.trace.map((t) => (t.provider === "copilot_chat" ? { ...t, ms: Date.now() - t0 } : t));
    for (const t of out.trace ?? []) logPass(id, t);
    return out;
  };
}

// Server console log of each pass. LOG_PASSES in .env: "summary" (default) one line per pass,
// "full" also prints the pass output as JSON, "off" prints nothing. The same output is on the trace.
const LOG_PASSES = process.env.LOG_PASSES ?? "summary";

function logPass(jobId: string, t: TraceEntry) {
  if (LOG_PASSES === "off") return;
  const who = t.model ? `${t.provider}/${t.model}` : t.provider;
  console.log(`[${jobId.slice(0, 8)}] ${t.role} ${t.step} · ${who} · ${(t.ms / 1000).toFixed(1)}s · ${t.ok ? "ok" : "FAILED"}${t.note ? ` · ${t.note}` : ""}`);
  if (LOG_PASSES === "full" && t.output !== undefined) console.log(JSON.stringify(t.output, null, 2));
}

// ---------- routing ----------

const isActionable = (f: Finding) => f.severity !== "info";
const actionable = (c: A5Critique) => c.findings.filter(isActionable);
const needsRepair = (c: A5Critique) => actionable(c).length > 0;

// The readers: the A1 passes over the text and A2 over the diagrams, each with the output it fills.
const READERS = [
  ["a1_text_extract", (s: S) => s.a1, (s: S) => hasText(s)],
  ["a1_decisions", (s: S) => s.a1Decisions, (s: S) => hasText(s) && EXTRACT_LENSES],
  ["a1_actors", (s: S) => s.a1Actors, (s: S) => hasText(s) && EXTRACT_LENSES],
  ["a2_diagram_interpret", (s: S) => s.a2, (s: S) => hasImages(s)],
] as const;
const READER_NODES = READERS.map(([name]) => name);
const readersFor = (s: S) => READERS.filter(([, , applies]) => applies(s));

/**
 * The readers are independent, so in API mode they all run in parallel and the coverage check
 * starts once every one has finished. Chat mode runs them in sequence so the analyst handles one
 * handoff at a time.
 */
const afterNormalize = (s: S) => {
  const readers = readersFor(s).map(([name]) => name);
  if (!readers.length) return END;
  return s.mode === "api" ? readers : readers[0];
};
// Chat mode: the next reader still without output. API mode: the parallel readers all meet at the check.
const afterReader = (s: S) =>
  (s.mode === "chat" && readersFor(s).find(([, output]) => output(s) == null)?.[0]) || "coverage_check";
const afterCoverage = (s: S) => (s.gapBlocks?.length ? "a1_gap_fill" : "a3_refine");
const afterA4 = (s: S) => (s.unreviewedRepair ? "validate" : "a5_critique");
const afterA5 =(s: S) => (s.critique && s.repairCount < MAX_REPAIRS && needsRepair(s.critique) ? "a4_compose" : "validate");

export const workflow = new StateGraph(State)
  .addNode("normalize", timed("normalize", normalizeNode))
  .addNode("a1_text_extract", timed("a1_text_extract", a1Node))
  .addNode("a1_decisions", timed("a1_decisions", a1DecisionsNode))
  .addNode("a1_actors", timed("a1_actors", a1ActorsNode))
  .addNode("a2_diagram_interpret", timed("a2_diagram_interpret", a2Node))
  .addNode("coverage_check", timed("coverage_check", coverageNode))
  .addNode("a1_gap_fill", timed("a1_gap_fill", gapFillNode))
  .addNode("a3_refine", timed("a3_refine", a3Node))
  .addNode("a3_audit", timed("a3_audit", auditNode))
  .addNode("check_refine", timed("check_refine", checkRefineNode))
  .addNode("a4_compose", timed("a4_compose", a4Node))
  .addNode("a5_critique", timed("a5_critique", a5Node))
  .addNode("validate", timed("validate", validateNode))
  .addNode("compile_bpmn", timed("compile_bpmn", compileNode))
  .addEdge(START, "normalize")
  .addConditionalEdges("normalize", afterNormalize, [...READER_NODES, END])
  .addConditionalEdges("a1_text_extract", afterReader, [...READER_NODES, "coverage_check"])
  .addConditionalEdges("a1_decisions", afterReader, [...READER_NODES, "coverage_check"])
  .addConditionalEdges("a1_actors", afterReader, [...READER_NODES, "coverage_check"])
  .addConditionalEdges("a2_diagram_interpret", afterReader, [...READER_NODES, "coverage_check"])
  .addConditionalEdges("coverage_check", afterCoverage, ["a1_gap_fill", "a3_refine"])
  .addEdge("a1_gap_fill", "a3_refine")
  .addEdge("a3_refine", "a3_audit")
  .addEdge("a3_audit", "check_refine")
  .addEdge("check_refine", "a4_compose")
  .addConditionalEdges("a4_compose", afterA4, ["a5_critique", "validate"])
  .addConditionalEdges("a5_critique", afterA5, ["a4_compose", "validate"])
  .addEdge("validate", "compile_bpmn")
  .addEdge("compile_bpmn", END);

// In-memory checkpointer: enough to pause/resume chat handoffs within one server process.
export const graph = workflow.compile({ checkpointer: new MemorySaver() });
