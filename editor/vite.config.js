import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));
export default defineConfig({
  base: './',
  server: {
    port: 5174,
    fs: { allow: [path('../')] },
    proxy: {
      '/api': 'http://127.0.0.1:5173',
      '/songs': 'http://127.0.0.1:5173',
    },
  },
  build: {
    rolldownOptions: { input: { editor: path('./index.html'), preview: path('./preview.html') } },
  },
});
