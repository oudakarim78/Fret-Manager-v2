import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function rewriteHtmlForVendor(html: string): string {
  return html
    .replace(/href="\/manifest\.webmanifest"/g, 'href="/vendor.webmanifest"')
    .replace(
      /<title>[^<]*<\/title>/,
      '<title>FRET MANAGER — Gestion Compte Client Abonnés</title>',
    )
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      '<meta name="description" content="Portail éditeur indépendant : gestion des comptes clients abonnés, essais gratuits 14 jours, packs B2B et rentabilité SaaS." />',
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
      '<meta property="og:title" content="FRET MANAGER — Gestion Compte Client Abonnés" />',
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
      '<meta property="og:description" content="Portail éditeur indépendant : gestion des comptes clients abonnés, essais gratuits 14 jours, packs B2B et rentabilité SaaS." />',
    )
    .replace(
      /<meta name="theme-color" content="[^"]*"\s*\/?>/,
      '<meta name="theme-color" content="#0f2438" />',
    )
    .replace(
      /<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/?>/,
      '<meta name="apple-mobile-web-app-title" content="FretÉditeur" />',
    )
    .replace(/href="\/apple-touch-icon\.png"/g, 'href="/vendor-apple-touch-icon.png"')
    .replace(/href="\/icon\.svg"/g, 'href="/vendor-icon.svg"');
}

function rewriteHtmlForOffers(html: string): string {
  return html
    .replace(
      /<title>[^<]*<\/title>/,
      '<title>FRET MANAGER — Offres & Abonnements Gestion Transport & Flotte</title>',
    )
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      '<meta name="description" content="Déployez votre plateforme de gestion transport, flotte, GPS, paie et facturation en 72h. Essai gratuit 14 jours et packs clé en main pour sociétés et transporteurs." />',
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
      '<meta property="og:title" content="FRET MANAGER — Offres & Abonnements Transport B2B" />',
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
      '<meta property="og:description" content="Déployez votre plateforme de gestion transport, flotte, GPS, paie et facturation en 72h. Essai gratuit 14 jours ou demande de devis personnalisé." />',
    );
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        scope: '/',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'vendor.webmanifest',
          'vendor-icon.svg',
          'vendor-apple-touch-icon.png',
          'vendor-192x192.png',
          'vendor-512x512.png',
          'vendor-maskable-512x512.png',
        ],
        manifest: {
          id: '/erp',
          lang: 'fr',
          name: 'FRET MANAGER — Gestion des Transports, Flotte & Facturation',
          short_name: 'FretManager',
          description:
            'Application opérationnelle de gestion des transports, missions, flotte, paie, facturation et suivi GPS.',
          theme_color: '#17324d',
          background_color: '#17324d',
          display: 'standalone',
          orientation: 'any',
          start_url: '/erp',
          scope: '/erp',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/uploads\//,
            /^\/(?:vendor|offres|pro|abonnement|commercial)(?:\/|$|\?)/,
            /[?&]portal=(?:vendor|offres|pro)/,
          ],
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.mode === 'navigate' &&
                (url.pathname === '/vendor' ||
                  url.pathname.startsWith('/vendor/') ||
                  url.pathname === '/offres' ||
                  url.pathname.startsWith('/offres/') ||
                  url.pathname === '/pro' ||
                  url.pathname.startsWith('/pro/') ||
                  url.pathname === '/abonnement' ||
                  url.pathname.startsWith('/abonnement/') ||
                  url.pathname === '/commercial' ||
                  url.pathname.startsWith('/commercial/')),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'vendor-portal-html-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
                cacheableResponse: {
                  statuses: [200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      {
        name: 'vendor-portal-html',
        enforce: 'post' as const,
        transformIndexHtml: {
          order: 'post' as const,
          handler(html: string, ctx: { originalUrl?: string }) {
            const url = ctx.originalUrl || '';
            if (
              url === '/vendor' ||
              url.startsWith('/vendor/') ||
              url.startsWith('/vendor?') ||
              url.includes('portal=vendor')
            ) {
              return rewriteHtmlForVendor(html);
            }
            if (
              url === '/offres' ||
              url.startsWith('/offres/') ||
              url.startsWith('/offres?') ||
              url === '/pro' ||
              url.startsWith('/pro/') ||
              url.startsWith('/pro?') ||
              url === '/abonnement' ||
              url.startsWith('/abonnement/') ||
              url === '/commercial' ||
              url.startsWith('/commercial/') ||
              url.includes('portal=offres') ||
              url.includes('portal=pro')
            ) {
              return rewriteHtmlForOffers(html);
            }
            return html;
          },
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
