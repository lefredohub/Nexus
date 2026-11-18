import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiPort = Number(process.env.NEXUS_PORT ?? 4317);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.NEXUS_WEB_PORT ?? 5317),
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
});
