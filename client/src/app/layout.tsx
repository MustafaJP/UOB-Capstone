import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Archivo, DM_Sans, JetBrains_Mono } from "next/font/google";
import { HealthBadge } from "@/components/health-badge";
import { MainNav } from "@/components/main-nav";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Process Flow Diagramming",
  description: "Turn SOPs and process documents into BPMN swimlane diagrams.",
};

/** The product mark from the mockup: two boxes joined by an elbow connector. */
function FlowMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]">
      <rect x="3" y="4" width="7" height="6" rx="1.5" />
      <rect x="14" y="14" width="7" height="6" rx="1.5" />
      <path d="M6.5 10v4a3 3 0 0 0 3 3H14" />
    </svg>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${archivo.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col text-sm leading-[1.45]">
        <TooltipProvider>
          <header className="relative border-b border-line bg-white">
            <div className="mx-auto flex max-w-[1180px] items-center gap-5 px-4 py-3 sm:px-6 sm:py-3.5">
              <Link href="/" className="flex items-center gap-2.5 leading-tight">
                <span className="grid size-[34px] place-items-center rounded-[9px] bg-navy text-white">
                  <FlowMark />
                </span>
                <b className="font-heading text-base font-bold text-navy">Process Flow Diagramming</b>
              </Link>
              <MainNav />
              <div className="ml-auto flex items-center gap-3">
                <HealthBadge className="hidden sm:inline-flex" />
                <span className="ml-1 hidden h-[34px] items-center border-l border-line pl-4 sm:flex">
                  <Image src="/uob-logo.png" alt="UOB" width={98} height={28} className="h-7 w-auto" priority />
                </span>
              </div>
            </div>
            {/* UOB accent: a short red run into the blue rule. */}
            <div
              aria-hidden
              className="absolute inset-x-0 -bottom-px h-[3px] bg-[linear-gradient(90deg,var(--color-uob-red)_0_120px,var(--color-brand)_120px)]"
            />
          </header>
          <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 pt-6 pb-9 sm:px-6 sm:pt-8 sm:pb-12">{children}</main>
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
