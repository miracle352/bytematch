import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately (npm start in the repo root, port 8787).
const api = process.env.API_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': api,
      '/v2/api': api,
      '/health': api,
      '/badge': api,
      '/mcp': api,
      '/llms.txt': api,
      '^/api($|\\?)': api,
    },
  },
  build: { target: 'es2022', sourcemap: false },
});
