import type { Metadata, Viewport } from 'next';
import './globals.css';
import { DugoutProvider } from './providers';
import { AppShell } from '@/components/AppShell';
import { NativeBridge } from '@/components/NativeBridge';

export const metadata: Metadata = {
  title: 'InningGrid — Smart lineups. More play time.',
  description:
    'Build fair, optimized batting orders and inning-by-inning defensive lineups in seconds.',
  /*
    Installed to an iPhone home screen, Safari ignores most of the manifest and
    reads these instead. `black-translucent` lets the app draw under the status
    bar the way a native app does — which only works because every top bar
    pads itself by the safe-area inset (see AppShell and the Game Day header).
  */
  appleWebApp: {
    capable: true,
    title: 'InningGrid',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
  formatDetection: {
    /* Jersey numbers and inning counts are not phone numbers, and iOS
       underlines runs of digits as tappable links unless told otherwise. */
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
    `cover` is what makes env(safe-area-inset-*) mean anything.

    The app has padded itself by the safe-area insets since the Game Day work,
    but without `viewport-fit=cover` those insets are always zero — the
    browser letterboxes the page instead. Installed and full-screen, that
    puts the header under the notch.
  */
  viewportFit: 'cover',
  // Matches --bg in each mode so the browser chrome does not flash white.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#07090b' },
    { media: '(prefers-color-scheme: light)', color: '#eef1f3' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Fonts load from a stylesheet link rather than `next/font` because the
          build machine sits behind a TLS-inspecting proxy and cannot reach
          Google Fonts at build time, which is when `next/font` downloads them.
          A link moves the fetch to the browser, so the build works anywhere.

          It is not an `@import` in globals.css: Tailwind v4 inlines its own
          import ahead of it, which pushes a url() import below real rules and
          makes the browser drop it silently.

          Swap to `next/font/google` if the build environment ever gets direct
          network access — it self-hosts the files and drops this request.

          Inter carries the interface; Barlow Condensed carries scoreboard type
          (matchups, inning numbers, hero figures). The condensing is
          functional as well as stylistic — it buys roughly a third more
          characters per line in the headers that used to wrap.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&display=swap"
        />
      </head>
      <body>
        <NativeBridge />
        <DugoutProvider>
          <AppShell>{children}</AppShell>
        </DugoutProvider>
      </body>
    </html>
  );
}
