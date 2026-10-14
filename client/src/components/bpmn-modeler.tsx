"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BpmnModeler from "bpmn-js/lib/Modeler";
import { DownloadIcon, ImageIcon, Maximize2Icon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { download, xid } from "@/lib/diagram";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

type Box = { x: number; y: number; width: number; height: number };
type Canvas = {
  zoom: (level: "fit-viewport" | number, center?: "auto") => number;
  viewbox: (box?: Box) => Box;
  getSize: () => { width: number; height: number };
  addMarker: (id: string, marker: string) => void;
  removeMarker: (id: string, marker: string) => void;
  getLayer: (name: string, index?: number) => SVGGElement;
  resized: () => void;
};
type DiagramElement = Partial<Box> & {
  id: string;
  type?: string;
  waypoints?: { x: number; y: number }[];
  labelTarget?: DiagramElement;
  incoming?: DiagramElement[];
  outgoing?: DiagramElement[];
};
type ElementRegistry = { get: (id: string) => DiagramElement | undefined; getAll: () => DiagramElement[] };
type EventBus = {
  on: (event: string, cb: (e: { element: DiagramElement }) => void) => void;
  off: (event: string, cb: (e: { element: DiagramElement }) => void) => void;
};

/** Canvas markers per graph element ID (painted with the CSS in globals.css). */
export type Markers = { error?: string[]; review?: string[] };

const FOCUS = "is-focused";
const DIMMED = "is-dimmed";
const FOCUS_LANE = "is-focus-lane";
const HIGHLIGHT_LAYER = "issue-highlight";
/** Highlight box colours per issue state, matching the issue pills (uob-red, warn, brand, ok). */
export type FocusTone = "blocking" | "review" | "info" | "complete";
const TONE_COLOUR: Record<FocusTone, string> = {
  blocking: "#d7262e",
  review: "#b86e00",
  info: "#2b4ea2",
  complete: "#1e8e5a",
};
const SVG_NS = "http://www.w3.org/2000/svg";
// Containers stay at full strength while the rest of the diagram fades around a focused issue.
const CONTAINERS = new Set(["bpmn:Participant", "bpmn:Lane", "bpmn:Collaboration", "bpmn:Process"]);
const MAX_FOCUS_ZOOM = 1.4;
const FOCUS_PADDING = 60;

/** The diagram area covered by some elements (shapes by bounds, flows by waypoints), plus padding. */
function boundsOf(elements: DiagramElement[], padding = FOCUS_PADDING): Box | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const el of elements) {
    if (el.waypoints?.length) {
      for (const p of el.waypoints) {
        xs.push(p.x);
        ys.push(p.y);
      }
    } else if (el.x != null && el.y != null) {
      xs.push(el.x, el.x + (el.width ?? 0));
      ys.push(el.y, el.y + (el.height ?? 0));
    }
  }
  if (!xs.length) return null;
  const x = Math.min(...xs) - padding;
  const y = Math.min(...ys) - padding;
  return { x, y, width: Math.max(...xs) + padding - x, height: Math.max(...ys) + padding - y };
}

/**
 * Editable BPMN canvas that fills its parent. Load with next/dynamic({ ssr: false }); bpmn-js needs the DOM.
 * Element IDs in props are graph IDs; they are converted to the compiled BPMN IDs here.
 */
export default function BpmnModelerView({
  xml,
  filename = "process",
  markers,
  focus,
  onEditedChange,
}: {
  xml: string;
  filename?: string;
  markers?: Markers;
  /**
   * Elements to zoom to and highlight; a new object re-runs it even for the same IDs.
   * label: shown on the highlight box, e.g. "#39 Path leads nowhere"; tone: its colour.
   */
  focus?: { ids: string[]; label?: string; tone?: FocusTone } | null;
  /** Told whenever the canvas gains or loses unsaved edits. */
  onEditedChange?: (edited: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const modeler = useRef<BpmnModeler | null>(null);
  const [edited, setEdited] = useState(false);
  // Bumped after every successful import, so markers and focus are re-applied to the new elements.
  const [imported, setImported] = useState(0);
  useEffect(() => onEditedChange?.(edited), [edited, onEditedChange]);

  const fit = useCallback(() => modeler.current?.get<Canvas>("canvas").zoom("fit-viewport", "auto"), []);

  // Imports into one specific modeler. If that modeler is destroyed while importXML is still
  // running (unmount, or React's dev-mode double effect), its error is expected and ignored.
  const load = useCallback(async (m: BpmnModeler, source: string) => {
    try {
      const { warnings } = await m.importXML(source);
      if (modeler.current !== m) return;
      if (warnings.length) console.warn("bpmn-js import warnings", warnings);
      m.get<Canvas>("canvas").zoom("fit-viewport", "auto");
      setImported((n) => n + 1);
    } catch (e) {
      if (modeler.current !== m) return;
      toast.error(`Could not render the diagram: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    const m = new BpmnModeler({ container: container.current! });
    modeler.current = m;
    // Import clears the undo stack, so this also resets "edited" after a reload.
    m.on("commandStack.changed", () => setEdited(m.get<{ canUndo: () => boolean }>("commandStack").canUndo()));
    void load(m, xml);
    // The canvas fills its page, so redraw it when the window (and the canvas) changes size.
    const observer = new ResizeObserver(() => m.get<Canvas>("canvas").resized());
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      modeler.current = null;
      m.destroy();
    };
  }, [xml, load]);

  // Issue markers. A string key, so a new but equal object from the parent does nothing.
  const markerKey = JSON.stringify([markers?.error ?? [], markers?.review ?? []]);
  useEffect(() => {
    const m = modeler.current;
    if (!m || !imported) return;
    const canvas = m.get<Canvas>("canvas");
    const registry = m.get<ElementRegistry>("elementRegistry");
    const [error, review] = JSON.parse(markerKey) as [string[], string[]];
    const applied: [string, string][] = [];
    for (const [ids, marker] of [[error, "has-error"], [review, "has-review"]] as const) {
      for (const id of ids.map(xid)) {
        if (!registry.get(id)) continue;
        canvas.addMarker(id, marker);
        applied.push([id, marker]);
      }
    }
    return () => {
      if (modeler.current !== m) return;
      for (const [id, marker] of applied) if (registry.get(id)) canvas.removeMarker(id, marker);
    };
  }, [markerKey, imported]);

  // Zoom to the focused elements (animated) and highlight them until the focus changes: outline
  // the elements, tint their lanes, box the area and fade everything else.
  useEffect(() => {
    const m = modeler.current;
    if (!m || !imported || !focus) return;
    const canvas = m.get<Canvas>("canvas");
    const registry = m.get<ElementRegistry>("elementRegistry");
    const elements = focus.ids.map((id) => registry.get(xid(id))).filter((el): el is DiagramElement => !!el);
    const marked: [string, string][] = [];
    const mark = (id: string, marker: string) => {
      canvas.addMarker(id, marker);
      marked.push([id, marker]);
    };
    for (const el of elements) mark(el.id, FOCUS);

    if (elements.length) {
      // Keep the focused elements, their labels and the flows into and out of them in full view.
      const keep = new Set(elements.map((el) => el.id));
      for (const el of elements) for (const flow of [...(el.incoming ?? []), ...(el.outgoing ?? [])]) keep.add(flow.id);
      const all = registry.getAll();
      for (const el of all) {
        if (el.type && CONTAINERS.has(el.type)) continue;
        if (keep.has(el.id) || (el.labelTarget && keep.has(el.labelTarget.id))) continue;
        mark(el.id, DIMMED);
      }
      // Tint the lanes the focused shapes sit in (by where their centre falls).
      const centres = elements
        .filter((el) => !el.waypoints && el.x != null && el.y != null)
        .map((el) => ({ x: el.x! + (el.width ?? 0) / 2, y: el.y! + (el.height ?? 0) / 2 }));
      for (const lane of all.filter((el) => el.type === "bpmn:Lane" && !keep.has(el.id))) {
        const inside = (p: { x: number; y: number }) =>
          p.x >= lane.x! && p.x <= lane.x! + lane.width! && p.y >= lane.y! && p.y <= lane.y! + lane.height!;
        if (centres.some(inside)) mark(lane.id, FOCUS_LANE);
      }
    }

    // A light, see-through box over the issue's area in the issue's colour, drawn above the shapes
    // but ignoring clicks. Colours are set on the SVG itself: unstyled SVG shapes fill solid black.
    const layer = canvas.getLayer(HIGHLIGHT_LAYER);
    const box = boundsOf(elements, 14);
    if (box) {
      const colour = TONE_COLOUR[focus.tone ?? "info"];
      const svg = (tag: string, attrs: Record<string, string | number>) => {
        const node = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
        layer.appendChild(node);
        return node;
      };
      svg("rect", {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        rx: 12,
        fill: colour,
        "fill-opacity": 0.08,
        stroke: colour,
        "stroke-opacity": 0.9,
        "stroke-width": 2,
        "stroke-dasharray": "6 4",
        "pointer-events": "none",
      });
      if (focus.label) {
        svg("text", {
          x: box.x + 4,
          y: box.y - 8,
          fill: colour,
          "font-size": 12,
          "font-weight": 600,
          "font-family": "DM Sans, Arial, sans-serif",
          "pointer-events": "none",
        }).textContent = focus.label;
      }
    }

    let frame = 0;
    const area = boundsOf(elements);
    if (area) {
      const size = canvas.getSize();
      const scale = Math.min(size.width / area.width, size.height / area.height, MAX_FOCUS_ZOOM);
      const to: Box = {
        width: size.width / scale,
        height: size.height / scale,
        x: area.x + area.width / 2 - size.width / scale / 2,
        y: area.y + area.height / 2 - size.height / scale / 2,
      };
      const from = canvas.viewbox();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 350);
        const k = 1 - (1 - t) ** 3;
        canvas.viewbox({
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          width: from.width + (to.width - from.width) * k,
          height: from.height + (to.height - from.height) * k,
        });
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }
    // An edit can move the elements out from under the box, so drop the box on the first one.
    const bus = m.get<EventBus>("eventBus");
    const clearBox = () => layer.replaceChildren();
    bus.on("commandStack.changed", clearBox);
    return () => {
      cancelAnimationFrame(frame);
      if (modeler.current !== m) return;
      bus.off("commandStack.changed", clearBox);
      layer.replaceChildren();
      for (const [id, marker] of marked) if (registry.get(id)) canvas.removeMarker(id, marker);
    };
  }, [focus, imported]);

  const saveBpmn = async () => {
    const { xml: out } = await modeler.current!.saveXML({ format: true });
    if (out) download(out, `${filename}.bpmn`, "application/xml");
  };

  const saveSvg = async () => {
    const { svg } = await modeler.current!.saveSVG();
    download(svg, `${filename}.svg`, "image/svg+xml");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={fit}>
          <Maximize2Icon />
          Fit
        </Button>
        <Button variant="outline" size="sm" onClick={saveBpmn}>
          <DownloadIcon />
          Download .bpmn
        </Button>
        <Button variant="outline" size="sm" onClick={saveSvg}>
          <ImageIcon />
          Download SVG
        </Button>
        <Button variant="ghost" size="sm" onClick={() => modeler.current && load(modeler.current, xml)} disabled={!edited}>
          <RotateCcwIcon />
          Reset to generated
        </Button>
        {edited && <Badge variant="secondary">Edited</Badge>}
      </div>
      {/* bpmn-js draws on a light canvas, so keep it white in dark mode too. */}
      <div
        ref={container}
        className="min-h-0 w-full flex-1 overflow-hidden rounded-[14px] border border-line bg-white bg-[radial-gradient(#e2e6ee_1px,transparent_1px)] bg-size-[18px_18px] text-black"
      />
    </div>
  );
}
