"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "New diagram", match: (p: string) => p === "/" },
  // A job page is reached from the run history, so it highlights Previous runs.
  { href: "/runs", label: "Previous runs", match: (p: string) => p.startsWith("/runs") || p.startsWith("/jobs") },
];

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav className="ml-7 hidden gap-1 md:flex">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "rounded-lg px-3 py-2 font-medium text-ink-2 transition-colors hover:text-brand",
            pathname != null && l.match(pathname) && "bg-brand-50 text-brand",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

function ActiveNav() {
  return <NavLinks pathname={usePathname()} />;
}

/** Main navigation; the fallback (nothing highlighted) renders while the pathname is unknown during prerender. */
export function MainNav() {
  return (
    <Suspense fallback={<NavLinks pathname={null} />}>
      <ActiveNav />
    </Suspense>
  );
}
