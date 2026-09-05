export function SkeletonLine({ width = "100%" }) {
  return <div className="skeleton skeleton-line" style={{ width }} />;
}

export function SkeletonRow() {
  return <div className="skeleton skeleton-row" />;
}

export function SkeletonTable({ rows = 4 }) {
  return (
    <div className="stack gap-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card" aria-hidden="true">
      <SkeletonLine width="40%" />
      <SkeletonLine width="90%" />
      <SkeletonLine width="70%" />
    </div>
  );
}
