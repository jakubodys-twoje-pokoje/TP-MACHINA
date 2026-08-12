import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // W trybie dev GUI gada z serwisem na 4000; produkcyjnie serwis serwuje
    // zbudowane pliki sam, więc adresy są względne i proxy nie jest potrzebne.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/health': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
