"use client";

import { IssuesTable } from "@/components/issues-table";
import { PILL } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { stepOwner, type A4Graph, type JobView, type RefineChange } from "@/lib/types";

export type ResultTab = "issues" | "graph" | "changes" | "evidence" | "trace";

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

const NODE_TYPE: Record<A4Graph["nodes"][number]["type"], string> = {
  start: "Start",
  end: "End",
  task: "Task",
  exclusive_gateway: "Decision",
};

function GraphView({ graph }: { graph: A4Graph }) {
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-base font-bold text-navy">{graph.title}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {graph.lanes.map((lane) => {
          const nodes = graph.nodes.filter((n) => n.lane_id === lane.id);
          return (
            <div key={lane.id} className="overflow-hidden rounded-xl border border-line">
              <div className="flex items-center justify-between bg-navy px-3 py-2 text-white">
                <span className="text-sm font-semibold">{lane.name}</span>
                <span className="font-mono text-xs text-white/60">{lane.id}</span>
              </div>
              <ul className="divide-y">
                {nodes.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <Badge variant="outline" className="mt-0.5">
                      {NODE_TYPE[n.type]}
                    </Badge>
                    <span className="flex-1">{n.label}</span>
                    {n.origin === "inferred" && <Badge className={PILL.amber}>inferred</Badge>}
                    <span className="font-mono text-xs text-muted-foreground">{n.id}</span>
                  </li>
                ))}
                {!nodes.length && <li className="px-3 py-2 text-sm text-muted-foreground">No nodes</li>}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Flows ({graph.edges.length})</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">ID</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead className="w-24">Origin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {graph.edges.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs">{e.id}</TableCell>
                <TableCell className="whitespace-normal">{label.get(e.source_id) ?? e.source_id}</TableCell>
                <TableCell className="whitespace-normal">{label.get(e.target_id) ?? e.target_id}</TableCell>
                <TableCell className="whitespace-normal">{e.label ?? "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{e.origin}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ChangesTable({ changes }: { changes: RefineChange[] }) {
  if (!changes.length) return <Empty>The refiner made no changes.</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Type</TableHead>
          <TableHead className="w-48">Upstream</TableHead>
          <TableHead className="w-24">Result</TableHead>
          <TableHead>Reason</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {changes.map((c, i) => (
          <TableRow key={i}>
            <TableCell>
              <Badge variant="outline">{c.type}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs whitespace-normal">{c.upstream_ids.join(", ")}</TableCell>
            <TableCell className="font-mono text-xs">{c.result_id ?? "-"}</TableCell>
            <TableCell className="whitespace-normal">{c.reason}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ResultTabs({
  job,
  tab,
  onTabChange,
}: {
  job: JobView;
  tab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
}) {
  const result = job.result;
  const notReady = <Empty>Available when the job is done.</Empty>;
  const blocking = result?.issues.filter((i) => i.severity === "blocking").length ?? 0;

  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as ResultTab)} className="gap-0">
      <TabsList
        variant="line"
        className="h-auto! w-full justify-start gap-0.5 overflow-x-auto overflow-y-hidden rounded-none border-b border-line p-0"
      >
        <TabsTrigger value="issues" className={TRIGGER}>
          Issues
          {result && result.issues.length > 0 && <Count n={result.issues.length} tone={blocking ? "red" : "grey"} />}
        </TabsTrigger>
        <TabsTrigger value="graph" className={TRIGGER}>
          Graph
        </TabsTrigger>
        <TabsTrigger value="changes" className={TRIGGER}>
          Refiner changes
        </TabsTrigger>
        <TabsTrigger value="evidence" className={TRIGGER}>
          Evidence
          {job.evidence.length > 0 && <Count n={job.evidence.length} />}
        </TabsTrigger>
        <TabsTrigger value="trace" className={TRIGGER}>
          Trace
          {job.trace.length > 0 && <Count n={job.trace.length} />}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="issues" className={PANEL}>
        {result ? <IssuesTable issues={result.issues} /> : notReady}
      </TabsContent>

      <TabsContent value="graph" className={PANEL}>
        {result?.graph ? <GraphView graph={result.graph} /> : result ? <Empty>No graph was produced.</Empty> : notReady}
      </TabsContent>

      <TabsContent value="changes" className={PANEL}>
        {result ? <ChangesTable changes={result.changes} /> : notReady}
      </TabsContent>

      <TabsContent value="evidence" className={PANEL}>
        {job.evidence.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">ID</TableHead>
                <TableHead className="w-20">Kind</TableHead>
                <TableHead className="w-56">Source</TableHead>
                <TableHead>Excerpt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {job.evidence.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.id}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{e.kind}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {e.source}
                    {e.page != null && <span className="text-muted-foreground"> · p.{e.page}</span>}
                  </TableCell>
                  <TableCell className="text-xs whitespace-normal text-muted-foreground">{e.excerpt ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty>No evidence yet.</Empty>
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
    </Tabs>
  );
}
