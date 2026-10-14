"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { JobView } from "@/lib/types";

/**
 * Which of a finished job's issues are marked complete, and a toggle that saves to the server.
 * The change shows straight away and is rolled back if the save fails.
 */
export function useResolvedIssues(job: JobView | null) {
  // The server's latest answer; until the first toggle, the job's own copy is used.
  const [saved, setSaved] = useState<Record<string, string> | null>(null);
  const resolved = saved ?? job?.resolved ?? {};

  const isResolved = (index: number) => String(index) in resolved;

  const toggle = async (index: number) => {
    if (!job) return;
    const before = resolved;
    const want = !isResolved(index);
    const next = { ...before };
    if (want) next[index] = new Date().toISOString();
    else delete next[index];
    setSaved(next);
    try {
      setSaved((await api.setIssueResolved(job.id, index, want)).resolved);
    } catch (e) {
      setSaved(before);
      toast.error(e instanceof ApiError ? e.message : "Could not save the issue");
    }
  };

  return { isResolved, toggle, resolvedCount: Object.keys(resolved).length };
}
