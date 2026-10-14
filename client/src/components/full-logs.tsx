"use client";

import { useState } from "react";
import { PILL } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stepOwner, type JobView, type Role, type TraceEntry } from "@/lib/types";

type Owner = Role | "system";

// Button order: the agents in pipeline order, then the code checks.
const OWNERS: Owner[] = ["A1", "A2", "A3", "A4", "A5", "system"];

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** One pass of an agent: its trace line and the JSON it produced. */
function PassLog({ t, n, name }: { t: TraceEntry; n: number; name: string }) {
  const json = t.output === undefined ? null : JSON.stringify(t.output, null, 2);
  return (
    <div className="rounded-[10px] border border-line">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-xs">
        <span className="font-semibold text-ink first-letter:uppercase">
          {n}. {t.step}
        </span>
        <span className="text-ink-3">
          {t.provider}
          {t.model && ` · ${t.model}`} · {(t.ms / 1000).toFixed(1)} s
        </span>
        {t.ok ? <Badge className={PILL.green}>✓ OK</Badge> : <Badge className={PILL.red}>Failed</Badge>}
        {json && (
          <span className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(json)}>
              Copy
            </Button>
            <Button variant="outline" size="sm" onClick={() => download(`${name}.json`, t.output)}>
              Download
            </Button>
          </span>
        )}
      </div>
      {t.note && <p className="border-b border-line px-3 py-2 text-xs text-ink-2">{t.note}</p>}
      {json ? (
        <pre className="max-h-[28rem] overflow-auto bg-slate-50 p-3 text-[11px] leading-snug whitespace-pre text-ink-2">{json}</pre>
      ) : (
        <p className="p-3 text-xs text-ink-3">No output recorded for this pass (run saved before full logs existed).</p>
      )}
    </div>
  );
}

/** Every pass of every agent with the values it produced, for developers to check the pipeline. */
export function FullLogs({ job }: { job: JobView }) {
  const present = OWNERS.filter((o) => job.trace.some((t) => t.role === o));
  const [picked, setPicked] = useState<Owner | null>(null);
  const owner = picked && present.includes(picked) ? picked : present[0];

  if (!owner) return <p className="py-10 text-center text-sm text-ink-3">No steps recorded yet.</p>;
  const passes = job.trace.filter((t) => t.role === owner);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {present.map((o) => (
          <Button
            key={o}
            variant={o === owner ? "default" : "outline"}
            size="sm"
            onClick={() => setPicked(o)}
            className={cn(o === owner && "pointer-events-none")}
          >
            {stepOwner(o)}
            <span className="ml-1 opacity-70">({job.trace.filter((t) => t.role === o).length})</span>
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => download(`full-logs-${job.id.slice(0, 8)}.json`, job.trace)}
        >
          Download all logs
        </Button>
      </div>
      {passes.map((t, i) => (
        <PassLog key={i} t={t} n={i + 1} name={`${owner}-${t.step}-${i + 1}`.replace(/\s+/g, "-")} />
      ))}
    </div>
  );
}
