import { SeverityBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Issue, Severity } from "@/lib/types";

const ORDER: Record<Severity, number> = { blocking: 0, review: 1, info: 2 };

const Refs = ({ ids }: { ids: string[] }) =>
  ids.length ? <span className="font-mono text-xs">{ids.join(", ")}</span> : <span className="text-muted-foreground">-</span>;

export function IssuesTable({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="py-8 text-center text-sm text-muted-foreground">No issues raised.</p>;
  const sorted = [...issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Severity</TableHead>
          <TableHead className="w-48">Code</TableHead>
          <TableHead>Message</TableHead>
          <TableHead className="w-32">Elements</TableHead>
          <TableHead className="w-32">Evidence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((issue, i) => (
          <TableRow key={i}>
            <TableCell>
              <SeverityBadge severity={issue.severity} />
            </TableCell>
            <TableCell className="font-mono text-xs">{issue.code}</TableCell>
            <TableCell className="whitespace-normal">{issue.message}</TableCell>
            <TableCell className="whitespace-normal">
              <Refs ids={issue.element_ids} />
            </TableCell>
            <TableCell className="whitespace-normal">
              <Refs ids={issue.evidence_refs} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
