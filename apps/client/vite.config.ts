import { defineConfig, type Plugin } from 'vite';

/**
 * Absolute site URL for canonical and Open Graph tags (crawlers ignore relative og:image).
 * SITE_URL wins; on Vercel the production domain is used; a local build falls back to
 * relative URLs and says so.
 */
function siteUrl(): string {
  const explicit = process.env.SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return '';
}

function siteMeta(): Plugin {
  let url = '';
  return {
    name: 'cop-site-meta',
    configResolved(config) {
      url = siteUrl();
      if (config.command === 'build') {
        // On Vercel the client is useless without a game server to talk to: fail the deploy, loudly.
        if (process.env.VERCEL && !process.env.VITE_SERVER_URL) {
          throw new Error('VITE_SERVER_URL is not set: point it at the game server (e.g. https://cop-server.fly.dev). See README → Deploy.');
        }
        if (!url) config.logger.warn('[site-meta] No SITE_URL or VERCEL_PROJECT_PRODUCTION_URL: canonical and og:image will be relative.');
      }
    },
    transformIndexHtml(html) {
      return html.replaceAll('__SITE_URL__', url);
    },
  };
}

export default defineConfig({
  plugins: [siteMeta()],
  server: { port: 5173, host: true },
  build: { target: 'es2022' },
});
