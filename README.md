# daisy-platform

Daisy First Aid platform — HQ portal, franchisee portal, booking widget, and Supabase migrations live here. M1 build follows `../docs/M1-build-plan.md`.

This is the first of three Daisy repos:

- `daisy-platform` — admin portal (HQ + franchisee). M1+M2.
- `daisy-booking` — public booking surface. Created at M3.
- `daisy-medical` — medical declaration form. Created at M3.

All three consume one shared Supabase project; this repo owns the migrations and Edge Functions.

## Stack

- Vite 6 + React 19 + TypeScript 5
- Tailwind 4 (CSS-first `@theme` config) + shadcn/ui primitives on Radix
- React Router v7, TanStack Query 5, TanStack Table 8, Zustand 5
- React Hook Form + Zod, Recharts, Sonner, Lucide icons, jsPDF, date-fns
- Supabase JS v2 (anon key for reads, Edge Functions for writes)
- Vitest + Testing Library + jsdom

See `DECISIONS.md` for why.

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env example and fill in values from docs/credentials.md
cp .env.example .env
# then edit .env

# 3. Start the dev server
npm run dev
```

Dev server runs at `http://localhost:5173/`. Visit `/login` to see the sign-in form.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check then produce a production bundle in `dist/` |
| `npm run preview` | Serve the production bundle locally |
| `npm run test` | Run Vitest once (CI-friendly) |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run lint` | ESLint over `src/` |
| `npm run typecheck` | `tsc --noEmit` over both project references |
| `npm run format` | Prettier write |

## Environment variables

Browser-side keys only (`VITE_*` prefix, exposed to the client bundle):

| Var | Source | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `docs/credentials.md` → `SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `docs/credentials.md` → `ANON_KEY` | Anon JWT for RLS-gated reads + auth |
| `VITE_GOOGLE_MAPS_API_KEY` | `docs/credentials.md` → `VITE_GOOGLE_MAPS_API_KEY` | Browser-restricted Maps JS API key |

Never put server-only secrets here:

- `SERVICE_ROLE_KEY` — lives in Supabase Edge Function secrets only.
- `GOOGLE_MAPS_API_KEY` (server, for Geocoding) — lives in Supabase Edge Function secrets.
- Stripe / GoCardless / Postmark credentials (M2+) — Supabase Edge Function secrets.

## Project layout

```
src/
├── routes/              # React Router config
├── features/
│   ├── auth/            # Login, callback, role context, route guard
│   ├── hq/              # M1 work
│   └── franchisee/      # M2 work
├── lib/
│   ├── supabase.ts      # typed client
│   ├── format.ts        # money, dates
│   └── queries/         # TanStack Query hooks
├── stores/              # Zustand
├── components/
│   ├── ui/              # shadcn primitives (Button, Card, …)
│   └── daisy/           # Daisy custom (StatCard, StatusPill, TerritoryMap, …)
├── types/               # Zod schemas + TS types
└── utils/
```

## Wave 1A scope

Wave 1A delivered the scaffold, design tokens, auth flow, login page, and placeholder dashboards. Wave 1B brings the database migrations; Wave 1C brings repo hygiene (husky, prettier, netlify.toml, branch protection).

Full plan: `../docs/M1-build-plan.md`.
