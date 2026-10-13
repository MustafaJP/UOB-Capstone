import { Suspense } from "react";
import { DiagramPage } from "@/components/diagram-page";

// Job IDs and ?format= are only known at request time; with cacheComponents, the hooks that read
// them must sit inside Suspense.
export default function JobDiagramPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-50 bg-background" />}>
      <DiagramPage />
    </Suspense>
  );
}
