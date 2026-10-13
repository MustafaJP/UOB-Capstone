"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DownloadIcon, PlusIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import type { RunSummary } from "@/lib/types";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function IssueCounts({ issues }: { issues: RunSummary["issues"] }) {
  if (!issues) return <span className="text-muted-foreground">-</span>;
  if (!issues.blocking && !issues.review && !issues.info) return <span className="text-muted-foreground">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {issues.blocking > 0 && <Badge variant="destructive">{issues.blocking} blocking</Badge>}
      {issues.review > 0 && (
        <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-300">{issues.review} review</Badge>
      )}
      {issues.info > 0 && <Badge variant="secondary">{issues.info} info</Badge>}
    </div>
  );
}

export default function RunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const [tick, setTick] = useState(0);

  // Reloads on mount and whenever tick changes (the Refresh button).
  useEffect(() => {
    let cancelled = false;
    api
      .listJobs()
      .then(({ runs }) => {
        if (cancelled) return;
        setRuns(runs);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const remove = async (run: RunSummary) => {
    if (!window.confirm(`Delete "${run.title ?? run.id.slice(0, 8)}" from the run history? This cannot be undone.`)) return;
    try {
      await api.deleteJob(run.id);
      setRuns((rs) => rs?.filter((r) => r.id !== run.id) ?? null);
      toast.success("Run deleted");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete the run");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Previous runs</h1>
          <p className="text-sm text-muted-foreground">
            Every job is saved when it finishes, fails or pauses, so you can reopen its diagram, issues and trace later.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTick((t) => t + 1)}>
            <RefreshCwIcon />
            Refresh
          </Button>
          <Button nativeButton={false} render={<Link href="/" />}>
            <PlusIcon />
            New job
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Cannot load the run history</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          {!runs ? (
            !error && <div className="h-40 animate-pulse rounded-lg bg-muted/40" />
          ) : !runs.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No runs yet. Start a new job to see it here.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Process</TableHead>
                  <TableHead>Sources</TableHead>
                  <TableHead className="w-44">Status</TableHead>
                  <TableHead className="w-44">Issues</TableHead>
                  <TableHead className="w-40">Started</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow
                    key={run.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/jobs/${run.id}`)}
                  >
                    <TableCell className="whitespace-normal">
                      <Link
                        href={`/jobs/${run.id}`}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {run.title ?? "Untitled run"}
                      </Link>
                      {run.draft && (
                        <Badge variant="outline" className="ml-2 border-amber-500/50 text-amber-800 dark:text-amber-300">
                          Draft diagram
                        </Badge>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-mono">{run.id.slice(0, 8)}</span>
                        <span>· {run.mode === "api" ? `API · ${run.provider}` : "Copilot Chat"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal text-muted-foreground">
                      {run.sources.length ? run.sources.join(", ") : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>
                      <IssueCounts issues={run.issues} />
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">{formatDate(run.createdAt)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {run.hasBpmn && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Download BPMN"
                            title="Download BPMN"
                            nativeButton={false}
                            render={<a href={api.bpmnUrl(run.id)} />}
                          >
                            <DownloadIcon />
                          </Button>
                        )}
                        {run.status !== "running" && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Delete run"
                            title="Delete run"
                            onClick={() => void remove(run)}
                          >
                            <Trash2Icon />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
