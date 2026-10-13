import { z } from "zod";

// Each agent allocates IDs in its own namespace so outputs never collide.
const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[A-Za-z0-9_-]*$`), `must start with "${prefix}"`).max(128);

const refs = z.array(z.string()).describe("evidence IDs from the supplied manifest, e.g. E3 or IMG1");

// Defaults keep model output short: the model may leave these fields out, and parsing fills
// them in, so code downstream always sees complete objects. Prompts show the input-side schema.
const origin = z.enum(["source_extracted", "inferred"]).default("source_extracted").describe('omit unless "inferred"');
const optRefs = refs.default([]);
const optIds = z.array(z.string()).default([]);
const opt = <T extends z.ZodType>(t: T) => t.nullable().default(null);
const optList = <T extends z.ZodType>(t: T) => t.default([] as never);

export const Issue = z.object({
  code: z.string().describe("e.g. OWNER_UNKNOWN, SOURCE_CONFLICT, SOURCE_INCOMPLETE, CONNECTOR_UNCERTAIN, TEXT_UNREADABLE, INFERRED_RELATION"),
  severity: z.enum(["blocking", "review", "info"]),
  message: z.string().max(2000),
  element_ids: optIds,
  evidence_refs: optRefs,
});
export type Issue = z.infer<typeof Issue>;

// A1 Text Extractor
export const A1Output = z.object({
  actors: z.array(z.object({ id: id("T"), name: z.string(), evidence_refs: refs })),
  claims: z.array(
    z.object({
      id: id("T"),
      kind: z.enum(["action", "decision", "start", "end", "note"]),
      label: z.string().max(500),
      actor_id: opt(z.string()),
      evidence_refs: refs,
      origin,
    }),
  ),
  relations: z.array(
    z.object({
      id: id("T"),
      from: z.string(),
      to: z.string(),
      condition: opt(z.string()),
      evidence_refs: refs,
      origin,
    }),
  ),
  issues: optList(z.array(Issue)),
});
export type A1Output = z.infer<typeof A1Output>;

// A2 Diagram Interpreter
export const A2Output = z.object({
  lanes: z.array(z.object({ id: id("D"), name: z.string(), evidence_refs: refs })),
  shapes: z.array(
    z.object({
      id: id("D"),
      kind: z.enum(["task", "decision", "start", "end", "note", "unknown"]),
      label: opt(z.string()),
      lane_id: opt(z.string()),
      evidence_refs: refs,
    }),
  ),
  connectors: z.array(
    z.object({
      id: id("D"),
      from: opt(z.string()),
      to: opt(z.string()),
      label: opt(z.string()),
      direction: z.enum(["known", "unknown"]),
      evidence_refs: refs,
    }),
  ),
  continuations: optList(
    z.array(
      z.object({
        id: id("D"),
        label: z.string(),
        target_page: opt(z.string()),
        attached_shape_id: opt(z.string()),
        evidence_refs: refs,
      }),
    ),
  ),
  issues: optList(z.array(Issue)),
});
export type A2Output = z.infer<typeof A2Output>;

// A3 Extraction Refiner. The model does not repeat the original wording: graph.ts restores
// source_label from the upstream items in from_ids (A3Output → A3Refined).
export const A3Output = z.object({
  actors: z.array(
    z.object({ id: id("R"), name: z.string(), aliases: optList(z.array(z.string())), evidence_refs: refs }),
  ),
  claims: z.array(
    z.object({
      id: id("R"),
      kind: z.enum(["action", "decision", "start", "end", "note", "continuation"]),
      label: z.string().max(500).describe("short verb-object wording"),
      actor_id: opt(z.string()),
      from_ids: z.array(z.string()).describe("A1 claim / A2 shape / A2 continuation IDs this claim came from"),
      evidence_refs: refs,
      origin,
    }),
  ),
  relations: z.array(
    z.object({
      id: id("R"),
      from: z.string(),
      to: z.string(),
      condition: opt(z.string()),
      evidence_refs: refs,
      origin,
    }),
  ),
  changes: optList(
    z.array(
      z.object({
        // added / retyped come from the claim audit (A3_PATCH), not from refining.
        type: z.enum(["merged", "linked", "relabelled", "actor_merged", "flagged", "dropped", "added", "retyped"]),
        upstream_ids: z.array(z.string()),
        result_id: opt(z.string()),
        reason: z.string(),
      }),
    ),
  ),
  issues: optList(z.array(Issue)),
});
export type A3Output = z.infer<typeof A3Output>;
export type A3Refined = Omit<A3Output, "claims"> & {
  claims: (A3Output["claims"][number] & { source_label: string })[];
};

// A3 in audit mode checks the refined claims against the source before the graph is drawn and
// returns a patch of the fixes, like the A4 repair patch. Code applies it (patch.ts).
const claimUpsert = "claims, relations or actors to add, or to replace in full when the ID already exists";
export const A3Patch = z.object({
  upsert_actors: optList(A3Output.shape.actors).describe(claimUpsert),
  upsert_claims: optList(
    z.array(A3Output.shape.claims.element.extend({ from_ids: optIds.describe("upstream IDs; omit for a claim the audit adds") })),
  ).describe(claimUpsert),
  upsert_relations: optList(A3Output.shape.relations).describe(claimUpsert),
  remove_ids: optIds.describe("IDs of duplicate or contradicted claims, relations or actors to delete"),
  changes: A3Output.shape.changes.describe("one entry per fix, with a short reason"),
  issues: optList(z.array(Issue)).describe("new issues only; existing ones are kept"),
});
export type A3Patch = z.infer<typeof A3Patch>;

// A4 Graph Composer
export const A4Graph = z.object({
  title: z.string(),
  lanes: z.array(z.object({ id: id("L"), name: z.string(), evidence_refs: refs })),
  nodes: z.array(
    z.object({
      id: id("N"),
      type: z.enum(["start", "end", "task", "exclusive_gateway"]),
      label: z.string().max(500),
      lane_id: z.string(),
      evidence_refs: refs,
      origin,
    }),
  ),
  edges: z.array(
    z.object({
      id: id("F"),
      source_id: z.string(),
      target_id: z.string(),
      label: opt(z.string()),
      evidence_refs: refs,
      origin,
    }),
  ),
  annotations: optList(
    z.array(
      z.object({
        id: id("A"),
        text: z.string(),
        attached_element_id: opt(z.string()),
        evidence_refs: refs,
      }),
    ),
  ),
  issues: optList(z.array(Issue)),
});
export type A4Graph = z.infer<typeof A4Graph>;

// A4 in repair mode returns a patch instead of a whole graph, so a repair costs about as much
// as its fixes. Code applies it (patch.ts).
const upsert = "elements to add, or to replace in full when the ID already exists";
const lanes = A4Graph.shape.lanes;
const nodes = A4Graph.shape.nodes;
const edges = A4Graph.shape.edges;
const annotations = A4Graph.shape.annotations.unwrap();
export const A4Patch = z.object({
  title: opt(z.string()).describe("new graph title; omit to keep the current one"),
  upsert_lanes: optList(lanes).describe(upsert),
  upsert_nodes: optList(nodes).describe(upsert),
  upsert_edges: optList(edges).describe(upsert),
  upsert_annotations: optList(annotations).describe(upsert),
  remove_ids: optIds.describe("IDs of lanes, nodes, edges or annotations to delete"),
  issues: opt(z.array(Issue)).describe("the full updated list of open graph issues; omit to keep the current list"),
});
export type A4Patch = z.infer<typeof A4Patch>;

// A5 Evidence Critic
export const A5Critique = z.object({
  findings: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["blocking", "review", "info"]),
      element_ids: z.array(z.string()),
      evidence_refs: refs,
      rationale: z.string().max(2000),
      suggested_change: opt(z.string()),
    }),
  ),
  review_complete: z.boolean(),
});
export type A5Critique = z.infer<typeof A5Critique>;

export type Role = "A1" | "A2" | "A3" | "A4" | "A5";

export const ROLE_SCHEMAS = {
  A1: A1Output,
  A2: A2Output,
  A3: A3Output,
  A4: A4Graph,
  A5: A5Critique,
} as const;

// What a single agent call returns: a role's normal output, A3's claim-audit patch or A4's repair patch.
export const OUTPUT_SCHEMAS = { ...ROLE_SCHEMAS, A3_PATCH: A3Patch, A4_PATCH: A4Patch } as const;
export type OutputKind = keyof typeof OUTPUT_SCHEMAS;
export type Finding = A5Critique["findings"][number];

export const ROLE_NAMES: Record<Role, string> = {
  A1: "Text Extractor",
  A2: "Diagram Interpreter",
  A3: "Extraction Refiner",
  A4: "Graph Composer",
  A5: "Evidence Critic",
};

// Evidence is produced by deterministic code, never by a model.
export type Evidence =
  | { id: string; kind: "text"; source: string; page: number | null; text: string }
  | { id: string; kind: "image"; source: string; page: number | null; mime: string; base64: string };

export type TraceEntry = {
  role: Role | "system";
  step: string;
  provider: string;
  model: string | null;
  ms: number;
  ok: boolean;
  note?: string;
};
