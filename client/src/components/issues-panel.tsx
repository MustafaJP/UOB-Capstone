"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpenIcon, CheckIcon, CrosshairIcon, RotateCcwIcon } from "lucide-react";
import { PILL } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IssueTarget } from "@/lib/diagram";
import { guideFor } from "@/lib/issue-guide";
import type { A4Graph, EvidenceView, Issue, Severity } from "@/lib/types";

const SEVERITY: Record<Severity, { label: string; pill: string }> = {
  blocking: { label: "Critical", pill: PILL.red },
  review: { label: "Review", pill: PILL.amber },
  info: { label: "Info", pill: PILL.grey },
};
export const SEVERITY_ORDER: Record<Severity, number> = { blocking: 0, review: 1, info: 2 };

// Short titles for the codes the server's checks raise; anything else (e.g. the critic's own
// codes) is turned from SOME_CODE into "Some code".
const TITLES: Record<string, string> = {
  V01_DUPLICATE_ID: "Duplicate element",
  V01_DANGLING_EDGE: "Flow points to a missing step",
  V01_DANGLING_ANNOTATION: "Note points to a missing step",
  V02_NO_START: "No start event",
  V02_NO_END: "No end event",
  V02_START_INCOMING: "Start event has an incoming flow",
  V02_END_OUTGOING: "End event has an outgoing flow",
  V03_UNREACHABLE: "Step can't be reached",
  V03_DEAD_END: "Path leads nowhere",
  V04_UNLABELLED_BRANCH: "Decision branch has no label",
  V04_GATEWAY_BRANCHES: "Decision needs two or more exits",
  V06_LANE_MISSING: "Step has no owner",
  V07_INFERRED: "Step was inferred",
  V07_NO_EVIDENCE: "Step has no evidence",
  COVERAGE_UNCITED: "Source text not used",
  REVIEW_INCOMPLETE: "Check not finished",
  DRAFT_ELEMENTS_DROPPED: "Elements left out of the draft",
};
export const issueTitle = (code: string) => {
  if (TITLES[code]) return TITLES[code];
  const words = code.replace(/^V\d\d_/, "").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const MAX_QUOTE = 220;
const MAX_CHIPS = 6;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The run's issues beside the diagram: open ones most severe first, completed ones last. Clicking
 * one with diagram elements selects it (the canvas zooms to and highlights them); the selected
 * card is scrolled into view when the selection comes from a link (?issue=N).
 */
export function IssuesPanel({
  issues,
  targets,
  graph,
  evidence,
  selected,
  onSelect,
  isResolved,
  onToggleResolved,
}: {
  issues: Issue[];
  /** Where each issue sits on the diagram (same order as issues). */
  targets: IssueTarget[];
  graph: A4Graph | null;
  evidence: EvidenceView[];
  /** Index into issues. */
  selected: number | null;
  onSelect: (index: number | null) => void;
  isResolved: (index: number) => boolean;
  onToggleResolved: (index: number) => void;
}) {
  const [filter, setFilter] = useState<Severity | "all" | "complete">("all");
  const cards = useRef(new Map<number, HTMLElement>());

  const names = new Map<string, string>();
  for (const l of graph?.lanes ?? []) names.set(l.id, `${l.name} lane`);
  for (const n of graph?.nodes ?? []) names.set(n.id, n.label);
  for (const e of graph?.edges ?? []) names.set(e.id, e.label ? `"${e.label}" flow` : "Flow");
  const sources = new Map(evidence.map((e) => [e.id, e]));
  // Messages name elements by ID ("N_c_step34 is inferred…"): show their labels instead.
  const idPattern = names.size
    ? new RegExp(`\\b(${[...names.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})\\b`, "g")
    : null;
  const readable = (text: string) => (idPattern ? text.replace(idPattern, (id) => `“${names.get(id)}”`) : text);

  // Severity counts are of open issues only; completed ones are counted on their own.
  const counts = { blocking: 0, review: 0, info: 0, complete: 0 };
  issues.forEach((i, n) => counts[isResolved(n) ? "complete" : i.severity]++);
  const rank = (index: number, severity: Severity) => (isResolved(index) ? 3 : SEVERITY_ORDER[severity]);
  const order = issues
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue, index }) => {
      // The selected issue stays listed even when the filter would hide it (e.g. one opened from a link).
      if (filter === "all" || index === selected) return true;
      return filter === "complete" ? isResolved(index) : !isResolved(index) && issue.severity === filter;
    })
    .sort((a, b) => rank(a.index, a.issue.severity) - rank(b.index, b.issue.severity));

  // Bring the selected card into view. The first time (an issue linked from the job page) jumps
  // straight there: a smooth scroll down a long list can stop short while the list lays out.
  const scrolled = useRef(false);
  useEffect(() => {
    if (selected == null) return;
    cards.current.get(selected)?.scrollIntoView({ behavior: scrolled.current ? "smooth" : "auto", block: "center" });
    scrolled.current = true;
  }, [selected]);

  const toCheck = counts.blocking + counts.review;
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-line bg-white shadow-card">
      <div className="flex items-center justify-between gap-2 px-[18px] pt-4">
        <h2 className="text-base font-bold text-navy">Issues</h2>
        <Badge className={counts.blocking ? PILL.red : counts.review ? PILL.amber : PILL.green}>
          {toCheck ? `${toCheck} to check` : "✓ Nothing to check"}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-line px-[18px] pt-3 pb-3">
        {(["all", "blocking", "review", "info", "complete"] as const).map((f) => {
          const n = f === "all" ? issues.length : counts[f];
          if (f !== "all" && !n) return null;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-2.5 py-[3px] text-xs font-semibold transition-colors",
                filter === f ? PILL.blue : cn(PILL.grey, "hover:text-ink"),
              )}
            >
              {f === "all" ? "All" : f === "complete" ? "Complete" : SEVERITY[f].label} {n}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
        {!issues.length && <p className="py-8 text-center text-sm text-ink-3">No issues raised.</p>}
        {order.map(({ issue, index }) => {
          const target = targets[index];
          const onDiagram = target.kind !== "none";
          const isSelected = selected === index;
          const done = isResolved(index);
          const quotes = issue.evidence_refs.map((id) => sources.get(id)).filter((e): e is EvidenceView => !!e?.excerpt);
          return (
            <article
              key={index}
              ref={(el) => {
                if (el) cards.current.set(index, el);
                else cards.current.delete(index);
              }}
              role={onDiagram ? "button" : undefined}
              tabIndex={onDiagram ? 0 : undefined}
              aria-pressed={onDiagram ? isSelected : undefined}
              onClick={() => onDiagram && onSelect(isSelected ? null : index)}
              onKeyDown={(e) => {
                // Keys pressed on the card's own button are that button's.
                if (e.target !== e.currentTarget) return;
                if (onDiagram && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect(isSelected ? null : index);
                }
              }}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-left transition-colors outline-none",
                onDiagram && "cursor-pointer hover:border-brand-100 focus-visible:ring-3 focus-visible:ring-ring/50",
                isSelected
                  ? "border-brand bg-brand-50 shadow-[0_0_0_3px_var(--color-brand-100)]"
                  : done
                    ? "border-[#bfe3cf] bg-ok-50/50"
                    : issue.severity === "blocking"
                      ? "border-[#f3c6c8] bg-uob-red-50/60"
                      : issue.severity === "review"
                        ? "border-[#f0c27a] bg-warn-50/60"
                        : "border-line",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <b className={cn("text-[13.5px] leading-snug", done ? "text-ink-2" : "text-ink")}>
                  <span className="mr-1.5 font-mono text-[11px] font-normal text-ink-3">#{index + 1}</span>
                  {issueTitle(issue.code)}
                </b>
                {done ? (
                  <Badge className={PILL.green}>✓ Complete</Badge>
                ) : (
                  <Badge className={SEVERITY[issue.severity].pill}>{SEVERITY[issue.severity].label}</Badge>
                )}
              </div>
              <p className="text-[12.5px] text-ink-2">{readable(issue.message)}</p>
              {/* Completed issues keep their source quotes out of the way unless picked again. */}
              {(!done || isSelected) &&
                quotes.slice(0, 2).map((q) => (
                  <blockquote
                    key={q.id}
                    className="rounded-r-lg border-l-[3px] border-brand bg-brand-50 px-2.5 py-2 text-xs text-ink-2"
                  >
                    &ldquo;{q.excerpt!.length > MAX_QUOTE ? `${q.excerpt!.slice(0, MAX_QUOTE).trimEnd()}…` : q.excerpt}&rdquo;
                    <small className="mt-0.5 block text-ink-3">
                      {q.source}
                      {q.page != null && ` · p. ${q.page}`}
                    </small>
                  </blockquote>
                ))}
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-ink-3">
                {onDiagram ? (
                  <>
                    <CrosshairIcon className={cn("size-3", isSelected && "text-brand")} />
                    {target.kind === "evidence" && <span>Steps citing the same source:</span>}
                    {target.ids.slice(0, MAX_CHIPS).map((id) => (
                      <span key={id} className="rounded-md bg-white px-1.5 py-0.5 text-ink-2 ring-1 ring-line">
                        {names.get(id) ?? id}
                      </span>
                    ))}
                    {target.ids.length > MAX_CHIPS && <span>+{target.ids.length - MAX_CHIPS} more</span>}
                  </>
                ) : (
                  <span>{issue.element_ids.length ? "Not on the diagram (from an earlier step)" : "Applies to the whole diagram"}</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center justify-end gap-1">
                {/* New tab, so edits on this page are not lost. */}
                {guideFor(issue.code) && (
                  <a
                    href={`/issues#${guideFor(issue.code)!.code}`}
                    target="_blank"
                    rel="noopener"
                    onClick={(e) => e.stopPropagation()}
                    className="mr-auto flex items-center gap-1 text-xs text-ink-3 hover:text-brand"
                  >
                    <BookOpenIcon className="size-3" />
                    How to fix
                  </a>
                )}
                <Button
                  variant={done ? "ghost" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleResolved(index);
                  }}
                >
                  {done ? <RotateCcwIcon /> : <CheckIcon />}
                  {done ? "Reopen" : "Mark complete"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
