import type { A3Patch, A3Refined, A4Graph, A4Patch } from "./schemas.js";

type WithId = { id: string };

/**
 * Apply an A3 claim-audit patch to the refined claims (deterministic code, never a model).
 * Removal wins over upsert. Relations whose endpoint was removed go too, and the upstream IDs of a
 * removed claim are recorded as dropped, so check_refine still accounts for every upstream item.
 */
export function applyClaimPatch(r: A3Refined, p: A3Patch): { refined: A3Refined; summary: string } {
  const removed = new Set(p.remove_ids);
  let added = 0;
  let updated = 0;
  const upsert = <T extends WithId>(list: T[], items: T[]): T[] => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const existing = new Set(list.map((x) => x.id));
    const out = list.filter((x) => !removed.has(x.id)).map((x) => byId.get(x.id) ?? x);
    for (const i of items) {
      if (removed.has(i.id)) continue;
      if (existing.has(i.id)) updated++;
      else {
        added++;
        out.push(i);
      }
    }
    return out;
  };

  const before = new Map(r.claims.map((c) => [c.id, c]));
  // A changed claim keeps its upstream links and original wording; an added one quotes its own label.
  const claimsIn = p.upsert_claims.map((c) => {
    const old = before.get(c.id);
    return { ...c, from_ids: c.from_ids.length ? c.from_ids : old?.from_ids ?? [], source_label: old?.source_label ?? c.label };
  });
  const actors = upsert(r.actors, p.upsert_actors);
  const claims = upsert(r.claims, claimsIn).map((c) => (c.actor_id && removed.has(c.actor_id) ? { ...c, actor_id: null } : c));
  const upsertedRelations = upsert(r.relations, p.upsert_relations);
  const relations = upsertedRelations.filter((x) => !removed.has(x.from) && !removed.has(x.to));
  const orphaned = upsertedRelations.length - relations.length;

  const droppedUpstream = r.claims.filter((c) => removed.has(c.id) && c.from_ids.length);
  const changes = [
    ...r.changes,
    ...p.changes,
    ...droppedUpstream.map((c) => ({ type: "dropped" as const, upstream_ids: c.from_ids, result_id: null, reason: `claim audit removed ${c.id}` })),
  ];
  const removedCount = [...r.actors, ...r.claims, ...r.relations].filter((x) => removed.has(x.id)).length + orphaned;
  return {
    refined: { actors, claims, relations, changes, issues: [...r.issues, ...p.issues] },
    summary: `audit: ${added} added, ${updated} updated, ${removedCount} removed`,
  };
}

/**
 * Apply an A4 repair patch to the current graph (deterministic code, never a model).
 * Removal wins over upsert for the same ID. Edges whose endpoint the patch removed are removed too,
 * and annotations attached to a removed element are detached.
 */
export function applyPatch(g: A4Graph, p: A4Patch): { graph: A4Graph; changedIds: string[]; summary: string } {
  const removed = new Set(p.remove_ids);
  let added = 0;
  let updated = 0;

  const upsert = <T extends WithId>(list: T[], items: T[]): T[] => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const existing = new Set(list.map((x) => x.id));
    const out = list.filter((x) => !removed.has(x.id)).map((x) => byId.get(x.id) ?? x);
    for (const i of items) {
      if (removed.has(i.id)) continue;
      if (existing.has(i.id)) updated++;
      else {
        added++;
        out.push(i);
      }
    }
    return out;
  };

  const lanes = upsert(g.lanes, p.upsert_lanes);
  const nodes = upsert(g.nodes, p.upsert_nodes);
  const upsertedEdges = upsert(g.edges, p.upsert_edges);
  const orphaned = upsertedEdges.filter((e) => removed.has(e.source_id) || removed.has(e.target_id)).map((e) => e.id);
  const edges = upsertedEdges.filter((e) => !orphaned.includes(e.id));
  const annotations = upsert(g.annotations, p.upsert_annotations).map((a) =>
    a.attached_element_id && removed.has(a.attached_element_id) ? { ...a, attached_element_id: null } : a,
  );

  const allIds = new Set([...g.lanes, ...g.nodes, ...g.edges, ...g.annotations].map((x) => x.id));
  const removedCount = [...removed].filter((id) => allIds.has(id)).length + orphaned.length;
  const changedIds = [
    ...new Set([
      ...[p.upsert_lanes, p.upsert_nodes, p.upsert_edges, p.upsert_annotations].flat().map((x) => x.id),
      ...removed,
      ...orphaned,
    ]),
  ];

  return {
    graph: { title: p.title ?? g.title, lanes, nodes, edges, annotations, issues: p.issues ?? g.issues },
    changedIds,
    summary: `patch: ${added} added, ${updated} updated, ${removedCount} removed`,
  };
}
