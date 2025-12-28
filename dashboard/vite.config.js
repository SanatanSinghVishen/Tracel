import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Open the app automatically when running `npm run dev`.
    // Using '/' ensures the Landing page is shown.
    open: '/',
  },
})
