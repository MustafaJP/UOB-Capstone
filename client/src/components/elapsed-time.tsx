"use client";

import { useEffect, useState } from "react";
import { TimerIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { JobView } from "@/lib/types";

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Current time, re-rendering every second while live is true. */
export function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return now;
}

/** Durations under a second (code-only steps) read better as "<1s" than "0s". */
export const formatStepTime = (ms: number) => (ms < 1000 ? "<1s" : formatDuration(ms));

/**
 * Time since the job started. Ticks every second while it is running or waiting for a chat result;
 * once it is done or failed, shows how long it took (start to last update).
 */
export function ElapsedTime({ job }: { job: JobView }) {
  const live = !job.archived && (job.status === "running" || job.status === "awaiting_chat");
  const now = useNow(live);

  const started = Date.parse(job.createdAt);
  const ms = (live ? now : Date.parse(job.updatedAt)) - started;
  return (
    <Badge variant="outline" className="tabular-nums" title={`Started ${new Date(started).toLocaleString()}`}>
      <TimerIcon />
      {live ? `Running for ${formatDuration(ms)}` : `Took ${formatDuration(ms)}`}
    </Badge>
  );
}
