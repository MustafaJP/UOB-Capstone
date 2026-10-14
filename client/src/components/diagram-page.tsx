"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, PanelRightCloseIcon, PanelRightOpenIcon, TriangleAlertIcon } from "lucide-react";
import { IssuesPanel, issueTitle } from "@/components/issues-panel";
import { PILL } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import { useResolvedIssues } from "@/hooks/use-resolved-issues";
import type { FocusTone } from "@/components/bpmn-modeler";
import { draftErrors, issueTarget } from "@/lib/diagram";
import type { Issue } from "@/lib/types";

const canvasLoading = () => <div className="h-full animate-pulse rounded-[14px] border border-line bg-white" />;
const BpmnModeler = dynamic(() => import("@/components/bpmn-modeler"), { ssr: false, loading: canvasLoading });

type Focus = { ids: string[]; label?: string; tone?: FocusTone } | null;

/** The job's BPMN diagram on a page of its own, covering the whole window, with its issues beside it. */
export function DiagramPage() {
  const { id } = useParams<{ id: string }>();
  const { job, error } = useJob(id);
  const result = job?.status === "done" ? job.result : null;
  const [unsaved, setUnsaved] = useState(false);
  const [showIssues, setShowIssues] = useState(true);
  // ?issue=N (1-based, the # shown in the job's Issues tab) opens the diagram on that issue.
  const linked = Number(useSearchParams().get("issue")) - 1;
  const linkedIndex = Number.isInteger(linked) && linked >= 0 ? linked : null;
  const [selected, setSelected] = useState<number | null>(linkedIndex);
  // "link": still showing the linked issue, whose elements are known once the job has loaded.
  const [focus, setFocus] = useState<Focus | "link">(linkedIndex == null ? null : "link");
  const linkFocus = useMemo<Focus>(() => {
    const issue = linkedIndex == null ? undefined : result?.issues[linkedIndex];
    const target = issue ? issueTarget(issue, result?.graph ?? null) : null;
    if (!issue || !target?.ids.length) return null;
    const tone: FocusTone = String(linkedIndex) in (job?.resolved ?? {}) ? "complete" : issue.severity;
    return { ids: target.ids, label: `#${linkedIndex! + 1} ${issueTitle(issue.code)}`, tone };
  }, [result, linkedIndex, job?.resolved]);

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

  const issues: Issue[] = result?.issues ?? [];
  const { isResolved, toggle } = useResolvedIssues(result ? job : null);
  const targets = issues.map((i) => issueTarget(i, result?.graph ?? null));
  // Open issues that name elements directly are marked; evidence matches show when the issue is
  // picked, and completed issues are no longer marked at all.
  const markedIds = (severity: Issue["severity"]) =>
    issues.flatMap((i, n) =>
      i.severity === severity && !isResolved(n) && targets[n].kind === "element" ? targets[n].ids : [],
    );
  const blockingIds = markedIds("blocking");
  const reviewIds = markedIds("review");
  const draftCount = result ? draftErrors(result).length : 0;
  const toCheck = issues.filter((i, n) => i.severity !== "info" && !isResolved(n)).length;
  const focusFor = (index: number): Focus => ({
    ids: targets[index].ids,
    label: `#${index + 1} ${issueTitle(issues[index].code)}`,
    tone: isResolved(index) ? "complete" : issues[index].severity,
  });
  const filename = `process-${id.slice(0, 8)}${result?.draft ? "-draft" : ""}`;

  // Issues are picked only from the panel (clicks on the canvas never select one): zoom to and
  // highlight the issue's elements, or clear the highlight when it is deselected.
  const selectIssue = (index: number | null) => {
    setSelected(index);
    setFocus(index == null ? null : focusFor(index));
  };

  let body: React.ReactNode;
  if (!job) {
    body = error ? (
      <p className="m-auto text-sm text-ink-3">
        {error.code === "JOB_NOT_FOUND" ? "This job does not exist." : `Cannot load the job: ${error.message}`}
      </p>
    ) : (
      canvasLoading()
    );
  } else if (!result) {
    body = <p className="m-auto text-sm text-ink-3">The diagram is available when the job is done.</p>;
  } else if (!result.bpmnXml) {
    body = (
      <p className="m-auto text-sm text-ink-3">
        No diagram was compiled: the graph has structural errors. See the Issues tab on the job page.
      </p>
    );
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1">
          <BpmnModeler
            xml={result.bpmnXml}
            filename={filename}
            markers={{ error: blockingIds, review: reviewIds }}
            focus={focus === "link" ? linkFocus : focus}
            onEditedChange={setUnsaved}
          />
        </div>
        {showIssues && (
          <div className="flex max-h-[45%] min-h-0 flex-col gap-3 lg:max-h-none lg:w-[360px] lg:shrink-0">
            {draftCount > 0 && (
              <div className="flex gap-2.5 rounded-xl border border-[#f3c6c8] bg-uob-red-50 px-3 py-2.5 text-[12.5px] text-uob-red">
                <TriangleAlertIcon className="mt-px size-4 shrink-0" />
                <span>
                  Draft: {draftCount === 1 ? "1 error" : `${draftCount} errors`} to fix before this is valid BPMN. Pick one
                  to find it, fix it in the editor, then download your corrected version.
                </span>
              </div>
            )}
            <IssuesPanel
              issues={issues}
              targets={targets}
              graph={result.graph}
              evidence={job.evidence}
              selected={selected}
              onSelect={selectIssue}
              isResolved={isResolved}
              onToggleResolved={(index) => void toggle(index)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    // Covers the site header too, so the canvas gets the whole window.
    <div className="fixed inset-0 z-50 flex flex-col bg-cream">
      <header className="relative flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white px-4">
        <Link
          href={`/jobs/${id}`}
          onClick={leave}
          className="flex shrink-0 items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
        >
          <ChevronLeftIcon className="size-[15px]" />
          Back to job
        </Link>
        <h1 className="flex min-w-0 items-center gap-2 text-base font-bold text-navy">
          <span className="truncate">{result?.graph?.title ?? "Diagram"}</span>
          {result?.draft && <Badge className={PILL.red}>Draft</Badge>}
          <span className="hidden font-mono text-xs font-normal text-ink-3 sm:inline">#{id.slice(0, 8)}</span>
        </h1>
        {result?.bpmnXml && (
          <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => setShowIssues((s) => !s)}>
            {showIssues ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
            {showIssues ? "Hide issues" : "Show issues"}
            {toCheck > 0 && <Badge className={blockingIds.length ? PILL.red : PILL.amber}>{toCheck}</Badge>}
          </Button>
        )}
        <div
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-[3px] bg-[linear-gradient(90deg,var(--color-uob-red)_0_120px,var(--color-brand)_120px)]"
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">{body}</div>
    </div>
  );
}
