import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        subtle: v('subtle'),
        line: v('line'),
        ink: v('ink'),
        muted: v('muted'),
        accent: v('accent'),
        'accent-ink': v('accent-ink'),
        ok: v('ok'),
        warn: v('warn'),
        danger: v('danger'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 1px rgb(0 0 0 / 0.02)',
        pop: '0 12px 32px rgb(0 0 0 / 0.14), 0 2px 6px rgb(0 0 0 / 0.08)',
      },
      borderRadius: { xl: '0.875rem' },
    },
  },
  plugins: [],
};

export default config;
