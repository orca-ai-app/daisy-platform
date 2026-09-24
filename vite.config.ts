import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { HELP_ARTICLES, sectionAnchor } from './src/features/franchisee/help/articles';

/**
 * Publish the Help articles as /help-index.json so the triage form on
 * simmance.ai can show the matching guide section while people type. Built
 * from the same HELP_ARTICLES the portal renders, so it can never drift.
 * CORS for it is set in netlify.toml.
 */
function helpIndexJson(): string {
  return JSON.stringify(
    HELP_ARTICLES.map((a) => ({
      slug: a.slug,
      title: a.title,
      summary: a.summary,
      keywords: a.keywords,
      url: `/franchisee/help/${a.slug}`,
      sections: a.sections.map((s) => ({
        heading: s.heading ?? '',
        anchor: s.heading ? sectionAnchor(s.heading) : '',
        body: s.body ?? [],
        steps: s.steps ?? [],
      })),
    })),
  );
}

function helpIndex(): Plugin {
  return {
    name: 'daisy-help-index',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'help-index.json', source: helpIndexJson() });
    },
    configureServer(server) {
      server.middlewares.use('/help-index.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(helpIndexJson());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), helpIndex()],
  define: {
    // Build stamp shipped with browser error logs. Netlify sets COMMIT_REF;
    // local dev builds report 'dev'.
    __APP_VERSION__: JSON.stringify(process.env.COMMIT_REF ?? 'dev'),
  },
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
