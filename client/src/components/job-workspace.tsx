"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArchiveIcon, ArrowLeftIcon, ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { ChatHandoff } from "@/components/chat-handoff";
import { ElapsedTime } from "@/components/elapsed-time";
import { PipelineStepper } from "@/components/pipeline-stepper";
import { ResultTabs } from "@/components/result-tabs";
import { StatusBadge } from "@/components/status-badge";
import { SwitchModeDialog } from "@/components/switch-mode-dialog";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/job-skeleton";
import { useJob } from "@/hooks/use-job";
import { diagramHref } from "@/lib/diagram";

export function JobWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { job, error, refresh } = useJob(id);

  if (!job) {
    if (error)
      return (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{error.code === "JOB_NOT_FOUND" ? "Job not found" : "Cannot load job"}</AlertTitle>
          <AlertDescription>
            {error.code === "JOB_NOT_FOUND"
              ? "This job is not running and was never saved. It may have been deleted from the run history."
              : error.message}
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/runs" />}>
              Previous runs
            </Button>
          </AlertAction>
        </Alert>
      );
    return <Skeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <Link href="/runs" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="size-3.5" />
            Previous runs
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {job.result?.graph?.title ?? "Job"}{" "}
              <span className="font-mono text-sm font-normal text-muted-foreground">{job.id.slice(0, 8)}</span>
            </h1>
            <StatusBadge status={job.status} />
            <ElapsedTime job={job} />
            <Badge variant="outline">{job.mode === "api" ? `API · ${job.provider}` : "Copilot Chat"}</Badge>
            {job.archived && (
              <Badge variant="secondary">
                <ArchiveIcon />
                Saved run
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Started {new Date(job.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            {job.sources?.length ? ` · ${job.sources.join(", ")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* The diagram opens full screen in a new browser tab, so this page stays open beside it. */}
          {job.status === "done" && job.result?.bpmnXml && (
            <Button size="sm" nativeButton={false} render={<Link href={diagramHref(job.id)} target="_blank" />}>
              <ExternalLinkIcon />
              {job.result.draft ? "Open draft in BPMN" : "Open in BPMN"}
            </Button>
          )}
          {!job.archived && job.status === "awaiting_chat" && (
            <SwitchModeDialog job={job} target="api" label="Switch to API" onSwitched={refresh} />
          )}
          {!job.archived && job.status === "failed" && (
            <SwitchModeDialog job={job} target="api" label="Retry via API" onSwitched={refresh} />
          )}
        </div>
      </div>

      {job.archived && job.status !== "done" && (
        <Alert>
          <ArchiveIcon />
          <AlertTitle>Saved snapshot</AlertTitle>
          <AlertDescription>
            The server restarted since this run {job.status === "failed" ? "failed" : "paused"}, so it can no longer be
            resumed. Start a new job from the same sources to continue.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Lost contact with the server</AlertTitle>
          <AlertDescription>{error.message}. Retrying…</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <PipelineStepper job={job} />
        </CardContent>
      </Card>

      {job.status === "failed" && job.error && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            {job.error.code}: {job.error.message}
          </AlertTitle>
          <AlertDescription>
            {job.error.retryable
              ? "This looks temporary. Retry via API, or finish the remaining steps in Copilot Chat."
              : "You can finish the remaining steps in Copilot Chat, or retry with another provider."}
          </AlertDescription>
          {!job.archived && (
            <AlertAction>
              <SwitchModeDialog job={job} target="chat" label="Switch to Copilot Chat" onSwitched={refresh} />
            </AlertAction>
          )}
        </Alert>
      )}

      {!job.archived && job.status === "awaiting_chat" && job.pending && (
        // Keyed per handoff (updatedAt changes each time the graph pauses) so the textarea resets,
        // including between drawing the flow and fixing it.
        <ChatHandoff key={job.updatedAt} jobId={job.id} pending={job.pending} onResumed={refresh} />
      )}

      <ResultTabs job={job} />
    </div>
  );
}
