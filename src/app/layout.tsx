import type { Metadata, Viewport } from 'next';
import './globals.css';
import { DugoutProvider } from './providers';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Dugout — Smart lineups for youth baseball & softball',
  description:
    'Build fair, optimized batting orders and inning-by-inning defensive lineups in seconds.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#14503f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DugoutProvider>
          <AppShell>{children}</AppShell>
        </DugoutProvider>
      </body>
    </html>
  );
}
