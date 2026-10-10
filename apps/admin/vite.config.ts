import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.ADMIN_API_PROXY ?? 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
      '/health': {
        target: process.env.ADMIN_API_PROXY ?? 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
