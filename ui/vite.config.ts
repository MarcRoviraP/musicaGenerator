import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/mailtm': {
        target: 'https://api.mail.tm',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mailtm/, ''),
      },
      '/api/magiclight-user': {
        target: 'https://api.magiclight.ai/api/user',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/magiclight-user/, ''),
      },
      '/api/magiclight-server': {
        target: 'https://server.magiclight.ai/task-schedule/music',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/magiclight-server/, ''),
      },
      '/api/tempmail': {
        target: 'https://api.tempmail.lol',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tempmail/, ''),
      }
    }
  }
})
