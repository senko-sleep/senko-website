export default function Loading() {
  return (
    <div className="min-h-screen bg-[var(--senko-cream)] p-8 dark:bg-[var(--bg)]">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="h-10 animate-pulse rounded bg-black/5 dark:bg-white/5" />
        <div className="h-40 animate-pulse rounded bg-black/5 dark:bg-white/5" />
      </div>
    </div>
  );
}
