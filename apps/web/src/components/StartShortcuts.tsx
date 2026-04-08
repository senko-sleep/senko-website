'use client';

import {
  BookOpen,
  Github,
  Globe2,
  Newspaper,
  Sparkles,
  Cpu,
} from 'lucide-react';

const SHORTCUTS: { label: string; href: string; icon: typeof Globe2; accent: string }[] = [
  { label: 'Wikipedia', href: 'https://www.wikipedia.org', icon: BookOpen, accent: 'from-slate-500/20 to-slate-600/10' },
  { label: 'GitHub', href: 'https://github.com', icon: Github, accent: 'from-violet-500/20 to-fuchsia-500/10' },
  { label: 'MDN Web Docs', href: 'https://developer.mozilla.org', icon: Cpu, accent: 'from-blue-500/20 to-cyan-500/10' },
  { label: 'Hacker News', href: 'https://news.ycombinator.com', icon: Sparkles, accent: 'from-orange-500/20 to-amber-500/10' },
  { label: 'Reuters', href: 'https://www.reuters.com', icon: Newspaper, accent: 'from-emerald-500/20 to-teal-500/10' },
  { label: 'Explore web', href: 'https://en.wikipedia.org/wiki/Web_search_engine', icon: Globe2, accent: 'from-[var(--senko-orange)]/25 to-orange-600/10' },
];

export default function StartShortcuts() {
  return (
    <section className="mt-12 w-full">
      <div className="mb-4 flex items-center justify-between px-1">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Start on the web
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">Quick open</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SHORTCUTS.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`group glass flex items-center gap-3 p-4 transition hover:border-white/70 hover:bg-white/50 dark:hover:border-white/15 dark:hover:bg-slate-800/40 ${s.accent} bg-gradient-to-br`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/60 text-slate-700 shadow-sm ring-1 ring-white/50 backdrop-blur-sm dark:bg-white/10 dark:text-slate-200 dark:ring-white/10">
              <s.icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-left text-sm font-semibold text-slate-800 dark:text-slate-100">
              {s.label}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
