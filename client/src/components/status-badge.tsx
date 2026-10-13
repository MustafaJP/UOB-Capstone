import { CheckCircle2Icon, Loader2Icon, MessageSquareTextIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { JobStatus, Severity } from "@/lib/types";

const STATUS: Record<JobStatus, { label: string; className: string; icon: React.ReactNode }> = {
  running: {
    label: "Running",
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    icon: <Loader2Icon className="animate-spin" />,
  },
  awaiting_chat: {
    label: "Awaiting chat result",
    className: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    icon: <MessageSquareTextIcon />,
  },
  done: {
    label: "Done",
    className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    icon: <CheckCircle2Icon />,
  },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive", icon: <XCircleIcon /> },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status];
  return (
    <Badge className={s.className}>
      {s.icon}
      {s.label}
    </Badge>
  );
}

const SEVERITY: Record<Severity, string> = {
  blocking: "bg-destructive/10 text-destructive",
  review: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  info: "bg-muted text-muted-foreground",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge className={SEVERITY[severity]}>{severity}</Badge>;
}
