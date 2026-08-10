// Shared shimmer building block for first-load skeleton screens. Kept to a
// single primitive (a pulsing block) rather than a library of preset shapes --
// each page composes its own layout out of these so the skeleton can track
// that page's actual structure instead of a generic spinner.
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-line/60 ${className}`} />
}

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="bg-night border border-line rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <SkeletonBlock className="h-4 w-1/3" />
        <SkeletonBlock className="h-4 w-16" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} className="h-3 w-2/3" />
      ))}
    </div>
  )
}

// Matches the shape of an admin order card (`.card p-4` with a title row, a
// nested customer-details box, and a full-width action button) rather than
// the generic SkeletonCard -- close enough on height that the swap from
// skeleton to real content on the default "unassigned" tab doesn't visibly
// jump the page.
export function SkeletonOrderCard() {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <SkeletonBlock className="h-4 w-2/5" />
        <SkeletonBlock className="h-4 w-16" />
      </div>
      <div className="mt-2.5 bg-night border border-line rounded-xl p-3 space-y-2">
        <SkeletonBlock className="h-3 w-3/4" />
        <SkeletonBlock className="h-3 w-1/2" />
      </div>
      <SkeletonBlock className="h-11 w-full mt-3" />
    </div>
  )
}
