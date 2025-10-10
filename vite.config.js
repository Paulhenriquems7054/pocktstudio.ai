import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: './index.html',
        app: './app.html'
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          motion: ['framer-motion']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'framer-motion']
  }
});

