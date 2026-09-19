import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8888', changeOrigin: true },
      '/.netlify': { target: 'http://localhost:8888', changeOrigin: true },
    },
  },
  build: {
    // Split long-lived vendor libraries into their own cached chunks — keeps
    // every chunk under the 500 kB warning threshold and lets browsers cache
    // vendor code separately from app code.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          csv: ['papaparse'],
        },
      },
    },
  },
})
