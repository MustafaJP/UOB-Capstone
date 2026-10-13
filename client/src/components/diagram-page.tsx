"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import { draftErrors } from "@/lib/diagram";
import type { Issue } from "@/lib/types";

const canvasLoading = () => <div className="h-full animate-pulse rounded-lg border bg-muted/40" />;
const BpmnModeler = dynamic(() => import("@/components/bpmn-modeler"), { ssr: false, loading: canvasLoading });

/** A draft's blocking errors and how to fix them, above the canvas. */
function DraftErrors({ issues, onHide }: { issues: Issue[]; onHide: () => void }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle className="flex items-center justify-between gap-2">
        Draft: {issues.length === 1 ? "1 error" : `${issues.length} errors`} to fix before this is a valid diagram
        <Button variant="ghost" size="xs" onClick={onHide}>
          Hide
        </Button>
      </AlertTitle>
      <AlertDescription>
        <p>
          The automatic fixes could not resolve these. The affected elements are outlined in red. Fix them in the
          editor, then download your corrected version.
        </p>
        <ul className="mt-1 max-h-32 list-disc overflow-y-auto pl-5">
          {issues.map((i, n) => (
            <li key={n}>
              {i.message}
              {i.element_ids.length > 0 && <span className="font-mono text-xs"> ({i.element_ids.join(", ")})</span>}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/** The job's BPMN diagram on a page of its own, covering the whole window. */
export function DiagramPage() {
  const { id } = useParams<{ id: string }>();
  const { job, error } = useJob(id);
  const result = job?.status === "done" ? job.result : null;
  const [unsaved, setUnsaved] = useState(false);
  const [showErrors, setShowErrors] = useState(true);

  // Downloads are the only way to keep edits, so warn before they are thrown away.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  const leave = (e: React.MouseEvent) => {
    if (unsaved && !window.confirm("Leave the diagram? Edits you have not downloaded will be lost.")) e.preventDefault();
  };

  const errors = result ? draftErrors(result) : [];
  const errorIds = errors.flatMap((i) => i.element_ids);
  const filename = `process-${id.slice(0, 8)}${result?.draft ? "-draft" : ""}`;

  let body: React.ReactNode;
  if (!job) {
    body = error ? (
      <p className="m-auto text-sm text-muted-foreground">
        {error.code === "JOB_NOT_FOUND" ? "This job does not exist." : `Cannot load the job: ${error.message}`}
      </p>
    ) : (
      canvasLoading()
    );
  } else if (!result) {
    body = <p className="m-auto text-sm text-muted-foreground">The diagram is available when the job is done.</p>;
  } else if (!result.bpmnXml) {
    body = (
      <p className="m-auto text-sm text-muted-foreground">
        No diagram was compiled: the graph has structural errors. See the Issues tab on the job page.
      </p>
    );
  } else {
    body = (
      <>
        {errors.length > 0 && showErrors && <DraftErrors issues={errors} onHide={() => setShowErrors(false)} />}
        <div className="min-h-0 flex-1">
          <BpmnModeler xml={result.bpmnXml} filename={filename} errorIds={errorIds} onEditedChange={setUnsaved} />
        </div>
      </>
    );
  }

  return (
    // Covers the site header too, so the canvas gets the whole window.
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href={`/jobs/${id}`}
          onClick={leave}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to job
        </Link>
        <h1 className="truncate text-sm font-medium">
          {result?.graph?.title ?? "Diagram"} <span className="font-mono font-normal text-muted-foreground">{id.slice(0, 8)}</span>
        </h1>
        {result?.draft && (
          <Button variant="destructive" size="xs" onClick={() => setShowErrors((s) => !s)} disabled={!errors.length}>
            Draft{errors.length ? ` · ${errors.length} errors` : ""}
          </Button>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">{body}</div>
    </div>
  );
}
