import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  server: { port: 5173, strictPort: true, watch: { usePolling: true, interval: 250, ignored: ['**/data/**', '**/server/**'] }, proxy: { '/api': 'http://127.0.0.1:3001' } },
})
