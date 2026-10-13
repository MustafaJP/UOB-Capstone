"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Health } from "@/lib/types";

const PROVIDER_NAME: Record<Health["provider"], string> = { gemini: "Gemini", qwen: "Qwen" };

/** Server reachability indicator; rechecks every 10 s. */
export function HealthBadge({ onHealth, className }: { onHealth?: (h: Health | null) => void; className?: string }) {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .health()
        .then((h) => !cancelled && (setHealth(h), onHealth?.(h)))
        .catch(() => !cancelled && (setHealth(null), onHealth?.(null)));
    void check();
    const t = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [onHealth]);

  const tone =
    health === undefined
      ? { pill: "bg-line-2 text-ink-3", dot: "bg-ink-3" }
      : health
        ? { pill: "bg-ok-50 text-ok", dot: "bg-ok shadow-[0_0_0_3px_rgba(30,142,90,0.18)]" }
        : { pill: "bg-uob-red-50 text-uob-red", dot: "bg-uob-red shadow-[0_0_0_3px_rgba(215,38,46,0.18)]" };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        tone.pill,
        className,
      )}
    >
      <i className={cn("size-[7px] rounded-full", tone.dot)} />
      {health === undefined
        ? "Checking server…"
        : health
          ? `Server online · ${PROVIDER_NAME[health.provider] ?? health.provider}`
          : "Server offline"}
    </span>
  );
}
