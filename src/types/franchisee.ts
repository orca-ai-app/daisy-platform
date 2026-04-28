/**
 * Franchisee row shape. Matches the `da_franchisees` table that
 * Agent 1B is creating in Wave 1. Columns kept loose for now and
 * tightened once migrations land.
 */
export interface Franchisee {
  id: string
  auth_user_id: string | null
  number: string | null
  name: string | null
  email: string | null
  phone: string | null
  fee_tier: number | null
  billing_date: number | null
  status: string | null
  is_hq: boolean | null
  notes: string | null
  created_at: string
  updated_at: string
}
