import { Suspense } from "react";
import { JobWorkspace } from "@/components/job-workspace";
import { Skeleton } from "@/components/job-skeleton";

// Job IDs are only known at request time; with cacheComponents, useParams must sit inside Suspense.
export default function JobPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <JobWorkspace />
    </Suspense>
  );
}
