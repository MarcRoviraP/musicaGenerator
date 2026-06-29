import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/tempmail': {
        target: 'https://api.tempmail.lol',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tempmail/, ''),
      }
    }
  }
})
