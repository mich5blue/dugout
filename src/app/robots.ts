import type { MetadataRoute } from 'next';

/** Shared lineups are private by obscurity, so keep crawlers out of `/s`. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/s/' }],
  };
}
