import type { Metadata } from 'next';
import { Sora, DM_Sans } from 'next/font/google';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

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
      <body
        className={`${sora.variable} ${dmSans.variable} font-sans antialiased selection:bg-[var(--senko-orange)]/25`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="relative z-10 min-h-screen">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
