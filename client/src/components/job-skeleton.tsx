export function Skeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6">
      <div className="h-10 w-80 rounded-lg bg-muted" />
      <div className="h-28 rounded-xl bg-muted" />
      <div className="h-96 rounded-xl bg-muted" />
    </div>
  );
}
