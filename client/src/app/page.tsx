"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayIcon, ShieldIcon } from "lucide-react";
import { toast } from "sonner";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PROVIDER_OPTIONS, type Mode, type Provider } from "@/lib/types";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "api", label: "API", hint: "Agents call the model" },
  { value: "chat", label: "Copilot Chat", hint: "Copy & paste" },
];

const PROVIDERS = [
  { value: "default", label: "Server default" },
  ...PROVIDER_OPTIONS,
];

/** Two-option segmented control (the mockup's Route picker). */
function RouteSegment({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="radiogroup" aria-label="Route" className="grid grid-cols-2 gap-1 rounded-[10px] bg-line-2 p-1">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={value === m.value}
          onClick={() => onChange(m.value)}
          className={cn(
            "rounded-lg px-2.5 py-2 text-center text-[13px] font-semibold text-ink-2 transition-colors",
            value === m.value ? "bg-white text-brand shadow-card" : "hover:text-ink",
          )}
        >
          {m.label}
          <small className="block text-[11px] font-normal text-ink-3">{m.hint}</small>
        </button>
      ))}
    </div>
  );
}

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
    <form onSubmit={submit} className="flex flex-col">
      <h1 className="text-[26px] font-extrabold text-navy sm:text-[30px]">New diagram</h1>
      <p className="mt-1.5 mb-[22px] text-[15px] text-ink-2">
        Upload process documents. Five agents extract, refine and compose them into a BPMN swimlane diagram.
      </p>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>1 · Add your sources</CardTitle>
            <CardDescription className="text-[13px]">
              Files, pasted text, or both. Text and diagrams can be mixed in one run.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FileDropzone files={files} onChange={setFiles} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="text" className="text-[13px] font-semibold">
                Pasted text <span className="font-normal text-ink-3">(optional)</span>
              </Label>
              <Textarea
                id="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste an SOP section or a process description…"
                className="min-h-[110px] rounded-[10px] bg-[#fcfcfd] placeholder:text-ink-3"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · Run settings</CardTitle>
            <CardDescription className="text-[13px]">You can switch route later if a step fails.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">Route</span>
              <RouteSegment value={mode} onChange={setMode} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px] font-semibold">Provider</Label>
              <Select
                items={PROVIDERS}
                value={provider}
                onValueChange={(v) => v && setProvider(v as Provider | "default")}
                disabled={mode === "chat"}
              >
                <SelectTrigger className="h-10 w-full rounded-[10px] bg-[#fcfcfd]">
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
              {mode === "chat" && (
                <small className="text-xs text-ink-3">Copilot Chat runs each step in your own chat window.</small>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex-col items-stretch justify-between gap-3 border-line bg-[#fafafb] sm:flex-row sm:items-center">
            <small className="text-ink-3">Est. 7–10 min</small>
            <Button type="submit" size="lg" disabled={!canSubmit}>
              <PlayIcon className="fill-current" />
              {submitting ? "Starting…" : "Generate diagram"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </form>
  );
}
