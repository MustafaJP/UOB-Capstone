"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, PaperclipIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { ROLE_NAMES, type ChatHandoff as Handoff } from "@/lib/types";

// Names for the passes inside a step, matching the pipeline stepper, so the analyst knows which prompt this is.
const PASS_NAMES: Record<string, string> = {
  "extract text": "Steps",
  "extract decisions": "Decisions",
  "extract actors": "Owners",
  "fill coverage gaps": "Coverage",
  "refine extraction": "Merge",
  "audit claims": "Audit against sources",
  "repair graph": "Fix process flow",
  "re-review": "Re-check fixes",
};
// Single-pass steps show only the step name; older saved runs carry no step.
const promptTitle = (p: Handoff) => {
  const pass = (p.step && PASS_NAMES[p.step]) || (p.schema === "A4_PATCH" ? PASS_NAMES["repair graph"] : undefined);
  return pass ? `${ROLE_NAMES[p.role]} · ${pass} prompt` : `${ROLE_NAMES[p.role]} prompt`;
};

const PLACEHOLDER: Partial<Record<Handoff["schema"], string>> = {
  A3_PATCH: '{ "upsert_claims": [...], "changes": [...], ... }',
  A4_PATCH: '{ "upsert_nodes": [...], "remove_ids": [...], ... }',
};

/** Copilot Chat fallback: copy the prompt into chat, paste the JSON answer back. */
export function ChatHandoff({ jobId, pending, onResumed }: { jobId: string; pending: Handoff; onResumed: () => void }) {
  const [response, setResponse] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pending.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard is not available. Select the prompt text and copy it manually.");
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.resumeJob(jobId, response);
      toast.success(`${pending.role} result accepted`);
      setResponse("");
      onResumed();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{promptTitle(pending)}</CardTitle>
        <CardDescription>
          Copy the prompt into Copilot Chat, attach the files listed below, then paste the JSON it returns.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Prompt</Label>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy prompt"}
            </Button>
          </div>
          <ScrollArea className="h-64 rounded-lg border bg-muted/30">
            <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{pending.prompt}</pre>
          </ScrollArea>
        </div>

        {pending.attachments.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Download these images and attach them in the chat</Label>
            <ul className="flex flex-col gap-1 text-sm">
              {pending.attachments.map((a) => (
                <li key={a} className="flex items-center gap-2 text-muted-foreground">
                  <PaperclipIcon className="size-3.5 shrink-0" />
                  <span className="flex-1">{a}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<a href={api.attachmentUrl(jobId, a.split(":")[0])} download />}
                  >
                    <DownloadIcon />
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="chat-response">Chat response (JSON)</Label>
          <Textarea
            id="chat-response"
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder={PLACEHOLDER[pending.schema] ?? '{ "actors": [...], ... }'}
            className="min-h-40 font-mono text-xs"
            aria-invalid={error?.code === "CHAT_RESULT_INVALID" || undefined}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>{error.message}</AlertTitle>
            {error.detailLines.length > 0 && (
              <AlertDescription>
                <ul className="list-disc pl-4 font-mono text-xs">
                  {error.detailLines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </AlertDescription>
            )}
          </Alert>
        )}

        <div className="flex justify-end">
          <Button onClick={submit} disabled={!response.trim() || submitting}>
            <SendIcon />
            {submitting ? "Submitting…" : "Submit result"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
