import { cn } from "@/lib/utils";

const TONE = {
  red: { border: "border-[#f3c6c8]", bar: "bg-uob-red", icon: "text-uob-red" },
  green: { border: "border-[#bfe3cf]", bar: "bg-ok", icon: "text-ok" },
  amber: { border: "border-[#f0c27a]", bar: "bg-warn", icon: "text-warn" },
  blue: { border: "border-brand-100", bar: "bg-brand", icon: "text-brand" },
} as const;

/**
 * The mockup's status card: a coloured bar on the left, an icon title, a message and optional actions.
 * side: actions placed beside the message (the success layout) instead of under it.
 */
export function Callout({
  tone,
  icon,
  title,
  children,
  actions,
  side = false,
  className,
}: {
  tone: keyof typeof TONE;
  icon: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  side?: boolean;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div role="alert" className={cn("flex overflow-hidden rounded-[14px] border bg-white shadow-card", t.border, className)}>
      <div className={cn("w-[5px] shrink-0", t.bar)} />
      <div className={cn("min-w-0 flex-1 py-4 pr-[18px] pl-4", side && "flex flex-wrap items-center gap-5")}>
        <div className={cn(side && "min-w-[260px] flex-1")}>
          <h4 className="flex items-center gap-2 text-base font-bold text-ink">
            <span className={cn("[&_svg]:size-[18px]", t.icon)}>{icon}</span>
            {title}
          </h4>
          {children && <div className="mt-1 text-ink-2">{children}</div>}
        </div>
        {actions && <div className={cn("flex flex-wrap gap-2", !side && "mt-3")}>{actions}</div>}
      </div>
    </div>
  );
}
