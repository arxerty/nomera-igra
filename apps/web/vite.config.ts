import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Общий .env в корне монорепозитория (берутся только переменные VITE_*).
  envDir: '../..',
  server: {
    port: 5173,
    host: true,
    // HTTPS-туннели для открытия dev-сервера из Telegram.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
    // В разработке API доступен через тот же origin — без CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', '@tanstack/react-query'],
          motion: ['framer-motion', 'canvas-confetti'],
        },
      },
    },
  },
});
