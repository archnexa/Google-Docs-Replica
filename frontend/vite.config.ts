import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In dev, /api is proxied to Django so the SPA can use relative URLs.
// In production VITE_API_URL points at the Render API service.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
