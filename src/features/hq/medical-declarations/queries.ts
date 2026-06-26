/**
 * HQ Medical Declarations queries — Wave 12.
 *
 * List rows from da_medical_declarations (HQ has full RLS access).
 * declaration_data (encrypted bytea) is NEVER selected or rendered here —
 * decryption is performed server-side by the decrypt-medical-declaration
 * Edge Function and returned only on explicit per-row request.
 *
 * Query key root: ['hq', 'medical-declarations', ...]
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

async function getSessionToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in to perform this action.');
  return token;
}

// ---------------------------------------------------------------------------
// List shape — declaration_data is deliberately excluded
// ---------------------------------------------------------------------------

export interface MedicalDeclarationRow {
  id: string;
  created_at: string;
  attendee_name: string;
  attendee_email: string;
  territory_postcode: string | null;
  consent: boolean;
}

// ---------------------------------------------------------------------------
// Decrypted health fields returned by the Edge Function
// ---------------------------------------------------------------------------

export interface DecryptedDeclarationData {
  has_medical_conditions: boolean;
  medical_condition_details: string | null;
  has_allergies: boolean;
  allergy_details: string | null;
  has_mobility_limitations: boolean;
  mobility_details: string | null;
  is_pregnant: boolean;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  additional_info: string | null;
}

export interface DecryptedDeclaration {
  declaration_id: string;
  attendee_name: string;
  attendee_email: string;
  declaration_data: DecryptedDeclarationData;
}

// ---------------------------------------------------------------------------
// useMedicalDeclarations — full list for HQ
// ---------------------------------------------------------------------------

export function useMedicalDeclarations() {
  return useQuery<MedicalDeclarationRow[]>({
    queryKey: ['hq', 'medical-declarations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_medical_declarations')
        .select(
          'id, created_at, attendee_name, attendee_email, territory_postcode, consent:consent_given',
        )
        .order('created_at', { ascending: false });

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }
      return (data ?? []) as MedicalDeclarationRow[];
    },
  });
}

// ---------------------------------------------------------------------------
// useDecryptDeclaration — calls the HQ-only Edge Function per row
// ---------------------------------------------------------------------------

export function useDecryptDeclaration() {
  return useMutation<DecryptedDeclaration, Error, { declaration_id: string }>({
    mutationFn: async ({ declaration_id }) => {
      const token = await getSessionToken();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/decrypt-medical-declaration`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ declaration_id }),
      });

      if (!response.ok) {
        let message = `Decrypt failed (${response.status})`;
        if (response.status === 403) {
          message = 'Access denied. Only HQ administrators can decrypt medical declarations.';
        } else {
          try {
            const body = (await response.json()) as { error?: string };
            if (body.error) message = body.error;
          } catch {
            // body was not JSON
          }
        }
        const err = new Error(message);
        (err as Error & { status: number }).status = response.status;
        throw err;
      }

      return (await response.json()) as DecryptedDeclaration;
    },
  });
}
