/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        'surface-3': token('surface-3'),
        border: token('border'),
        'border-strong': token('border-strong'),
        fg: token('fg'),
        'fg-muted': token('fg-muted'),
        'fg-subtle': token('fg-subtle'),
        primary: token('primary'),
        'primary-fg': token('primary-fg'),
        'primary-soft': token('primary-soft'),
        positive: token('positive'),
        'positive-soft': token('positive-soft'),
        negative: token('negative'),
        'negative-fg': token('negative-fg'),
        'negative-soft': token('negative-soft'),
        warning: token('warning'),
        'warning-soft': token('warning-soft'),
        info: token('info'),
        'info-soft': token('info-soft'),
        focus: token('focus'),
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)',
        raised: '0 2px 4px rgb(16 24 40 / 0.06), 0 8px 24px rgb(16 24 40 / 0.1)',
        sheet: '0 -8px 30px rgb(0 0 0 / 0.18)',
      },
      animation: { 'toast-in': 'vm-toast-in 0.18s ease-out' },
    },
  },
  plugins: [
    // `coarse:` applies only on touch screens, so dense desktop controls can stay compact.
    ({ addVariant }) => addVariant('coarse', '@media (pointer: coarse)'),
  ],
};
