import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url) {
  throw new Error(
    'Missing VITE_SUPABASE_URL. Copy .env.example to .env and set the Supabase project URL.',
  )
}

if (!anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and set the Supabase anon key.',
  )
}

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
