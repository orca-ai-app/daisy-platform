# Architecture Decisions

These are the locked decisions for the Daisy platform M1 build. They live here so they don't get re-litigated in every wave. Source: `docs/M1-build-plan.md` §3.

## Locked at M1 kick-off

| Decision | Choice | Why |
|---|---|---|
| Repo strategy | Single flat repo per app, not monorepo. `daisy-platform` holds the portal + Supabase migrations + Edge Functions. `daisy-medical` (M3) is its own repo. No Turborepo, no npm workspaces, no shared packages. | Each Netlify site connects 1:1 to a repo. Drops monorepo machinery we don't need. Shared types/utils duplicate between repos when M3 lands; trivial cost given how little is shared. |
| Build tool | Vite 6 + React 19 + TypeScript 5 | PRD §2.1; React 19 stable enough for Wave 1 to ship on. |
| Router | React Router v7 | Simpler than TanStack Router, sufficient for M1 scope, broad ecosystem. v7 ships as the single `react-router` package; the old `react-router-dom` split is deprecated. |
| Server state | TanStack Query v5 | PRD §2.1. |
| Client state | Zustand 5 (persisted) | PRD §2.1. |
| Forms | React Hook Form + Zod | PRD §2.1. |
| Charts | Recharts | PRD §2.1. |
| UI primitives | shadcn/ui on Radix + Tailwind 4 | shadcn copies primitives into the repo so we own them; Tailwind 4 with the `@tailwindcss/vite` plugin and CSS-first `@theme` config. |
| Map provider | Google Maps JavaScript API + Geocoding API | PRD §21.1 — no fallback to Leaflet now that GCP is being set up Day 0. |
| Booking reference | Single global `da_bookings_seq` PostgreSQL sequence; reset January 1 each year | Simpler than per-franchisee; format `DA-{YYYY}-{number:05d}-{seq}`. |
| Money | Integer pence everywhere | PRD §4.1. `formatPence(p)` is the only money formatter; never use raw numbers in UI. |
| Time | UTC in DB, `Europe/London` for display, `Intl.DateTimeFormat` not raw `toISOString().split('T')[0]` | Avoids BST off-by-one bugs. |
| Mutations | All via Edge Functions (service_role) — clients use anon key + RLS for reads | PRD §4.18. |
| Audit log | `da_activities` insert from every Edge Function mutation; never from client | PRD §4.15. |
| Mobile target | Tablet-first responsive (iPad). HQ desktop is primary. | Jenni mentioned iPad use; phone is M2+/franchisee priority. |
| Encryption (medical) | Defer to M3 — flag here as "to decide before Wave 12" | Not in M1 scope. |
| Email templates | Defer to M2 | Not in M1 scope. |

## Decisions taken in Wave 1A beyond the plan

| Decision | Choice | Why |
|---|---|---|
| ESLint config style | Flat config (`eslint.config.js`) | ESLint 9 default; the legacy `.eslintrc` format is deprecated. |
| `tsconfig` layout | Project references with `tsconfig.app.json` (src) and `tsconfig.node.json` (vite/vitest configs) | Standard Vite 6 + TS 5 layout; lets `tsc -b` cache build state across the two graphs. |
| shadcn install | Wrote the primitives directly rather than running `npx shadcn init` interactively | The CLI's interactive setup is awkward inside a non-interactive agent shell, and shadcn's whole point is that you own the source — there's no behavioural difference. The 11 primitives in `src/components/ui/` are byte-comparable to what `shadcn add` would have produced. |
| `RoleContext` table-missing fallback | Treat "table doesn't exist" as `notProvisioned: false` so the placeholder dashboard still renders during local dev before Wave 1B's migrations land | Otherwise every Wave 1A smoke test would require Wave 1B to be merged first. Once `da_franchisees` exists, the missing-row case correctly routes to `/unauthorized`. |
| CI build env | Set placeholder `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` for the GitHub Actions build step only | The Supabase client throws at module load if either is missing; placeholders let the static build complete without exposing real keys to CI. Real keys live in Netlify env, never in CI. |
| `husky`/`lint-staged`/`prettier` deps installed but not configured here | Per coordination: Agent 1C owns `.husky/`, `.prettierrc`, `.lintstagedrc`, `.prettierignore`. We install the tools and add `prepare: husky` to `package.json` so the postinstall hook works once 1C's config files land. | |

## Deferred decisions

- **Stripe Connect model** — must be locked before Wave 6 kickoff (M2 Week 8).
- **Medical declaration encryption** — must be locked before Wave 12 (M3).
- **Custom domain cutover** — at end of M3 ahead of the Kartra/BookWhen kill.
