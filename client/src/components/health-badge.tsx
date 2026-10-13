"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { Health } from "@/lib/types";

/** Server reachability indicator; rechecks every 10 s. */
export function HealthBadge({ onHealth }: { onHealth?: (h: Health | null) => void }) {
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

  if (health === undefined) return <Badge variant="outline">Checking server…</Badge>;
  if (!health)
    return (
      <Badge className="bg-destructive/10 text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" />
        Server offline
      </Badge>
    );
  return (
    <Badge className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      Server online · default {health.provider}
    </Badge>
  );
}
