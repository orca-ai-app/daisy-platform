import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import type { Franchisee } from '@/types/franchisee'

interface AuthState {
  user: User | null
  franchisee: Franchisee | null
  isHQ: boolean
  isLoading: boolean
  /** True when we tried to fetch a franchisee row but none exists for this user. */
  notProvisioned: boolean
  setUser: (user: User | null) => void
  setFranchisee: (franchisee: Franchisee | null) => void
  setLoading: (isLoading: boolean) => void
  setNotProvisioned: (notProvisioned: boolean) => void
  reset: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  franchisee: null,
  isHQ: false,
  isLoading: true,
  notProvisioned: false,
  setUser: (user) => set({ user }),
  setFranchisee: (franchisee) =>
    set({ franchisee, isHQ: !!franchisee?.is_hq }),
  setLoading: (isLoading) => set({ isLoading }),
  setNotProvisioned: (notProvisioned) => set({ notProvisioned }),
  reset: () =>
    set({
      user: null,
      franchisee: null,
      isHQ: false,
      isLoading: false,
      notProvisioned: false,
    }),
}))
