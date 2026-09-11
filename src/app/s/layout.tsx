import type { Metadata } from 'next';

/**
 * A share link carries a real team's roster, so it must never end up in a
 * search index. `noindex` covers crawlers that find the link in a group chat
 * preview or a forwarded email; the link itself remains the only access
 * control, which is why the share dialog says so plainly.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function SharedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
