"use client";

import dynamic from "next/dynamic";
import { CheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { IssuesTable } from "@/components/issues-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { stepOwner, type A4Graph, type Issue, type JobView, type RefineChange } from "@/lib/types";

const BpmnModeler = dynamic(() => import("@/components/bpmn-modeler"), {
  ssr: false,
  loading: () => <div className="h-[640px] animate-pulse rounded-lg border bg-muted/40" />,
});

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>
);

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
      <h3 className="font-medium">{graph.title}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {graph.lanes.map((lane) => {
          const nodes = graph.nodes.filter((n) => n.lane_id === lane.id);
          return (
            <div key={lane.id} className="rounded-lg border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                <span className="text-sm font-medium">{lane.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{lane.id}</span>
              </div>
              <ul className="divide-y">
                {nodes.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <Badge variant="outline" className="mt-0.5">
                      {NODE_TYPE[n.type]}
                    </Badge>
                    <span className="flex-1">{n.label}</span>
                    {n.origin === "inferred" && <Badge variant="secondary">inferred</Badge>}
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

/** Shown above a draft diagram: what blocks it and how to fix it in the editor. */
function DraftBanner({ issues }: { issues: Issue[] }) {
  return (
    <Alert variant="destructive" className="mb-3">
      <TriangleAlertIcon />
      <AlertTitle>Draft: {issues.length === 1 ? "1 error" : `${issues.length} errors`} to fix before this is valid BPMN</AlertTitle>
      <AlertDescription>
        <p>
          The automatic fixes could not resolve these. The affected elements are outlined in red. Fix them in the
          editor below, then use Download .bpmn to save your corrected version.
        </p>
        <ul className="mt-1 list-disc pl-5">
          {issues.map((i, n) => (
            <li key={n}>
              {i.message}
              {i.element_ids.length > 0 && <span className="font-mono text-xs"> ({i.element_ids.join(", ")})</span>}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
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

export function ResultTabs({ job }: { job: JobView }) {
  const result = job.result;
  const notReady = <Empty>Available when the job is done.</Empty>;
  const blocking = result?.issues.filter((i) => i.severity === "blocking").length ?? 0;
  // Validation (V..) and draft errors are what keep a draft from being valid BPMN.
  const draftErrors = result?.draft
    ? result.issues.filter((i) => i.severity === "blocking" && /^(V\d\d_|DRAFT_)/.test(i.code))
    : [];

  return (
    // Remount when the result arrives so the Diagram tab opens by default.
    <Tabs key={result ? "done" : "pending"} defaultValue={result ? "diagram" : "trace"}>
      <TabsList className="flex-wrap">
        <TabsTrigger value="diagram">Diagram</TabsTrigger>
        <TabsTrigger value="issues">
          Issues
          {result && result.issues.length > 0 && (
            <Badge variant={blocking ? "destructive" : "secondary"} className="h-4 px-1.5">
              {result.issues.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="graph">Graph</TabsTrigger>
        <TabsTrigger value="changes">Refiner changes</TabsTrigger>
        <TabsTrigger value="evidence">Evidence</TabsTrigger>
        <TabsTrigger value="trace">Trace</TabsTrigger>
      </TabsList>

      {/* keepMounted so switching tabs does not throw away edits in the modeler. */}
      <TabsContent value="diagram" className="pt-3" keepMounted>
        {!result ? (
          notReady
        ) : result.bpmnXml ? (
          <>
            {result.draft && <DraftBanner issues={draftErrors} />}
            <BpmnModeler
              xml={result.bpmnXml}
              filename={`process-${job.id.slice(0, 8)}${result.draft ? "-draft" : ""}`}
              errorIds={draftErrors.flatMap((i) => i.element_ids)}
            />
          </>
        ) : (
          <Empty>No BPMN was compiled: the graph has structural errors. See the Issues tab.</Empty>
        )}
      </TabsContent>

      <TabsContent value="issues" className="pt-3">
        {result ? <IssuesTable issues={result.issues} /> : notReady}
      </TabsContent>

      <TabsContent value="graph" className="pt-3">
        {result?.graph ? <GraphView graph={result.graph} /> : result ? <Empty>No graph was produced.</Empty> : notReady}
      </TabsContent>

      <TabsContent value="changes" className="pt-3">
        {result ? <ChangesTable changes={result.changes} /> : notReady}
      </TabsContent>

      <TabsContent value="evidence" className="pt-3">
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

      <TabsContent value="trace" className="pt-3">
        {job.trace.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Stage</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Provider / model</TableHead>
                <TableHead className="w-20 text-right">Time</TableHead>
                <TableHead className="w-12">OK</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {job.trace.map((t, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{stepOwner(t.role)}</TableCell>
                  <TableCell>{t.step}</TableCell>
                  <TableCell className="text-xs">
                    {t.provider}
                    {t.model && <span className="text-muted-foreground"> · {t.model}</span>}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{(t.ms / 1000).toFixed(1)} s</TableCell>
                  <TableCell>
                    {t.ok ? (
                      <CheckIcon className="size-4 text-emerald-600" />
                    ) : (
                      <XIcon className="size-4 text-destructive" />
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-normal text-muted-foreground">{t.note ?? ""}</TableCell>
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
