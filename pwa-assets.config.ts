import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/**
 * Generates the PWA icon set from public/logo.svg into public/:
 *   pwa-64x64.png, pwa-192x192.png, pwa-512x512.png, maskable-icon-512x512.png,
 *   apple-touch-icon-180x180.png and favicon.ico.
 * Run `npm run icons` after changing the logo, and commit the PNGs (the build does not regenerate them).
 */
const TEAL = '#0f766e';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // Padded icons get the brand colour behind them so no white edge shows on Android / iOS masks.
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: TEAL, fit: 'contain' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: TEAL, fit: 'contain' } },
  },
  images: ['public/logo.svg'],
});
