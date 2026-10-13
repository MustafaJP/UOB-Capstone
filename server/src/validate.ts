import type { A1Output, A2Output, A3Refined, A4Graph, Finding, Issue } from "./schemas.js";

const issue = (code: string, severity: Issue["severity"], message: string, element_ids: string[] = [], evidence_refs: string[] = []): Issue => ({
  code,
  severity,
  message,
  element_ids,
  evidence_refs,
});

function unknownEvidence(items: { id: string; evidence_refs: string[] }[], known: Set<string>): Issue[] {
  return items.flatMap((item) => {
    const bad = item.evidence_refs.filter((r) => !known.has(r));
    return bad.length ? [issue("EVIDENCE_UNKNOWN", "blocking", `${item.id} cites evidence that does not exist: ${bad.join(", ")}`, [item.id])] : [];
  });
}

/** Deterministic gate after A3: nothing silently dropped, no invented evidence. */
export function checkRefine(a1: A1Output | null, a2: A2Output | null, refined: A3Refined, evidenceIds: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const upstream = [
    ...(a1?.claims.map((c) => c.id) ?? []),
    ...(a2?.shapes.map((s) => s.id) ?? []),
    ...(a2?.continuations.map((c) => c.id) ?? []),
  ];
  const accounted = new Set([
    ...refined.claims.flatMap((c) => c.from_ids),
    ...refined.changes.filter((c) => c.type === "dropped").flatMap((c) => c.upstream_ids),
  ]);
  const missing = upstream.filter((id) => !accounted.has(id));
  if (missing.length) {
    issues.push(
      issue("REFINE_DROPPED_CLAIM", "blocking", `A3 dropped upstream items without a reason: ${missing.join(", ")}`, missing),
    );
  }
  const dropped = refined.changes.filter((c) => c.type === "dropped");
  for (const d of dropped) {
    issues.push(issue("REFINE_DROPPED", "review", `A3 dropped ${d.upstream_ids.join(", ")}: ${d.reason}`, d.upstream_ids));
  }
  issues.push(...unknownEvidence([...refined.claims, ...refined.relations, ...refined.actors], evidenceIds));
  const claimIds = new Set(refined.claims.map((c) => c.id));
  for (const r of refined.relations) {
    if (!claimIds.has(r.from) || !claimIds.has(r.to)) {
      issues.push(issue("REFINE_DANGLING_RELATION", "review", `Relation ${r.id} points to a claim that does not exist`, [r.id]));
    }
  }
  return issues;
}

/**
 * Start and end events have no owner in most SOPs, so A4 tends to park them in an "Unassigned" lane.
 * A lane that holds only events is moved into the flow: a start joins the lane of its first step,
 * an end joins the lane of the step before it, and lanes left empty are removed.
 */
export function placeEvents(g: A4Graph): { graph: A4Graph; issues: Issue[]; moved: string[]; removedLanes: string[] } {
  const laneName = new Map(g.lanes.map((l) => [l.id, l.name]));
  const eventOnly = new Set(
    g.lanes.filter((l) => g.nodes.some((n) => n.lane_id === l.id) && g.nodes.every((n) => n.lane_id !== l.id || n.type === "start" || n.type === "end")).map((l) => l.id),
  );
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const issues: Issue[] = [];
  const moved: string[] = [];
  const nodes = g.nodes.map((n) => {
    if (!eventOnly.has(n.lane_id)) return n;
    const neighbour =
      n.type === "start"
        ? g.edges.filter((e) => e.source_id === n.id).map((e) => byId.get(e.target_id))
        : g.edges.filter((e) => e.target_id === n.id).map((e) => byId.get(e.source_id));
    const lane = neighbour.find((x) => x && !eventOnly.has(x.lane_id))?.lane_id;
    if (!lane) return n;
    moved.push(n.id);
    issues.push(
      issue("EVENT_LANE_ASSIGNED", "info", `${n.id} "${n.label}" moved from lane "${laneName.get(n.lane_id)}" to "${laneName.get(lane)}", next to the step it ${n.type === "start" ? "starts" : "follows"}`, [n.id]),
    );
    return { ...n, lane_id: lane };
  });
  const used = new Set(nodes.map((n) => n.lane_id));
  const removedLanes = g.lanes.filter((l) => !used.has(l.id)).map((l) => l.id);
  return { graph: { ...g, nodes, lanes: g.lanes.filter((l) => used.has(l.id)) }, issues, moved, removedLanes };
}

/** Deterministic subset checks on the composed graph (FSD §10, V01–V07). */
export function validateGraph(g: A4Graph, evidenceIds: Set<string>): { issues: Issue[]; compilable: boolean } {
  const issues: Issue[] = [];
  let compilable = true;
  const structural = (code: string, message: string, ids: string[] = []) => {
    compilable = false;
    issues.push(issue(code, "blocking", message, ids));
  };

  // V01 unique IDs and resolvable references
  const all = [...g.lanes, ...g.nodes, ...g.edges, ...g.annotations].map((x) => x.id);
  const dupes = all.filter((id, i) => all.indexOf(id) !== i);
  if (dupes.length) structural("V01_DUPLICATE_ID", `Duplicate IDs: ${[...new Set(dupes)].join(", ")}`, dupes);
  const laneIds = new Set(g.lanes.map((l) => l.id));
  const nodeIds = new Set(g.nodes.map((n) => n.id));
  for (const n of g.nodes) {
    if (!laneIds.has(n.lane_id)) structural("V06_LANE_MISSING", `Node ${n.id} is in unknown lane ${n.lane_id}`, [n.id]);
  }
  for (const e of g.edges) {
    if (!nodeIds.has(e.source_id) || !nodeIds.has(e.target_id)) structural("V01_DANGLING_EDGE", `Edge ${e.id} has a missing endpoint`, [e.id]);
  }
  for (const a of g.annotations) {
    if (a.attached_element_id && !nodeIds.has(a.attached_element_id)) {
      issues.push(issue("V01_DANGLING_ANNOTATION", "review", `Annotation ${a.id} is attached to unknown ${a.attached_element_id}`, [a.id]));
    }
  }
  issues.push(...unknownEvidence([...g.lanes, ...g.nodes, ...g.edges, ...g.annotations], evidenceIds));

  // V02 start and end events
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const e of g.edges) {
    incoming.set(e.target_id, (incoming.get(e.target_id) ?? 0) + 1);
    outgoing.set(e.source_id, [...(outgoing.get(e.source_id) ?? []), e.id]);
  }
  const starts = g.nodes.filter((n) => n.type === "start");
  if (!starts.length) issues.push(issue("V02_NO_START", "blocking", "The process has no start event"));
  if (!g.nodes.some((n) => n.type === "end")) issues.push(issue("V02_NO_END", "review", "No end event: the process may be incomplete"));
  for (const n of g.nodes) {
    if (n.type === "start" && incoming.get(n.id)) structural("V02_START_INCOMING", `Start ${n.id} has incoming flow`, [n.id]);
    if (n.type === "end" && outgoing.get(n.id)?.length) structural("V02_END_OUTGOING", `End ${n.id} has outgoing flow`, [n.id]);
  }

  // V03 reachability from a start
  const adjacency = new Map<string, string[]>();
  for (const e of g.edges) adjacency.set(e.source_id, [...(adjacency.get(e.source_id) ?? []), e.target_id]);
  const seen = new Set(starts.map((s) => s.id));
  const queue = [...seen];
  while (queue.length) {
    for (const next of adjacency.get(queue.shift()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const unreachable = g.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  if (starts.length && unreachable.length) {
    issues.push(issue("V03_UNREACHABLE", "review", `Not reachable from a start: ${unreachable.join(", ")}`, unreachable));
  }
  for (const n of g.nodes) {
    if (n.type !== "end" && !outgoing.get(n.id)?.length) {
      issues.push(issue("V03_DEAD_END", "review", `${n.id} "${n.label}" has no outgoing flow`, [n.id]));
    }
  }

  // V04 decisions: at least two labelled branches
  for (const n of g.nodes.filter((x) => x.type === "exclusive_gateway")) {
    const outs = g.edges.filter((e) => e.source_id === n.id);
    if (outs.length >= 2 && outs.some((e) => !e.label?.trim())) {
      issues.push(issue("V04_UNLABELLED_BRANCH", "review", `Decision ${n.id} has an unlabelled branch`, [n.id]));
    }
    if (outs.length < 2 && (incoming.get(n.id) ?? 0) < 2) {
      issues.push(issue("V04_GATEWAY_BRANCHES", "review", `Decision ${n.id} "${n.label}" has fewer than two branches`, [n.id]));
    }
  }

  // V07 evidence: every node and edge cites evidence, or is explicitly inferred
  for (const x of [...g.nodes, ...g.edges]) {
    if (x.origin === "inferred") issues.push(issue("V07_INFERRED", "review", `${x.id} is inferred, not stated in the source`, [x.id]));
    else if (!x.evidence_refs.length) issues.push(issue("V07_NO_EVIDENCE", "review", `${x.id} cites no evidence`, [x.id]));
  }

  return { issues, compilable };
}

// ---------- structure checks inside the repair loop ----------

/** Structure findings use this prefix so the loop can tell them apart from the critic's. */
export const STRUCT_PREFIX = "STRUCT_";
export const isStructural = (f: { code: string }) => f.code.startsWith(STRUCT_PREFIX);

const STRUCT_FIX: Record<string, string> = {
  V01_DUPLICATE_ID: "Give every lane, node, flow and note its own ID.",
  V06_LANE_MISSING: "Put the node in one of the existing lanes, or add the lane it refers to.",
  V01_DANGLING_EDGE: "Point the flow at nodes that exist, or remove it.",
  V02_START_INCOMING:
    "A start event cannot have incoming flow. Point that flow at the first step after the start, or change the start into a task.",
  V02_END_OUTGOING:
    "An end event cannot have outgoing flow. If the process can continue from here (for example a reopen route), add a decision before the end with one branch to the end and one to the step that continues, then remove the flow that leaves the end.",
  V02_NO_START: "Add a start event that flows into the first step.",
};

/**
 * The blocking structure errors validate would raise on this graph, as findings A4 can repair.
 * Pure code, so running it after every draw and fix costs no model calls.
 */
export function structuralFindings(g: A4Graph, evidenceIds: Set<string>): Finding[] {
  const { issues } = validateGraph(placeEvents(g).graph, evidenceIds);
  return issues
    .filter((i) => i.severity === "blocking")
    .map((i) => ({
      code: STRUCT_PREFIX + i.code,
      severity: "blocking" as const,
      element_ids: i.element_ids,
      evidence_refs: [],
      rationale: `${i.message}. The diagram cannot be built as valid BPMN until this is fixed.`,
      suggested_change: STRUCT_FIX[i.code] ?? null,
    }));
}

/**
 * Makes a graph with structure errors safe to compile as a draft: drops repeated IDs and flows
 * with missing ends, and moves nodes in unknown lanes into an "Unassigned" lane. Errors that BPMN
 * can still draw (such as an end with outgoing flow) are left for the analyst to fix in the editor.
 */
export function draftable(g: A4Graph): { graph: A4Graph; dropped: string[] } {
  const seen = new Set<string>();
  const dropped: string[] = [];
  const firstOnly = <T extends { id: string }>(xs: T[]) =>
    xs.filter((x) => {
      if (seen.has(x.id)) {
        dropped.push(x.id);
        return false;
      }
      seen.add(x.id);
      return true;
    });
  const lanes = firstOnly(g.lanes);
  const laneIds = new Set(lanes.map((l) => l.id));
  let nodes = firstOnly(g.nodes);
  if (nodes.some((n) => !laneIds.has(n.lane_id))) {
    const id = "L_unassigned";
    lanes.push({ id, name: "Unassigned", evidence_refs: [] });
    nodes = nodes.map((n) => (laneIds.has(n.lane_id) ? n : { ...n, lane_id: id }));
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = firstOnly(g.edges).filter((e) => {
    const ok = nodeIds.has(e.source_id) && nodeIds.has(e.target_id);
    if (!ok) dropped.push(e.id);
    return ok;
  });
  const annotations = firstOnly(g.annotations).map((a) =>
    a.attached_element_id && !nodeIds.has(a.attached_element_id) ? { ...a, attached_element_id: null } : a,
  );
  return { graph: { ...g, lanes, nodes, edges, annotations }, dropped };
}
