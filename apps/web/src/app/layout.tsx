import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { PrefsProvider } from '@/lib/prefsContext';
import RouteLoadingIndicator from '@/components/RouteLoadingIndicator';
import './globals.css';

export const metadata: Metadata = {
  title: 'Senko Search',
  description: 'Quick as a fox, sharp as a search.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased selection:bg-[var(--senko-orange)]/25">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <PrefsProvider>
            <Suspense fallback={null}>
              <RouteLoadingIndicator />
            </Suspense>
            <div className="relative z-10 min-h-screen">{children}</div>
          </PrefsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
