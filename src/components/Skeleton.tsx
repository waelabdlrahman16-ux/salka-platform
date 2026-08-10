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
