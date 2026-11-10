import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: '/lotus-bf/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1', port: 3000,
    proxy: Object.fromEntries(['/terms', '/query', '/health', '/dissociate'].map(path =>
      [path, { target: 'http://127.0.0.1:5000', changeOrigin: true }]
    )),
  },
})
