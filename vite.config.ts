/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves the app from https://<user>.github.io/VyayaMitra/
const base = process.env.VITE_BASE ?? '/VyayaMitra/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'favicon.svg', 'logo.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'VyayaMitra',
        short_name: 'VyayaMitra',
        description: 'Private, on-device spending and savings companion for Indian bank statements.',
        lang: 'en-IN',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f8fa',
        theme_color: '#0f766e',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // Keep the install-time precache small: the OCR runtime (~14 MB) and the spreadsheet reader are
        // fetched on first use instead, then served from a runtime cache so they also work offline.
        // The pdf.js worker (assets/pdf.worker.*.mjs) stays precached.
        globIgnores: ['ocr/**', '**/assets/xlsx-*.js', '**/assets/tesseract*.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Self-hosted OCR worker, wasm cores and English model.
            urlPattern: /\/ocr\/[^/]+$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vm-ocr-v1',
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Lazily loaded chunks that are not precached (spreadsheet reader, OCR client).
            urlPattern: /\/assets\/(?:xlsx|tesseract)[^/]*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vm-lazy-chunks-v1',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  worker: { format: 'es' },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['src/features/**', 'jsdom'],
      ['src/ui/**', 'jsdom'],
      ['src/app/**', 'jsdom'],
    ],
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
});
