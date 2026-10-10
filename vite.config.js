import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tech: resolve(__dirname, 'tech.html'),
        customer: resolve(__dirname, 'customer.html'),
        cockpit: resolve(__dirname, 'cockpit.html'),
        qc: resolve(__dirname, 'qc.html'),
      },
    },
  },
});
