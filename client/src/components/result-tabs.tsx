"use client";

import { FullLogs } from "@/components/full-logs";
import { IssuesTable } from "@/components/issues-table";
import { PILL } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { stepOwner, type JobView } from "@/lib/types";

export type ResultTab = "issues" | "trace" | "logs";

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="py-10 text-center text-sm text-ink-3">{children}</p>
);

/** Tab count chip, as in the mockup ("Trace 7"). */
const Count = ({ n, tone = "grey" }: { n: number; tone?: "grey" | "red" }) => (
  <span className={cn("rounded-full px-[7px] text-[11px]", tone === "red" ? PILL.red : PILL.grey)}>{n}</span>
);

// Panels sit in a card joined to the tab strip (square top corners, no top border).
const PANEL = "overflow-x-auto rounded-b-[14px] border border-t-0 border-line bg-white p-4 shadow-card sm:p-[18px]";

const TRIGGER =
  "h-auto flex-none rounded-none border-0 border-b-2 border-transparent px-3.5 py-2.5 text-sm font-semibold text-ink-3 -mb-px after:hidden hover:text-ink data-active:border-brand data-active:text-brand data-active:shadow-none";

export function ResultTabs({
  job,
  tab,
  onTabChange,
  isResolved,
  onToggleResolved,
}: {
  job: JobView;
  tab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
  isResolved: (index: number) => boolean;
  onToggleResolved: (index: number) => void;
}) {
  const result = job.result;
  const notReady = <Empty>Available when the job is done.</Empty>;
  const open = result?.issues.filter((_, n) => !isResolved(n)) ?? [];
  const blocking = open.filter((i) => i.severity === "blocking").length;

  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as ResultTab)} className="gap-0">
      <TabsList
        variant="line"
        className="h-auto! w-full justify-start gap-0.5 overflow-x-auto overflow-y-hidden rounded-none border-b border-line p-0"
      >
        <TabsTrigger value="issues" className={TRIGGER}>
          Issues
          {open.length > 0 && <Count n={open.length} tone={blocking ? "red" : "grey"} />}
        </TabsTrigger>
        <TabsTrigger value="trace" className={TRIGGER}>
          Trace
          {job.trace.length > 0 && <Count n={job.trace.length} />}
        </TabsTrigger>
        <TabsTrigger value="logs" className={TRIGGER}>
          Full logs
        </TabsTrigger>
      </TabsList>

      <TabsContent value="issues" className={PANEL}>
        {result ? (
          <IssuesTable
            issues={result.issues}
            jobId={job.id}
            evidence={job.evidence}
            graph={result.bpmnXml ? result.graph : null}
            isResolved={isResolved}
            onToggleResolved={onToggleResolved}
          />
        ) : (
          notReady
        )}
      </TabsContent>

      <TabsContent value="trace" className={PANEL}>
        {job.trace.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Role</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Provider / model</TableHead>
                <TableHead className="w-20 text-right">Time</TableHead>
                <TableHead className="w-24">Result</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {job.trace.map((t, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{stepOwner(t.role)}</TableCell>
                  <TableCell className="first-letter:uppercase">{t.step}</TableCell>
                  <TableCell className="text-xs">
                    {t.provider}
                    {t.model && <span className="text-muted-foreground"> · {t.model}</span>}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{(t.ms / 1000).toFixed(1)} s</TableCell>
                  <TableCell>
                    {t.ok ? (
                      <Badge className={PILL.green}>✓ OK</Badge>
                    ) : (
                      <Badge className={PILL.red}>Failed</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-normal text-ink-2">{t.note ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty>No steps recorded yet.</Empty>
        )}
      </TabsContent>

      <TabsContent value="logs" className={PANEL}>
        <FullLogs job={job} />
      </TabsContent>
    </Tabs>
  );
}
