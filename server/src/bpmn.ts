import type { A4Graph } from "./schemas.js";

// Deterministic graph → BPMN 2.0 XML with lanes and DI.
// Layout: each lane is a band of rows and the longest-path rank is the column. Edges are routed
// orthogonally; apart from short straight runs along an empty row or column, they travel through
// the gap after each column and the gutter under each row, which hold no shapes and give every
// edge its own track. Edge labels, gateway and event names and notes get explicit positions in
// space reserved for them, so bpmn-js does not stack them on top of shapes or lines.

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// BPMN IDs must be XML NCNames.
export const xid = (id: string) => {
  const clean = id.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(clean) ? clean : `_${clean}`;
};

type GNode = A4Graph["nodes"][number];
type GEdge = A4Graph["edges"][number];
export type Box = { x: number; y: number; w: number; h: number };
export type Pt = [number, number];

const SIZE = {
  task: { w: 120, h: 80 },
  exclusive_gateway: { w: 50, h: 50 },
  start: { w: 36, h: 36 },
  end: { w: 36, h: 36 },
} as const;
const CELL_W = 120; // every column is as wide as a task
const CELL_H = 80; // every row is as tall as a task
const LABEL_W = 90; // bpmn-js wraps external labels at 90px
const TRACK = 12; // spacing between parallel lines in one gap or gutter
const POOL_X = 40;
const POOL_Y = 40;
const LANE_HEADER = 30;

/** Estimated height of wrapped text, so the space we reserve matches what bpmn-js draws. */
function textHeight(text: string, width: number, charW: number, lineH: number): number {
  const perLine = Math.max(1, Math.floor(width / charW));
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (used > 0 && used + 1 + word.length <= perLine) {
      used += 1 + word.length;
      continue;
    }
    if (used > 0) lines++;
    lines += Math.ceil(word.length / perLine) - 1;
    used = ((word.length - 1) % perLine) + 1;
  }
  return lines * lineH;
}
const labelHeight = (t: string) => textHeight(t, LABEL_W, 6, 14) + 4;
const noteHeight = (t: string, width: number) => textHeight(t, width - 10, 6.2, 15) + 12;

function ranks(nodes: GNode[], edges: GEdge[]): Map<string, number> {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source_id, [...(out.get(e.source_id) ?? []), e.target_id]);

  // Find back edges with a DFS (starts first) so loops don't break the ranking.
  const back = new Set<string>();
  const state = new Map<string, "open" | "done">();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const next of out.get(id) ?? []) {
      if (state.get(next) === "open") back.add(`${id}->${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, "done");
  };
  const ordered = [...nodes].sort((a, b) => Number(b.type === "start") - Number(a.type === "start"));
  for (const n of ordered) if (!state.has(n.id)) visit(n.id);

  // Longest path over forward edges (Kahn's algorithm).
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const forward = edges.filter((e) => !back.has(`${e.source_id}->${e.target_id}`));
  for (const e of forward) indeg.set(e.target_id, indeg.get(e.target_id)! + 1);
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of forward.filter((f) => f.source_id === id)) {
      rank.set(e.target_id, Math.max(rank.get(e.target_id)!, rank.get(id)! + 1));
      indeg.set(e.target_id, indeg.get(e.target_id)! - 1);
      if (indeg.get(e.target_id) === 0) queue.push(e.target_id);
    }
  }
  return rank;
}

// A route leaves the source on one side, visits a sequence of channels and enters the target.
// gap k = the vertical channel right of column k; gutter r = the horizontal channel under row r.
type Channel = { kind: "gap" | "gutter"; index: number };
type Route = { exit: "right" | "bottom"; via: Channel[]; entry: "left" | "bottom" };
const gap = (index: number): Channel => ({ kind: "gap", index });
const gutter = (index: number): Channel => ({ kind: "gutter", index });
const channelKey = (c: Channel) => `${c.kind}:${c.index}`;

export type Layout = {
  pool: Box;
  lanes: Map<string, Box>;
  nodes: Map<string, Box>;
  nodeLabels: Map<string, Box>;
  edges: Map<string, Pt[]>;
  edgeLabels: Map<string, Box>;
  notes: Map<string, Box>;
  associations: Map<string, Pt[]>;
};

export function layoutGraph(g: A4Graph): Layout {
  const laneIds = new Set(g.lanes.map((l) => l.id));
  const nodes = g.nodes.filter((n) => laneIds.has(n.lane_id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = g.edges.filter((e) => byId.has(e.source_id) && byId.has(e.target_id));
  const flow = edges.filter((e) => e.source_id !== e.target_id);
  const isGateway = (id: string) => byId.get(id)!.type === "exclusive_gateway";

  // ---- grid: column = rank, row = (lane, slot) ----
  const rank = ranks(nodes, flow);
  const maxRank = Math.max(0, ...nodes.map((n) => rank.get(n.id)!));
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const preds = new Map<string, string[]>();
  for (const e of flow) preds.set(e.target_id, [...(preds.get(e.target_id) ?? []), e.source_id]);

  // Nodes sharing a lane and column are stacked. Order them by where their predecessors sit, then
  // merges first, so the main path keeps the top row and side branches drop below it.
  const cells = new Map<string, GNode[]>();
  for (const n of nodes) {
    const key = `${n.lane_id}|${rank.get(n.id)}`;
    cells.set(key, [...(cells.get(key) ?? []), n]);
  }
  const slot = new Map<string, number>();
  for (const members of [...cells.values()].sort((a, b) => rank.get(a[0].id)! - rank.get(b[0].id)!)) {
    const score = (n: GNode) => {
      const placed = (preds.get(n.id) ?? []).filter((p) => slot.has(p) && byId.get(p)!.lane_id === n.lane_id).map((p) => slot.get(p)!);
      return placed.length ? placed.reduce((a, b) => a + b, 0) / placed.length : 0;
    };
    members.sort(
      (a, b) => score(a) - score(b) || (preds.get(b.id)?.length ?? 0) - (preds.get(a.id)?.length ?? 0) || order.get(a.id)! - order.get(b.id)!,
    );
    members.forEach((n, i) => slot.set(n.id, i));
  }
  const laneRows = new Map(g.lanes.map((l) => [l.id, 1]));
  for (const n of nodes) laneRows.set(n.lane_id, Math.max(laneRows.get(n.lane_id)!, slot.get(n.id)! + 1));
  const laneFirstRow = new Map<string, number>();
  let rowCount = 0;
  for (const l of g.lanes) {
    laneFirstRow.set(l.id, rowCount);
    rowCount += laneRows.get(l.id)!;
  }
  const col = (id: string) => rank.get(id)!;
  const row = (id: string) => laneFirstRow.get(byId.get(id)!.lane_id)! + slot.get(id)!;
  const cellNode = new Map(nodes.map((n) => [`${col(n.id)}|${row(n.id)}`, n.id]));

  // ---- routing, in grid units: column c at x = c, gap k at k + 0.5, row r at y = r, gutter r at r + 0.5 ----
  type Run = { line: "row" | "col"; at: number; from: number; to: number; source: string; target: string };
  const runs: Run[] = []; // straight runs along a row or column line already taken by an edge
  const routes = new Map<string, Route>();
  const tracks = new Map<string, string[]>(); // channel → edge IDs, one track each
  const ports = new Map<string, Set<Route["exit"]>>();

  const gridPath = (e: GEdge, r: Route): Pt[] | null => {
    const pts: Pt[] = [[col(e.source_id), row(e.source_id)]];
    let horizontal = r.exit === "right";
    for (const ch of r.via) {
      const [x, y] = pts.at(-1)!;
      if ((ch.kind === "gap") !== horizontal) return null;
      pts.push(ch.kind === "gap" ? [ch.index + 0.5, y] : [x, ch.index + 0.5]);
      horizontal = !horizontal;
    }
    const [b, r2] = [col(e.target_id), row(e.target_id)];
    const [x, y] = pts.at(-1)!;
    if (r.entry === "left") {
      if (!horizontal) pts.push([x, r2]);
      else if (y !== r2) return null;
      pts.push([b, r2]);
    } else {
      if (!horizontal) return null;
      pts.push([b, y], [b, r2]);
    }
    // Leave moving right (or down), and arrive moving right (or up).
    const [p0, p1] = pts;
    const [q0, q1] = pts.slice(-2);
    if (r.exit === "right" ? p1[0] <= p0[0] : p1[1] <= p0[1]) return null;
    if (r.entry === "left" ? q1[0] <= q0[0] : q1[1] >= q0[1]) return null;
    return pts;
  };

  type LineRun = Omit<Run, "source" | "target"> & { first: boolean; last: boolean };
  const lineRuns = (pts: Pt[]): LineRun[] =>
    pts.slice(1).flatMap(([x2, y2], i): LineRun[] => {
      const [x1, y1] = pts[i];
      const ends = { first: i === 0, last: i === pts.length - 2 };
      if (y1 === y2 && Number.isInteger(y1)) return [{ line: "row", at: y1, from: Math.min(x1, x2), to: Math.max(x1, x2), ...ends }];
      if (x1 === x2 && Number.isInteger(x1)) return [{ line: "col", at: x1, from: Math.min(y1, y2), to: Math.max(y1, y2), ...ends }];
      return []; // inside a gap or gutter
    });

  const blocked = (e: GEdge, pts: Pt[]) => {
    const [s, t] = [pts[0], pts.at(-1)!];
    for (const run of lineRuns(pts)) {
      for (let k = Math.ceil(run.from); k <= Math.floor(run.to); k++) {
        const cell: Pt = run.line === "row" ? [k, run.at] : [run.at, k];
        const own = (run.first && cell[0] === s[0] && cell[1] === s[1]) || (run.last && cell[0] === t[0] && cell[1] === t[1]);
        if (!own && cellNode.has(`${cell[0]}|${cell[1]}`)) return true;
      }
      // Sharing a line is fine for a fork (same source) or a merge (same target), never otherwise.
      const clash = runs.some(
        (o) => o.line === run.line && o.at === run.at && run.from < o.to && o.from < run.to && o.source !== e.source_id && o.target !== e.target_id,
      );
      if (clash) return true;
    }
    return false;
  };

  const tryRoutes = (e: GEdge, options: Route[], onePerGatewayPort: boolean) => {
    for (const r of options) {
      if (onePerGatewayPort && isGateway(e.source_id) && ports.get(e.source_id)?.has(r.exit)) continue;
      const pts = gridPath(e, r);
      if (!pts || blocked(e, pts)) continue;
      routes.set(e.id, r);
      ports.set(e.source_id, new Set([...(ports.get(e.source_id) ?? []), r.exit]));
      for (const run of lineRuns(pts)) runs.push({ ...run, source: e.source_id, target: e.target_id });
      for (const ch of r.via) tracks.set(channelKey(ch), [...(tracks.get(channelKey(ch)) ?? []), e.id]);
      return true;
    }
    return false;
  };

  const straight: Route = { exit: "right", via: [], entry: "left" };
  const options = (e: GEdge): Route[] => {
    const [a, r1, b, r2] = [col(e.source_id), row(e.source_id), col(e.target_id), row(e.target_id)];
    const out: Route[] = [];
    if (b > a) {
      const gaps = [...new Set([b - 1, a, ...Array.from({ length: b - a }, (_, i) => a + i)])];
      out.push(straight);
      if (isGateway(e.source_id)) out.push({ exit: "bottom", via: [], entry: "left" }); // down, then right
      for (const k of gaps) out.push({ exit: "right", via: [gap(k)], entry: "left" });
      if (isGateway(e.source_id)) for (const k of gaps) out.push({ exit: "bottom", via: [gutter(r1), gap(k)], entry: "left" });
    }
    out.push({ exit: "bottom", via: [gutter(r1)], entry: "bottom" }); // under the row, back up into the target
    out.push({ exit: "right", via: [gap(a), gutter(r2)], entry: "bottom" });
    out.push({ exit: "bottom", via: [gutter(r1), gap(a), gutter(r2)], entry: "bottom" });
    return out;
  };

  // Straight lines first so the main path stays straight, then everything else left to right.
  for (const e of flow) tryRoutes(e, [straight], true);
  const rest = flow.filter((e) => !routes.has(e.id)).sort((x, y) => col(x.source_id) - col(y.source_id));
  for (const e of rest) {
    if (tryRoutes(e, options(e), true) || tryRoutes(e, options(e), false)) continue;
    const fallback: Route = { exit: "right", via: [gap(col(e.source_id)), gutter(row(e.target_id))], entry: "bottom" };
    routes.set(e.id, fallback);
    for (const ch of fallback.via) tracks.set(channelKey(ch), [...(tracks.get(channelKey(ch)) ?? []), e.id]);
  }
  const trackCount = (c: Channel) => tracks.get(channelKey(c))?.length ?? 0;
  const trackIndex = (c: Channel, id: string) => tracks.get(channelKey(c))!.indexOf(id);

  // ---- reserve space for labels ----
  const exitOffset = (n: GNode) => (n.type === "exclusive_gateway" ? 24 : 6); // clear of the gateway's own name
  const rowTop = new Array<number>(rowCount).fill(0); // room above the shapes in a row
  const gutterLabel = new Array<number>(rowCount).fill(0); // room at the top of a gutter
  const gapLabel = new Map<number, number>(); // room at the left of a gap
  const grow = (arr: number[], i: number, v: number) => (arr[i] = Math.max(arr[i], v));
  for (const n of nodes) {
    const { h } = SIZE[n.type];
    if (n.type === "exclusive_gateway") grow(rowTop, row(n.id), labelHeight(n.label) + 6 - (CELL_H - h) / 2);
    if (n.type === "start" || n.type === "end") grow(gutterLabel, row(n.id), h / 2 + 4 + labelHeight(n.label) - CELL_H / 2);
  }
  // Branches that leave by the same side share a trunk, so labels at the exit would stack on each
  // other over a line they all use. Label those where they enter their target instead, in a zone at
  // the right of the gap before it (past the tracks), where the line belongs to that branch alone.
  const exitKey = (e: GEdge) => `${e.source_id}|${routes.get(e.id)!.exit}`;
  const exitCount = new Map<string, number>();
  for (const e of flow) exitCount.set(exitKey(e), (exitCount.get(exitKey(e)) ?? 0) + 1);
  const atEntry = new Set<string>();
  const entryGaps = new Set<number>();
  const entryTargets = new Set<string>();
  for (const e of flow) {
    if (!e.label?.trim() || routes.get(e.id)!.entry !== "left" || exitCount.get(exitKey(e))! < 2 || entryTargets.has(e.target_id)) continue;
    atEntry.add(e.id);
    entryTargets.add(e.target_id);
    entryGaps.add(col(e.target_id) - 1);
    grow(rowTop, row(e.target_id), labelHeight(e.label) + 4 - CELL_H / 2);
  }
  for (const e of flow) {
    if (!e.label?.trim() || atEntry.has(e.id)) continue;
    const n = byId.get(e.source_id)!;
    const { w, h } = SIZE[n.type];
    const lh = labelHeight(e.label);
    const c = col(n.id);
    if (routes.get(e.id)!.exit === "right") {
      grow(rowTop, row(n.id), lh + 4 - CELL_H / 2);
      gapLabel.set(c, Math.max(gapLabel.get(c) ?? 0, w / 2 + exitOffset(n) + LABEL_W + 8 - CELL_W / 2));
    } else {
      grow(gutterLabel, row(n.id), h / 2 + 4 + lh - CELL_H / 2);
      gapLabel.set(c, Math.max(gapLabel.get(c) ?? 0, 6 + LABEL_W + 8 - CELL_W / 2));
    }
  }
  const gapLabelW = (k: number) => Math.max(gapLabel.get(k) ?? 0, 24);
  const gapW = (k: number) => gapLabelW(k) + 8 + trackCount(gap(k)) * TRACK + 16 + (entryGaps.has(k) ? LABEL_W + 8 : 0);
  const gutterLabelH = (r: number) => Math.max(gutterLabel[r], 0);
  const gutterH = (r: number) => gutterLabelH(r) + 10 + trackCount(gutter(r)) * TRACK + 14;

  // ---- columns ----
  const left = POOL_X + LANE_HEADER;
  const colX: number[] = [];
  let x = left + gapW(-1);
  for (let c = 0; c <= maxRank; c++) {
    colX[c] = x;
    x += CELL_W + gapW(c);
  }
  const gapX = (k: number) => (k < 0 ? left : colX[k] + CELL_W);
  const trackX = (k: number, i: number) => gapX(k) + gapLabelW(k) + 8 + i * TRACK + TRACK / 2;

  // ---- notes sit in a band at the top of their lane, in the column of the shape they describe ----
  // A note spans its column and the label zone of the gap after it, so it stays clear of the edge
  // tracks on both sides. Several notes in one column stack; unattached notes go to column 0 of lane 1.
  const noteTarget = (a: A4Graph["annotations"][number]) => (a.attached_element_id ? byId.get(a.attached_element_id) : undefined);
  const noteLane = (a: A4Graph["annotations"][number]) => noteTarget(a)?.lane_id ?? g.lanes[0]?.id;
  const noteCol = (a: A4Graph["annotations"][number]) => {
    const t = noteTarget(a);
    return t ? col(t.id) : 0;
  };
  const NOTE_INSET = 14; // strip on the left of the column where association lines run down
  const noteW = (c: number) => CELL_W + gapLabelW(c) - NOTE_INSET;
  const noteStack = new Map<string, { offset: number; index: number }>();
  const noteBand = new Map<string, number>();
  for (const l of g.lanes) {
    const height = new Map<number, number>();
    const count = new Map<number, number>();
    for (const a of g.annotations.filter((n) => noteLane(n) === l.id)) {
      const c = noteCol(a);
      noteStack.set(a.id, { offset: height.get(c) ?? 0, index: count.get(c) ?? 0 });
      height.set(c, (height.get(c) ?? 0) + noteHeight(a.text, noteW(c)) + 8);
      count.set(c, (count.get(c) ?? 0) + 1);
    }
    noteBand.set(l.id, height.size ? Math.max(...height.values()) + 16 : 0);
  }
  const right = x + 20;

  // ---- rows and lanes ----
  const rowY: number[] = [];
  const gutterY: number[] = [];
  const lanes = new Map<string, Box>();
  let y = POOL_Y;
  for (const l of g.lanes) {
    const top = y;
    y += noteBand.get(l.id)!;
    for (let r = laneFirstRow.get(l.id)!; r < laneFirstRow.get(l.id)! + laneRows.get(l.id)!; r++) {
      y += Math.max(rowTop[r], 0) + 12;
      rowY[r] = y;
      y += CELL_H;
      gutterY[r] = y;
      y += gutterH(r);
    }
    lanes.set(l.id, { x: left, y: top, w: right - left, h: y - top });
  }
  const pool: Box = { x: POOL_X, y: POOL_Y, w: right - POOL_X, h: y - POOL_Y };
  const trackY = (r: number, i: number) => gutterY[r] + gutterLabelH(r) + 10 + i * TRACK + TRACK / 2;

  // ---- shapes and their names ----
  const boxes = new Map<string, Box>();
  const nodeLabels = new Map<string, Box>();
  for (const n of nodes) {
    const { w, h } = SIZE[n.type];
    const cx = colX[col(n.id)] + CELL_W / 2;
    const cy = rowY[row(n.id)] + CELL_H / 2;
    boxes.set(n.id, { x: cx - w / 2, y: cy - h / 2, w, h });
    const lh = labelHeight(n.label);
    if (n.type === "exclusive_gateway") nodeLabels.set(n.id, { x: cx - LABEL_W / 2, y: cy - h / 2 - 6 - lh, w: LABEL_W, h: lh });
    if (n.type === "start" || n.type === "end") nodeLabels.set(n.id, { x: cx - LABEL_W / 2, y: cy + h / 2 + 4, w: LABEL_W, h: lh });
  }
  const mid = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2];

  // ---- edges ----
  const edgePts = new Map<string, Pt[]>();
  const edgeLabels = new Map<string, Box>();
  for (const e of edges) {
    const s = boxes.get(e.source_id)!;
    const t = boxes.get(e.target_id)!;
    const [scx, scy] = mid(s);
    const [tcx, tcy] = mid(t);
    const r = routes.get(e.id);
    let pts: Pt[];
    if (!r) {
      // Self loop: out of the right side, round underneath, back into the bottom.
      pts = [[s.x + s.w, scy], [s.x + s.w + 20, scy], [s.x + s.w + 20, s.y + s.h + 20], [scx, s.y + s.h + 20], [scx, s.y + s.h]];
    } else {
      pts = [r.exit === "right" ? [s.x + s.w, scy] : [scx, s.y + s.h]];
      let horizontal = r.exit === "right";
      for (const ch of r.via) {
        const [px, py] = pts.at(-1)!;
        pts.push(ch.kind === "gap" ? [trackX(ch.index, trackIndex(ch, e.id)), py] : [px, trackY(ch.index, trackIndex(ch, e.id))]);
        horizontal = !horizontal;
      }
      const [px, py] = pts.at(-1)!;
      if (r.entry === "left") {
        if (!horizontal) pts.push([px, tcy]);
        pts.push([t.x, tcy]);
      } else {
        // Into the bottom; tasks take it left of centre so it can't meet the task's own bottom exit.
        const ex = byId.get(e.target_id)!.type === "task" ? tcx - 20 : tcx;
        pts.push([ex, py], [ex, t.y + t.h]);
      }
    }
    edgePts.set(e.id, pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]));

    if (e.label?.trim()) {
      const n = byId.get(e.source_id)!;
      const lh = labelHeight(e.label);
      edgeLabels.set(
        e.id,
        atEntry.has(e.id)
          ? { x: colX[col(e.target_id)] - 4 - LABEL_W, y: tcy - 4 - lh, w: LABEL_W, h: lh }
          : !r || r.exit === "right"
          ? { x: s.x + s.w + exitOffset(n), y: scy - 4 - lh, w: LABEL_W, h: lh }
          : { x: scx + 6, y: s.y + s.h + 4, w: LABEL_W, h: lh },
      );
    }
  }

  // ---- notes ----
  const notes = new Map<string, Box>();
  const associations = new Map<string, Pt[]>();
  for (const a of g.annotations) {
    const laneId = noteLane(a);
    if (!laneId) continue;
    const c = noteCol(a);
    const { offset, index } = noteStack.get(a.id)!;
    const b = { x: colX[c] + NOTE_INSET, y: lanes.get(laneId)!.y + 12 + offset, w: noteW(c), h: noteHeight(a.text, noteW(c)) };
    notes.set(a.id, b);
    const target = noteTarget(a);
    const t = target && boxes.get(target.id);
    if (!target || !t) continue;
    // Out of the note's left side, down the strip, into the shape: the top edge of a task, the
    // free left side of a start event, otherwise the top point.
    const sx = colX[c] + 3 + index * 4;
    const mid = b.y + b.h / 2;
    const end: Pt[] =
      target.type === "task" ? [[sx, t.y]] : target.type === "start" ? [[sx, t.y + t.h / 2], [t.x, t.y + t.h / 2]] : [[sx, t.y - 8], [t.x + t.w / 2, t.y]];
    associations.set(a.id, [[b.x, mid], [sx, mid], ...end]);
  }

  return { pool, lanes, nodes: boxes, nodeLabels, edges: edgePts, edgeLabels, notes, associations };
}

const bounds = (b: Box) => `<dc:Bounds x="${Math.round(b.x)}" y="${Math.round(b.y)}" width="${Math.round(b.w)}" height="${Math.round(b.h)}" />`;
const labelDi = (b: Box | undefined) => (b ? `\n        <bpmndi:BPMNLabel>\n          ${bounds(b)}\n        </bpmndi:BPMNLabel>` : "");
const waypoints = (pts: Pt[]) => pts.map(([x, y]) => `        <di:waypoint x="${Math.round(x)}" y="${Math.round(y)}" />`).join("\n");

export function compileBpmn(g: A4Graph): string {
  const layout = layoutGraph(g);
  const tag = { start: "startEvent", end: "endEvent", task: "task", exclusive_gateway: "exclusiveGateway" } as const;
  const procId = "Process_1";

  const laneXml = g.lanes
    .map(
      (l) =>
        `      <bpmn:lane id="${xid(l.id)}" name="${esc(l.name)}">\n` +
        g.nodes.filter((n) => n.lane_id === l.id).map((n) => `        <bpmn:flowNodeRef>${xid(n.id)}</bpmn:flowNodeRef>\n`).join("") +
        `      </bpmn:lane>`,
    )
    .join("\n");

  const nodeXml = g.nodes
    .map((n) => {
      const ins = g.edges.filter((e) => e.target_id === n.id).map((e) => `      <bpmn:incoming>${xid(e.id)}</bpmn:incoming>\n`).join("");
      const outs = g.edges.filter((e) => e.source_id === n.id).map((e) => `      <bpmn:outgoing>${xid(e.id)}</bpmn:outgoing>\n`).join("");
      const doc = `      <bpmn:documentation>evidence: ${esc(n.evidence_refs.join(", ") || "none")}; origin: ${n.origin}</bpmn:documentation>\n`;
      return `    <bpmn:${tag[n.type]} id="${xid(n.id)}" name="${esc(n.label)}">\n${doc}${ins}${outs}    </bpmn:${tag[n.type]}>`;
    })
    .join("\n");

  const edgeXml = g.edges
    .map(
      (e) =>
        `    <bpmn:sequenceFlow id="${xid(e.id)}" sourceRef="${xid(e.source_id)}" targetRef="${xid(e.target_id)}"${e.label ? ` name="${esc(e.label)}"` : ""} />`,
    )
    .join("\n");

  const annXml = g.annotations
    .map((a) => {
      const text = `    <bpmn:textAnnotation id="${xid(a.id)}">\n      <bpmn:text>${esc(a.text)}</bpmn:text>\n    </bpmn:textAnnotation>`;
      const assoc = layout.associations.has(a.id)
        ? `\n    <bpmn:association id="${xid(a.id)}_assoc" sourceRef="${xid(a.attached_element_id!)}" targetRef="${xid(a.id)}" />`
        : "";
      return text + assoc;
    })
    .join("\n");

  // ---- Diagram interchange ----
  const di: string[] = [];
  di.push(`      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true">\n        ${bounds(layout.pool)}\n      </bpmndi:BPMNShape>`);
  for (const l of g.lanes) {
    const b = layout.lanes.get(l.id)!;
    di.push(`      <bpmndi:BPMNShape id="${xid(l.id)}_di" bpmnElement="${xid(l.id)}" isHorizontal="true">\n        ${bounds(b)}\n      </bpmndi:BPMNShape>`);
  }
  for (const n of g.nodes) {
    const b = layout.nodes.get(n.id);
    if (!b) continue;
    const marker = n.type === "exclusive_gateway" ? ` isMarkerVisible="true"` : "";
    di.push(
      `      <bpmndi:BPMNShape id="${xid(n.id)}_di" bpmnElement="${xid(n.id)}"${marker}>\n        ${bounds(b)}${labelDi(layout.nodeLabels.get(n.id))}\n      </bpmndi:BPMNShape>`,
    );
  }
  for (const e of g.edges) {
    const pts = layout.edges.get(e.id);
    if (!pts) continue;
    di.push(
      `      <bpmndi:BPMNEdge id="${xid(e.id)}_di" bpmnElement="${xid(e.id)}">\n${waypoints(pts)}${labelDi(layout.edgeLabels.get(e.id))}\n      </bpmndi:BPMNEdge>`,
    );
  }
  for (const a of g.annotations) {
    const b = layout.notes.get(a.id);
    if (!b) continue;
    di.push(`      <bpmndi:BPMNShape id="${xid(a.id)}_di" bpmnElement="${xid(a.id)}">\n        ${bounds(b)}\n      </bpmndi:BPMNShape>`);
    const assoc = layout.associations.get(a.id);
    if (assoc) di.push(`      <bpmndi:BPMNEdge id="${xid(a.id)}_assoc_di" bpmnElement="${xid(a.id)}_assoc">\n${waypoints(assoc)}\n      </bpmndi:BPMNEdge>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn" exporter="agent-orchestrator" exporterVersion="0.1">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:documentation>AI-generated DRAFT. Simplified responsibility view; requires human review. Not an approved procedure.</bpmn:documentation>
    <bpmn:participant id="Participant_1" name="${esc(g.title)}" processRef="${procId}" />
  </bpmn:collaboration>
  <bpmn:process id="${procId}" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
${laneXml}
    </bpmn:laneSet>
${nodeXml}
${edgeXml}
${annXml}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">
${di.join("\n")}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
