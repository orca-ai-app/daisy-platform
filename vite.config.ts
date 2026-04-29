import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Wave 5A: split the main bundle into stable vendor chunks so the
        // initial route stays under the 500 KB warning threshold. Lazy
        // routes (Reports, Billing, Territories, Bookings, Course
        // instances) live in their own chunks via React.lazy in App.tsx.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@supabase')) return 'vendor-supabase';
          if (id.includes('@tanstack')) return 'vendor-tanstack';
          if (id.includes('react-router') || id.includes('@remix-run')) {
            return 'vendor-router';
          }
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('scheduler')
          ) {
            return 'vendor-react';
          }
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (
            id.includes('react-hook-form') ||
            id.includes('@hookform') ||
            id.includes('node_modules/zod')
          ) {
            return 'vendor-forms';
          }
          if (id.includes('date-fns')) return 'vendor-date';
        },
      },
    },
  },
});
