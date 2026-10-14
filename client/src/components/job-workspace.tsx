"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronLeftIcon,
  DownloadIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react";
import { Callout } from "@/components/callout";
import { ChatHandoff } from "@/components/chat-handoff";
import { ElapsedTime, formatDuration } from "@/components/elapsed-time";
import { PipelineStepper } from "@/components/pipeline-stepper";
import { ResultTabs, type ResultTab } from "@/components/result-tabs";
import { StatusBadge } from "@/components/status-badge";
import { SwitchModeDialog } from "@/components/switch-mode-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/job-skeleton";
import { useJob } from "@/hooks/use-job";
import { useResolvedIssues } from "@/hooks/use-resolved-issues";
import { api } from "@/lib/api";
import { diagramHref } from "@/lib/diagram";
import type { JobView } from "@/lib/types";

const PROVIDER_NAME: Record<JobView["provider"], string> = { gemini: "Gemini", qwen: "Qwen" };
const routeLabel = (job: Pick<JobView, "mode" | "provider">) =>
  job.mode === "api" ? `API · ${PROVIDER_NAME[job.provider] ?? job.provider}` : "Copilot Chat";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function BackLink() {
  return (
    <Link href="/runs" className="flex w-fit items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
      <ChevronLeftIcon className="size-[15px]" />
      Previous runs
    </Link>
  );
}

/** What the finished run produced, in one sentence: duration, diagram size and what needs review. */
function doneSummary(job: JobView, isResolved: (index: number) => boolean): string {
  const took = formatDuration(Date.parse(job.updatedAt) - Date.parse(job.createdAt));
  const graph = job.result?.graph;
  const issues = job.result?.issues ?? [];
  const toCheck = issues.filter((i, n) => i.severity !== "info" && !isResolved(n)).length;
  const parts = [`All agents finished in ${took}.`];
  if (graph) {
    const tasks = graph.nodes.filter((n) => n.type === "task").length;
    const decisions = graph.nodes.filter((n) => n.type === "exclusive_gateway").length;
    parts.push(
      `The draft has ${plural(graph.lanes.length, "lane")}, ${plural(tasks, "step")} and ${plural(decisions, "decision")}.`,
    );
  }
  parts.push(
    toCheck
      ? `The checks flagged ${plural(toCheck, "item")} for you to look at before approving.`
      : "The checks found nothing that needs your review.",
  );
  return parts.join(" ");
}

export function JobWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { job, error, refresh } = useJob(id);
  // The tab the user picked, remembered only for the result state it was picked in, so the
  // default tab still applies when the result arrives.
  const [picked, setPicked] = useState<{ withResult: boolean; tab: ResultTab } | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const { isResolved, toggle } = useResolvedIssues(job?.status === "done" ? job : null);

  if (!job) {
    if (error)
      return (
        <div className="flex flex-col gap-4">
          <BackLink />
          <Callout
            tone="red"
            icon={<TriangleAlertIcon />}
            title={error.code === "JOB_NOT_FOUND" ? "Job not found" : "Cannot load job"}
            actions={
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/runs" />}>
                Previous runs
              </Button>
            }
          >
            {error.code === "JOB_NOT_FOUND"
              ? "This job is not running and was never saved. It may have been deleted from the run history."
              : error.message}
          </Callout>
        </div>
      );
    return <Skeleton />;
  }

  const result = job.result;
  const tab: ResultTab = picked && picked.withResult === !!result ? picked.tab : result ? "issues" : "trace";
  const setTab = (t: ResultTab) => setPicked({ withResult: !!result, tab: t });
  const openIssues = () => {
    setTab("issues");
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex flex-col">
      <BackLink />
      <div className="mt-2.5 mb-5 flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2.5 text-[26px] font-extrabold text-navy">
            {result?.graph?.title ?? "Job"}
            <StatusBadge status={job.status} />
            <span className="font-mono text-sm font-normal text-ink-3">#{job.id.slice(0, 8)}</span>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
            <span>
              Started {new Date(job.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              {job.sources?.length ? ` · ${job.sources.join(", ")}` : ""} · {routeLabel(job)}
            </span>
            <ElapsedTime job={job} />
            {job.archived && (
              <Badge className="bg-line-2 text-ink-2">
                <ArchiveIcon />
                Saved run
              </Badge>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 md:ml-auto">
          {!job.archived && job.status === "awaiting_chat" && (
            <SwitchModeDialog job={job} target="api" label="Switch to API" onSwitched={refresh} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {job.archived && job.status !== "done" && (
          <Callout tone="blue" icon={<ArchiveIcon />} title="Saved snapshot">
            The server restarted since this run {job.status === "failed" ? "failed" : "paused"}, so it can no longer be
            resumed. Start a new job from the same sources to continue.
          </Callout>
        )}

        {error && (
          <Callout tone="amber" icon={<WifiOffIcon />} title="Lost contact with the server">
            {error.message}. Retrying…
          </Callout>
        )}

        <Card className="py-0">
          <CardContent className="px-[18px] pt-6 pb-5">
            <PipelineStepper job={job} />
          </CardContent>
        </Card>

        {job.status === "failed" && job.error && (
          <Callout
            tone="red"
            icon={<TriangleAlertIcon />}
            title={
              job.error.retryable && job.mode === "api"
                ? `${PROVIDER_NAME[job.provider] ?? job.provider} could not be reached`
                : "A step could not finish"
            }
            actions={
              !job.archived && (
                <>
                  <SwitchModeDialog
                    job={job}
                    target="api"
                    label="Retry via API"
                    variant="default"
                    icon={<RefreshCwIcon />}
                    onSwitched={refresh}
                  />
                  <SwitchModeDialog
                    job={job}
                    target="chat"
                    label="Continue in Copilot Chat"
                    icon={<MessageSquareIcon />}
                    onSwitched={refresh}
                  />
                </>
              )
            }
          >
            <p>
              {job.error.retryable
                ? "This looks temporary. Retry via API, or finish the remaining steps in Copilot Chat."
                : "You can finish the remaining steps in Copilot Chat, or retry with another provider."}{" "}
              Finished steps are saved, so nothing is lost.
            </p>
            <details className="mt-3 text-[12.5px]">
              <summary className="cursor-pointer font-semibold text-ink-3">Technical details</summary>
              <pre className="mt-2 rounded-lg border border-line bg-[#f6f7f9] px-3 py-2.5 font-mono text-xs break-words whitespace-pre-wrap text-ink-2">
                {job.error.code} · {job.error.message}
                {job.error.details != null &&
                  `\n${typeof job.error.details === "string" ? job.error.details : JSON.stringify(job.error.details, null, 2)}`}
              </pre>
            </details>
          </Callout>
        )}

        {job.status === "done" && result && (
          <Callout
            tone={result.draft || !result.bpmnXml ? "amber" : "green"}
            icon={result.draft || !result.bpmnXml ? <TriangleAlertIcon /> : <CheckIcon />}
            title={
              result.draft
                ? "A draft diagram is ready to fix"
                : result.bpmnXml
                  ? "Your diagram is ready for review"
                  : "No diagram could be built"
            }
            side
            actions={
              <>
                {result.bpmnXml && (
                  <Button size="sm" nativeButton={false} render={<Link href={diagramHref(job.id)} />}>
                    Review diagram
                  </Button>
                )}
                {result.bpmnXml && (
                  <Button variant="outline" size="sm" nativeButton={false} render={<a href={api.bpmnUrl(job.id)} />}>
                    <DownloadIcon />
                    Download BPMN
                  </Button>
                )}
                {!result.bpmnXml && (
                  <Button size="sm" onClick={openIssues}>
                    See issues
                  </Button>
                )}
              </>
            }
          >
            {result.draft
              ? "The diagram still has structure errors that the automatic fixes could not resolve. The affected elements are outlined in red in the editor."
              : result.bpmnXml
                ? doneSummary(job, isResolved)
                : "The graph has structural errors, so no BPMN was compiled. The Issues tab lists what went wrong."}
          </Callout>
        )}

        {!job.archived && job.status === "awaiting_chat" && job.pending && (
          // Keyed per handoff (updatedAt changes each time the graph pauses) so the textarea resets,
          // including between drawing the flow and fixing it.
          <ChatHandoff key={job.updatedAt} jobId={job.id} pending={job.pending} onResumed={refresh} />
        )}
      </div>

      <div ref={tabsRef} className="mt-[26px] scroll-mt-4">
        <ResultTabs
          job={job}
          tab={tab}
          onTabChange={setTab}
          isResolved={isResolved}
          onToggleResolved={(index) => void toggle(index)}
        />
      </div>
    </div>
  );
}
