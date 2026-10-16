"use client";

import { useEffect, useState } from "react";
import { BotIcon, ChevronDownIcon, CogIcon, SearchIcon } from "lucide-react";
import { PILL, SeverityBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GUIDE, type GuideEntry, type IssueKind } from "@/lib/issue-guide";

const KIND: Record<IssueKind, { label: string; pill: string; icon: React.ReactNode }> = {
  deterministic: { label: "Deterministic", pill: PILL.blue, icon: <CogIcon /> },
  probabilistic: { label: "Probabilistic", pill: PILL.amber, icon: <BotIcon /> },
};

// The same steps work for every issue; each entry below adds the specifics.
const PROCESS = [
  { title: "Open the diagram", body: "On the job page, press Open in BPMN. The Issues panel sits beside the canvas." },
  { title: "Click the issue", body: "The canvas zooms to the steps involved and the card quotes the source text." },
  { title: "Check the source", body: "For a probabilistic issue, confirm the source really says it first. The agent can be wrong." },
  { title: "Fix it", body: "Edit the diagram (move, add, connect, relabel), or fix the document and run again." },
  { title: "Mark complete", body: "Then download the corrected .bpmn. Nothing is approved until a person has checked it." },
];

const FILTERS: { label: string; kind: IssueKind | null }[] = [
  { label: "All", kind: null },
  { label: "Deterministic", kind: "deterministic" },
  { label: "Probabilistic", kind: "probabilistic" },
];

function GuideCard({ entry, open, onToggle }: { entry: GuideEntry; open: boolean; onToggle: () => void }) {
  const kind = KIND[entry.kind];
  return (
    <article id={entry.code} className={cn("scroll-mt-6 rounded-xl border bg-white", open ? "border-brand-100 shadow-card" : "border-line")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <b className="block text-[14px] text-ink">{entry.title}</b>
          <code className="font-mono text-[11.5px] text-ink-3">{entry.code === "A5" ? "A5_…" : entry.code}</code>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge className={kind.pill}>
            {kind.icon}
            {kind.label}
          </Badge>
          {entry.severity ? <SeverityBadge severity={entry.severity} /> : <Badge className={PILL.grey}>Severity varies</Badge>}
          <ChevronDownIcon className={cn("size-4 text-ink-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t border-line px-4 pt-3.5 pb-4">
          <p className="text-[13px] text-ink-2">
            {entry.meaning} <span className="text-ink-3">Raised by {entry.raisedBy}.</span>
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border-l-[3px] border-brand bg-brand-50 px-3 py-2">
              <small className="block text-[11px] font-semibold tracking-wide text-brand uppercase">Source says</small>
              <p className="mt-0.5 text-[12.5px] text-ink-2">{entry.example.source}</p>
            </div>
            <div className="rounded-lg border-l-[3px] border-warn bg-warn-50 px-3 py-2">
              <small className="block text-[11px] font-semibold tracking-wide text-warn uppercase">Diagram shows</small>
              <p className="mt-0.5 text-[12.5px] text-ink-2">{entry.example.diagram}</p>
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-[13px] font-bold text-navy">How to solve it</h3>
            <ol className="flex flex-col gap-1.5">
              {entry.steps.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] text-ink-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-50 text-[11px] font-bold text-brand">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <p className="rounded-lg bg-ok-50 px-3 py-2 text-[12.5px] text-ink-2">
            <b className="text-ok">Done when: </b>
            {entry.doneWhen}
          </p>
        </div>
      )}
    </article>
  );
}

export default function IssueGuidePage() {
  const [filter, setFilter] = useState(0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  // A link such as /issues#V03_DEAD_END (from an issue card) opens that entry and scrolls to it.
  useEffect(() => {
    const show = () => {
      const code = decodeURIComponent(window.location.hash.slice(1));
      if (!code || !GUIDE.some((g) => g.code === code)) return;
      setFilter(0);
      setQuery("");
      setOpen((o) => new Set(o).add(code));
      requestAnimationFrame(() => document.getElementById(code)?.scrollIntoView({ block: "start" }));
    };
    show();
    window.addEventListener("hashchange", show);
    return () => window.removeEventListener("hashchange", show);
  }, []);

  const toggle = (code: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(code)) next.add(code);
      return next;
    });

  const q = query.trim().toLowerCase();
  const shown = GUIDE.filter(
    (g) =>
      (!FILTERS[filter].kind || g.kind === FILTERS[filter].kind) &&
      (!q || [g.code, g.title, g.meaning].some((s) => s.toLowerCase().includes(q))),
  );
  const groups = (["deterministic", "probabilistic"] as const)
    .map((kind) => ({ kind, entries: shown.filter((g) => g.kind === kind) }))
    .filter((g) => g.entries.length);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-extrabold text-navy">Issue guide</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          Every issue a run can raise, what it means, an example, and how to solve it.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card size="sm" className="px-4">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy">
            <span className={cn("grid size-7 place-items-center rounded-lg [&_svg]:size-4", PILL.blue)}>
              <CogIcon />
            </span>
            Deterministic issues
          </h2>
          <p className="text-[13px] text-ink-2">
            Raised by <b>code rules</b> (file checks, the refiner guard, graph validation, BPMN compile). The same diagram
            always gives the same result, so <b>the issue is real</b>: fix the diagram or the source document.
          </p>
        </Card>
        <Card size="sm" className="px-4">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy">
            <span className={cn("grid size-7 place-items-center rounded-lg [&_svg]:size-4", PILL.amber)}>
              <BotIcon />
            </span>
            Probabilistic issues
          </h2>
          <p className="text-[13px] text-ink-2">
            Raised by the <b>AI agents</b> (A1–A5) while reading the source. They can change between runs and{" "}
            <b>can be wrong</b>, so check the quoted source before you act, then fix the diagram or mark the issue complete.
          </p>
        </Card>
      </div>

      <Card className="gap-3 px-5">
        <h2 className="text-[15px] font-bold text-navy">How to resolve any issue</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PROCESS.map((p, i) => (
            <li key={p.title} className="flex gap-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-white">{i + 1}</span>
              <span>
                <b className="block text-[13px] text-ink">{p.title}</b>
                <span className="text-[12.5px] text-ink-2">{p.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="text-[12.5px] text-ink-3">
          Work through <b className="text-uob-red">Critical</b> issues first (the BPMN is only a draft while they remain), then{" "}
          <b className="text-warn">Review</b>, then <b>Info</b>.
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-white px-3 py-2 text-ink-3 focus-within:border-brand">
          <SearchIcon className="size-[18px]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by issue name or code, e.g. dead end or V03"
            className="w-full bg-transparent text-ink outline-none placeholder:text-ink-3"
          />
        </label>
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={filter === i}
            onClick={() => setFilter(i)}
            className={cn(
              "rounded-full px-2.5 py-[3px] text-xs font-semibold transition-colors",
              filter === i ? PILL.blue : cn(PILL.grey, "hover:text-ink"),
            )}
          >
            {f.label} {GUIDE.filter((g) => !f.kind || g.kind === f.kind).length}
          </button>
        ))}
      </div>

      {!groups.length && <p className="py-10 text-center text-sm text-ink-3">No issues match this search.</p>}
      {groups.map(({ kind, entries }) => (
        <section key={kind} className="flex flex-col gap-2">
          <h2 className="text-[15px] font-bold text-navy">
            {KIND[kind].label} <span className="font-normal text-ink-3">· {entries.length}</span>
          </h2>
          {entries.map((entry) => (
            <GuideCard key={entry.code} entry={entry} open={open.has(entry.code)} onToggle={() => toggle(entry.code)} />
          ))}
        </section>
      ))}
    </div>
  );
}
