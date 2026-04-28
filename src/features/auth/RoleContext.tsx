import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Franchisee } from '@/types/franchisee'
import { useAuthStore } from '@/stores/authStore'

interface RoleContextValue {
  user: User | null
  franchisee: Franchisee | null
  isHQ: boolean
  isLoading: boolean
  notProvisioned: boolean
  signOut: () => Promise<void>
}

const RoleContext = createContext<RoleContextValue | null>(null)

/**
 * Postgrest error code for "relation does not exist". Surfaced when
 * Wave 1B hasn't applied migrations yet.
 */
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205'])

async function fetchFranchisee(userId: string): Promise<{
  row: Franchisee | null
  notProvisioned: boolean
  tableMissing: boolean
}> {
  try {
    const { data, error } = await supabase
      .from('da_franchisees')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle()

    if (error) {
      if (TABLE_MISSING_CODES.has(error.code ?? '')) {
        return { row: null, notProvisioned: false, tableMissing: true }
      }
      // Real DB error — surface it via the not-provisioned path so the
      // user gets a friendly screen instead of a crash.
      console.error('RoleContext: failed to load franchisee row', error)
      return { row: null, notProvisioned: true, tableMissing: false }
    }

    if (!data) {
      return { row: null, notProvisioned: true, tableMissing: false }
    }

    return { row: data as Franchisee, notProvisioned: false, tableMissing: false }
  } catch (err) {
    console.error('RoleContext: unexpected error fetching franchisee', err)
    return { row: null, notProvisioned: true, tableMissing: false }
  }
}

export function RoleContextProvider({ children }: { children: ReactNode }) {
  const {
    user,
    franchisee,
    isHQ,
    isLoading,
    notProvisioned,
    setUser,
    setFranchisee,
    setLoading,
    setNotProvisioned,
    reset,
  } = useAuthStore()

  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function hydrate(currentUser: User | null) {
      if (!currentUser) {
        if (cancelled) return
        reset()
        setLoading(false)
        return
      }
      setLoading(true)
      const { row, notProvisioned: missing, tableMissing } =
        await fetchFranchisee(currentUser.id)
      if (cancelled) return
      setUser(currentUser)
      setFranchisee(row)
      // If Wave 1B hasn't shipped yet, treat the user as provisioned
      // so the dev placeholder dashboard still renders. Once tables
      // exist, missing-row paths route to /unauthorized.
      setNotProvisioned(tableMissing ? false : missing)
      setLoading(false)
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        void hydrate(data.session?.user ?? null)
        setHydrated(true)
      })
      .catch((err) => {
        console.error('RoleContext: getSession failed', err)
        reset()
        setLoading(false)
        setHydrated(true)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void hydrate(session?.user ?? null)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
    // We deliberately wire this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value: RoleContextValue = {
    user,
    franchisee,
    isHQ,
    isLoading: isLoading || !hydrated,
    notProvisioned,
    signOut: async () => {
      await supabase.auth.signOut()
      reset()
    },
  }

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext)
  if (!ctx) {
    throw new Error('useRole must be used inside RoleContextProvider')
  }
  return ctx
}
