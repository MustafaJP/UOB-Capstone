"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { JobView } from "@/lib/types";

const POLL_MS = 2000;

/**
 * Loads a job and polls every 2 s while it is running.
 * Polling stops on awaiting_chat / done / failed; call refresh() after resume or mode switch to restart it.
 */
export function useJob(id: string) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const view = await api.getJob(id);
        if (cancelled) return;
        setJob(view);
        setError(null);
        if (view.status === "running") timer.current = setTimeout(load, POLL_MS);
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", String(e));
        setError(err);
        // Keep trying through network blips, but not for a job that does not exist.
        if (err.code !== "JOB_NOT_FOUND") timer.current = setTimeout(load, POLL_MS * 2);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { job, error, refresh };
}
