/** Instant route shell while navigating to /search (avoids blank screen during chunk load). */
export default function SearchLoading() {
  return (
    <div className="min-h-screen bg-[#eceef1] text-slate-900 dark:bg-[#131314] dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl dark:border-white/[0.06] dark:bg-slate-950/75">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3.5">
          <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-200/80 dark:bg-white/10" />
          <div className="h-10 max-w-xl flex-1 animate-pulse rounded-full bg-slate-200/70 dark:bg-white/10" />
        </div>
      </header>
      <div className="flex flex-col items-center justify-center py-24">
        <div className="h-16 w-16 animate-pulse rounded-2xl bg-slate-200/80 dark:bg-white/10" />
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">Loading search…</p>
        <div className="mt-8 h-1.5 w-40 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10">
          <div className="h-full w-1/3 animate-[senko-bar_1s_ease-in-out_infinite] rounded-full bg-[var(--senko-orange)]/70" />
        </div>
      </div>
      <style>{`
        @keyframes senko-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}
