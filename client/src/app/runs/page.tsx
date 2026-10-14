"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DownloadIcon, PlusIcon, RefreshCwIcon, SearchIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Callout } from "@/components/callout";
import { FileTypeTile } from "@/components/file-dropzone";
import { PILL, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { JobStatus, RunSummary } from "@/lib/types";

/** "Just now", "12 min ago", "3 h ago", then a short date for anything older than a day. */
function formatUpdated(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Type tile for a run, from its first source. */
function runKind(sources: string[]): "PDF" | "IMG" | "TXT" {
  const first = sources[0] ?? "";
  if (/\.pdf$/i.test(first)) return "PDF";
  if (/\.(png|jpe?g|gif|webp)$/i.test(first)) return "IMG";
  return "TXT";
}

const FILTERS: { label: string; match: (s: JobStatus) => boolean }[] = [
  { label: "All", match: () => true },
  { label: "Completed", match: (s) => s === "done" },
  { label: "In progress", match: (s) => s === "running" || s === "awaiting_chat" },
  { label: "Needs action", match: (s) => s === "failed" },
];

function IssueCounts({ issues }: { issues: RunSummary["issues"] }) {
  if (!issues) return <span className="text-ink-3">–</span>;
  if (!issues.blocking && !issues.review && !issues.info && !issues.resolved) return <span className="text-ink-3">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {issues.blocking > 0 && <Badge className={PILL.red}>{issues.blocking} blocking</Badge>}
      {issues.review > 0 && <Badge className={PILL.amber}>{issues.review} review</Badge>}
      {issues.info > 0 && <Badge className={PILL.grey}>{issues.info} info</Badge>}
      {!!issues.resolved && <Badge className={PILL.green}>✓ {issues.resolved} complete</Badge>}
    </div>
  );
}

function FlowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]", className)}>
      <rect x="3" y="4" width="7" height="6" rx="1.5" />
      <rect x="14" y="14" width="7" height="6" rx="1.5" />
      <path d="M6.5 10v4a3 3 0 0 0 3 3H14" />
    </svg>
  );
}

function NewDiagramButton() {
  return (
    <Button size="sm" nativeButton={false} render={<Link href="/" />}>
      <PlusIcon />
      New diagram
    </Button>
  );
}

export default function RunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(0);

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

  const q = query.trim().toLowerCase();
  const shown = (runs ?? []).filter(
    (r) =>
      FILTERS[filter].match(r.status) &&
      (!q || [r.title ?? "", r.id, ...r.sources].some((s) => s.toLowerCase().includes(q))),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[26px] font-extrabold text-navy">Previous runs</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Every job is saved when it finishes, fails or pauses, so you can reopen its diagram, issues and trace.
          </p>
        </div>
        <div className="flex gap-2 md:ml-auto">
          <Button variant="outline" size="sm" onClick={() => setTick((t) => t + 1)}>
            <RefreshCwIcon />
            Refresh
          </Button>
          <NewDiagramButton />
        </div>
      </div>

      {error && (
        <Callout tone="red" icon={<TriangleAlertIcon />} title="Cannot load the run history">
          {error.message}
        </Callout>
      )}

      {!runs ? (
        !error && <div className="h-40 animate-pulse rounded-[14px] bg-white/60" />
      ) : !runs.length ? (
        <div className="mt-1 rounded-[14px] border-[1.5px] border-dashed border-[#c9d1e2] bg-white p-9 text-center">
          <div className="mx-auto mb-2.5 grid size-[52px] place-items-center rounded-[14px] bg-brand-50 text-brand">
            <FlowIcon className="size-6" />
          </div>
          <b className="font-heading text-[17px] text-navy">No runs yet</b>
          <p className="mt-1 mb-3.5 text-ink-3">Upload your first SOP and its diagram will appear here.</p>
          <NewDiagramButton />
        </div>
      ) : (
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3.5">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-[#fcfcfd] px-3 py-2 text-ink-3 focus-within:border-brand">
              <SearchIcon className="size-[18px]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by document or job ID"
                className="w-full bg-transparent text-ink outline-none placeholder:text-ink-3"
              />
            </label>
            {FILTERS.map((f, i) => (
              <button
                key={f.label}
                type="button"
                aria-pressed={filter === i}
                onClick={() => setFilter(i)}
                className={cn(
                  "rounded-full px-2.5 py-[3px] text-xs font-semibold transition-colors",
                  filter === i ? PILL.blue : cn(PILL.grey, "hover:text-ink"),
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          {!shown.length ? (
            <p className="py-10 text-center text-sm text-ink-3">No runs match this search.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead className="w-48">Status</TableHead>
                  <TableHead className="w-32">Route</TableHead>
                  <TableHead className="w-44">Issues</TableHead>
                  <TableHead className="w-36">Updated</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((run) => (
                  <TableRow key={run.id} className="cursor-pointer" onClick={() => router.push(`/jobs/${run.id}`)}>
                    <TableCell className="whitespace-normal">
                      <div className="flex items-center gap-2.5">
                        <FileTypeTile kind={runKind(run.sources)} className="size-[30px] text-[9px]" />
                        <div className="min-w-0">
                          <Link
                            href={`/jobs/${run.id}`}
                            className="block text-[13.5px] font-bold hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {run.title ?? "Untitled run"}
                          </Link>
                          <small className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
                            <span className="font-mono">#{run.id.slice(0, 8)}</span>
                            {run.sources.length > 0 && <span className="truncate">· {run.sources.join(", ")}</span>}
                          </small>
                        </div>
                        {run.draft && <Badge className={cn(PILL.amber, "ml-1")}>Draft diagram</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>{run.mode === "api" ? `API · ${run.provider === "gemini" ? "Gemini" : "Qwen"}` : "Copilot Chat"}</TableCell>
                    <TableCell>
                      <IssueCounts issues={run.issues} />
                    </TableCell>
                    <TableCell className="text-ink-2 tabular-nums" title={new Date(run.updatedAt).toLocaleString()}>
                      {formatUpdated(run.updatedAt)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
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
                        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/jobs/${run.id}`} />}>
                          Open
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
