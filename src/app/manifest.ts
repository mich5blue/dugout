import type { MetadataRoute } from 'next';

/**
 * The web app manifest — what makes InningGrid installable.
 *
 * Installed from the browser this opens standalone, with no address bar and
 * its own icon, which is most of what a coach means by "an app". The native
 * shells in ios/ and android/ use the same icons and colours so the two do not
 * look like different products on the same phone.
 *
 * `orientation: any`, not portrait: a tablet held sideways in the dugout is
 * the best device for Game Day, and locking it upright would throw that away.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'InningGrid',
    short_name: 'InningGrid',
    description: 'Fair youth baseball and softball lineups, kept fair across the whole season.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    /* --bg in dark mode, so the splash between tap and first paint matches
       the app rather than flashing white. */
    background_color: '#07090b',
    theme_color: '#07090b',
    categories: ['sports', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
