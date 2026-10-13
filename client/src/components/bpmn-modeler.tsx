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

type Canvas = {
  zoom: (level: "fit-viewport" | number, center?: "auto") => number;
  addMarker: (id: string, marker: string) => void;
  resized: () => void;
};
type ElementRegistry = { get: (id: string) => unknown };

/** Editable BPMN canvas that fills its parent. Load with next/dynamic({ ssr: false }); bpmn-js needs the DOM. */
export default function BpmnModelerView({
  xml,
  filename = "process",
  errorIds,
  onEditedChange,
}: {
  xml: string;
  filename?: string;
  /** Graph element IDs to outline in red (blocking errors in a draft). */
  errorIds?: string[];
  /** Told whenever the canvas gains or loses unsaved edits. */
  onEditedChange?: (edited: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const modeler = useRef<BpmnModeler | null>(null);
  const [edited, setEdited] = useState(false);
  useEffect(() => onEditedChange?.(edited), [edited, onEditedChange]);
  // A string, so a new but equal array from the parent does not rebuild the modeler.
  const errorKey = (errorIds ?? []).join("\n");

  const fit = useCallback(() => modeler.current?.get<Canvas>("canvas").zoom("fit-viewport", "auto"), []);

  // Imports into one specific modeler. If that modeler is destroyed while importXML is still
  // running (unmount, or React's dev-mode double effect), its error is expected and ignored.
  const load = useCallback(async (m: BpmnModeler, source: string) => {
    try {
      const { warnings } = await m.importXML(source);
      if (modeler.current !== m) return;
      if (warnings.length) console.warn("bpmn-js import warnings", warnings);
      const canvas = m.get<Canvas>("canvas");
      const registry = m.get<ElementRegistry>("elementRegistry");
      for (const id of errorKey.split("\n").filter(Boolean).map(xid)) if (registry.get(id)) canvas.addMarker(id, "has-error");
      canvas.zoom("fit-viewport", "auto");
    } catch (e) {
      if (modeler.current !== m) return;
      toast.error(`Could not render the diagram: ${(e as Error).message}`);
    }
  }, [errorKey]);

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
      <div ref={container} className="min-h-0 w-full flex-1 overflow-hidden rounded-lg border bg-white text-black" />
    </div>
  );
}
