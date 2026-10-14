// Helpers for the BPMN diagram page and editor.
import type { A4Graph, Issue, JobView } from "./types";

// Same ID cleaning as the server's compiler (server/src/bpmn.ts xid).
export const xid = (id: string) => {
  const clean = id.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(clean) ? clean : `_${clean}`;
};

/** Save text or a data: URL as a file. */
export function download(content: string, filename: string, type: string) {
  const url = content.startsWith("data:") ? content : URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  if (url !== content) URL.revokeObjectURL(url);
}

/** Validation (V..) and draft errors: what keeps a draft from being a valid diagram. */
export const draftErrors = (result: NonNullable<JobView["result"]>): Issue[] =>
  result.draft ? result.issues.filter((i) => i.severity === "blocking" && /^(V\d\d_|DRAFT_)/.test(i.code)) : [];

export const diagramHref = (jobId: string) => `/jobs/${jobId}/diagram`;

/**
 * Where an issue sits on the diagram. "element": it names graph elements directly. "evidence": it
 * names claims from earlier steps (merged or renamed before the graph was drawn), so point at the
 * graph steps that cite the same source evidence instead. "none": nothing on the diagram matches.
 */
export type IssueTarget = { kind: "element" | "evidence" | "none"; ids: string[] };

export function issueTarget(issue: Issue, graph: A4Graph | null): IssueTarget {
  if (!graph) return { kind: "none", ids: [] };
  const onGraph = new Set([
    ...graph.lanes.map((l) => l.id),
    ...graph.nodes.map((n) => n.id),
    ...graph.edges.map((e) => e.id),
    ...graph.annotations.map((a) => a.id),
  ]);
  const direct = issue.element_ids.filter((id) => onGraph.has(id));
  if (direct.length) return { kind: "element", ids: direct };
  const refs = new Set(issue.evidence_refs);
  const citing = refs.size ? graph.nodes.filter((n) => n.evidence_refs.some((r) => refs.has(r))).map((n) => n.id) : [];
  return citing.length ? { kind: "evidence", ids: citing } : { kind: "none", ids: [] };
}
