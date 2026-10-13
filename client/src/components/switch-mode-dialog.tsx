"use client";

import { useState } from "react";
import { ArrowLeftRightIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import type { JobView, Mode, Provider } from "@/lib/types";

const PROVIDERS = [
  { value: "gemini", label: "Gemini" },
  { value: "qwen", label: "Qwen" },
];

/**
 * POST /v1/jobs/:id/mode. Allowed when the job failed (retry on either route)
 * or is waiting for a chat result (switch to API). Finished agents are kept.
 */
export function SwitchModeDialog({
  job,
  target,
  label,
  onSwitched,
  variant = "outline",
  icon = <ArrowLeftRightIcon />,
}: {
  job: JobView;
  target: Mode;
  label: string;
  onSwitched: () => void;
  variant?: "outline" | "default";
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>(job.provider);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await api.switchMode(job.id, target, target === "api" ? provider : undefined);
      toast.success(target === "api" ? `Continuing with ${provider} API` : "Switched to Copilot Chat");
      setOpen(false);
      onSwitched();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not switch mode");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={variant} size="sm" />}>
        {icon}
        {label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target === "api" ? "Run the remaining agents via API" : "Switch to Copilot Chat"}</DialogTitle>
          <DialogDescription>
            Completed agent outputs are kept. Only the unfinished step and the steps after it run on the new route.
          </DialogDescription>
        </DialogHeader>
        {target === "api" && (
          <div className="flex flex-col gap-2">
            <Label>Provider</Label>
            <Select items={PROVIDERS} value={provider} onValueChange={(v) => v && setProvider(v as Provider)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button onClick={confirm} disabled={busy}>
            {busy ? "Switching…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
