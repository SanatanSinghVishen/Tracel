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
            900: "#0b1220",
            950: "#050814",
          },
          accent: {
            blue: "#3b82f6",
            purple: "#8b5cf6",
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