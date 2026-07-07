/// <reference types="vite/client" />

/**
 * Build stamp injected by the `define` block in vite.config.ts
 * (COMMIT_REF on Netlify, 'dev' locally). Not defined under vitest —
 * consumers must guard with `typeof __APP_VERSION__ !== 'undefined'`.
 */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
