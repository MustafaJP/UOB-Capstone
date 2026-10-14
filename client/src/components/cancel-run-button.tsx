"use client";

import { useState } from "react";
import { SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

/**
 * POST /v1/jobs/:id/cancel. Stops a running or chat-paused job; it ends as failed (code CANCELLED)
 * with its finished steps kept, so it can still be resumed via API or Copilot Chat.
 * iconOnly: the compact form for the run history table.
 */
export function CancelRunButton({
  jobId,
  title,
  onCancelled,
  iconOnly = false,
}: {
  jobId: string;
  title?: string | null;
  onCancelled: () => void;
  iconOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    const name = title ? `"${title}"` : "this run";
    if (!window.confirm(`Cancel ${name}? Finished steps are kept, so you can resume it later.`)) return;
    setBusy(true);
    try {
      await api.cancelJob(jobId);
      toast.success("Run cancelled");
      onCancelled();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not cancel the run");
    } finally {
      setBusy(false);
    }
  };

  if (iconOnly)
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Cancel run"
        title="Cancel run"
        disabled={busy}
        onClick={() => void cancel()}
      >
        <SquareIcon />
      </Button>
    );
  return (
    <Button variant="destructive" size="sm" disabled={busy} onClick={() => void cancel()}>
      <SquareIcon />
      {busy ? "Cancelling…" : "Cancel run"}
    </Button>
  );
}
