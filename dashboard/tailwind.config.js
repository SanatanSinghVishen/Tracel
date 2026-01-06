/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    'theme-accent-emerald',
    'theme-accent-blue',
    'theme-accent-purple',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
      colors: {
        tracel: {
          bg: {
            900: "#18181b",
            950: "#09090b",
          },
          accent: {
            // Dynamic accent colors (set via CSS variables on app pages).
            // The Landing page intentionally does not apply these theme classes.
            blue: "rgb(var(--tracel-accent-1-rgb, 34 197 94) / <alpha-value>)",
            purple: "rgb(var(--tracel-accent-2-rgb, 5 150 105) / <alpha-value>)",
          },
          surface: {
            glass: "rgba(255,255,255,0.05)",
            border: "rgba(255,255,255,0.10)",
          },
        },
      }
    },
  },
  plugins: [],
}