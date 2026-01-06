/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
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
            blue: "#34d399",
            purple: "#059669",
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