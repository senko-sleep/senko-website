import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Georgia', 'Times New Roman', 'serif'],
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
      },
      colors: {
        senko: {
          orange: 'var(--senko-orange)',
          'orange-dark': 'var(--senko-orange-dark)',
          cream: 'var(--senko-cream)',
          dark: 'var(--senko-dark)',
          gray: 'var(--senko-gray)',
        },
      },
      boxShadow: {
        'orange-glow': 'var(--orange-glow)',
        glass: '0 8px 32px rgba(15, 23, 42, 0.08)',
        'glass-dark': '0 8px 32px rgba(0, 0, 0, 0.35)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};

export default config;
