import Link from "next/link";
import { CheckIcon, CrosshairIcon, RotateCcwIcon } from "lucide-react";
import { PILL, SeverityBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { diagramHref, issueTarget } from "@/lib/diagram";
import type { A4Graph, Issue, Severity } from "@/lib/types";

const ORDER: Record<Severity, number> = { blocking: 0, review: 1, info: 2 };

const Refs = ({ ids }: { ids: string[] }) =>
  ids.length ? <span className="font-mono text-xs">{ids.join(", ")}</span> : <span className="text-muted-foreground">-</span>;

/**
 * All issues of a run, most severe first. Numbers (#1, #2…) follow the server's order, the same
 * numbers the diagram's issue panel shows. With a diagram (jobId + graph), issues that sit on it
 * link to the diagram page zoomed to them. With resolved/onToggleResolved, issues can be marked
 * complete (shown as Complete instead of their severity, and listed last).
 */
export function IssuesTable({
  issues,
  jobId,
  graph,
  isResolved = () => false,
  onToggleResolved,
}: {
  issues: Issue[];
  jobId?: string;
  graph?: A4Graph | null;
  isResolved?: (index: number) => boolean;
  onToggleResolved?: (index: number) => void;
}) {
  if (!issues.length) return <p className="py-8 text-center text-sm text-muted-foreground">No issues raised.</p>;
  const rank = (index: number, issue: Issue) => (isResolved(index) ? 3 : ORDER[issue.severity]);
  const sorted = issues.map((issue, index) => ({ issue, index })).sort((a, b) => rank(a.index, a.issue) - rank(b.index, b.issue));
  const linkable = !!jobId && !!graph;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead className="w-24">Severity</TableHead>
          <TableHead className="w-48">Code</TableHead>
          <TableHead>Message</TableHead>
          <TableHead className="w-32">Elements</TableHead>
          <TableHead className="w-32">Evidence</TableHead>
          {linkable && <TableHead className="w-36">Diagram</TableHead>}
          {onToggleResolved && <TableHead className="w-36" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map(({ issue, index }) => (
          <TableRow key={index} className={isResolved(index) ? "bg-ok-50/40" : undefined}>
            <TableCell className="font-mono text-xs text-ink-3">{index + 1}</TableCell>
            <TableCell>
              {isResolved(index) ? <Badge className={PILL.green}>✓ Complete</Badge> : <SeverityBadge severity={issue.severity} />}
            </TableCell>
            <TableCell className="font-mono text-xs">{issue.code}</TableCell>
            <TableCell className="whitespace-normal">{issue.message}</TableCell>
            <TableCell className="whitespace-normal">
              <Refs ids={issue.element_ids} />
            </TableCell>
            <TableCell className="whitespace-normal">
              <Refs ids={issue.evidence_refs} />
            </TableCell>
            {linkable && (
              <TableCell>
                {issueTarget(issue, graph).kind !== "none" ? (
                  <Link
                    href={`${diagramHref(jobId)}?issue=${index + 1}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                  >
                    <CrosshairIcon className="size-3.5" />
                    Show on diagram
                  </Link>
                ) : (
                  <span className="text-xs text-ink-3">Not on diagram</span>
                )}
              </TableCell>
            )}
            {onToggleResolved && (
              <TableCell className="text-right">
                <Button variant={isResolved(index) ? "ghost" : "outline"} size="sm" className="h-7 text-xs" onClick={() => onToggleResolved(index)}>
                  {isResolved(index) ? <RotateCcwIcon /> : <CheckIcon />}
                  {isResolved(index) ? "Reopen" : "Mark complete"}
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
