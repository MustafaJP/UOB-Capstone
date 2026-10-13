"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayIcon } from "lucide-react";
import { toast } from "sonner";
import { FileDropzone } from "@/components/file-dropzone";
import { HealthBadge } from "@/components/health-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import type { Mode, Provider } from "@/lib/types";

const MODES = [
  { value: "api", label: "API (agents call the model)" },
  { value: "chat", label: "Copilot Chat (paste results by hand)" },
];

const PROVIDERS = [
  { value: "default", label: "Server default" },
  { value: "gemini", label: "Gemini" },
  { value: "qwen", label: "Qwen" },
];

export default function NewJobPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("api");
  const [provider, setProvider] = useState<Provider | "default">("default");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = (files.length > 0 || text.trim().length > 0) && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (text.trim()) form.append("text", text);
    form.append("mode", mode);
    if (provider !== "default") form.append("provider", provider);
    try {
      const { jobId } = await api.createJob(form);
      // Next keeps this page alive (hidden) after navigating away, so clear it for the next SOP.
      setFiles([]);
      setText("");
      setSubmitting(false);
      router.push(`/jobs/${jobId}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not start the job");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New diagram</h1>
          <p className="text-sm text-muted-foreground">
            Upload process documents. Five agents extract, refine and compose them into a BPMN swimlane diagram.
          </p>
        </div>
        <HealthBadge />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
          <CardDescription>Files, pasted text, or both.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FileDropzone files={files} onChange={setFiles} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="text">Pasted text (optional)</Label>
            <Textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste an SOP or process description…"
              className="min-h-32"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run settings</CardTitle>
          <CardDescription>You can switch between API and Copilot Chat later if a step fails.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>Mode</Label>
            <Select items={MODES} value={mode} onValueChange={(v) => v && setMode(v as Mode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Provider</Label>
            <Select
              items={PROVIDERS}
              value={provider}
              onValueChange={(v) => v && setProvider(v as Provider | "default")}
              disabled={mode === "chat"}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        <CardFooter className="justify-end border-t pt-4">
          <Button type="submit" size="lg" disabled={!canSubmit}>
            <PlayIcon />
            {submitting ? "Starting…" : "Generate diagram"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
