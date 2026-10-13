import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { WorkflowIcon } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Process Flow Diagramming",
  description: "Turn SOPs and process documents into BPMN swimlane diagrams.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>
          <header className="border-b">
            <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <WorkflowIcon className="size-5" />
                Process Flow Diagramming
              </Link>
              <nav className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
                <Link href="/" className="hover:text-foreground">
                  New job
                </Link>
                <Link href="/runs" className="hover:text-foreground">
                  Previous runs
                </Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
