import { CheckIcon, Loader2Icon, MessageSquareTextIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { JobStatus, Severity } from "@/lib/types";

/** Pill tones from the mockup. */
export const PILL = {
  green: "bg-ok-50 text-ok",
  red: "bg-uob-red-50 text-uob-red",
  amber: "bg-warn-50 text-warn",
  blue: "bg-brand-50 text-brand",
  grey: "bg-line-2 text-ink-2",
} as const;

const STATUS: Record<JobStatus, { label: string; className: string; icon: React.ReactNode }> = {
  running: { label: "Running", className: PILL.blue, icon: <Loader2Icon className="animate-spin" /> },
  awaiting_chat: { label: "Awaiting chat result", className: PILL.amber, icon: <MessageSquareTextIcon /> },
  done: { label: "Completed", className: PILL.green, icon: <CheckIcon /> },
  failed: { label: "Needs action", className: PILL.red, icon: <TriangleAlertIcon /> },
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <Badge className={cn(s.className, className)}>
      {s.icon}
      {s.label}
    </Badge>
  );
}

const SEVERITY: Record<Severity, string> = {
  blocking: PILL.red,
  review: PILL.amber,
  info: PILL.grey,
};

// "blocking" is the server's severity value; users see it as Critical.
const SEVERITY_LABEL: Record<Severity, string> = { blocking: "Critical", review: "Review", info: "Info" };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge className={SEVERITY[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}
