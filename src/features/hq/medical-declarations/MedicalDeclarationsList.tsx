/**
 * /hq/medical — HQ medical declarations list (Wave 12).
 *
 * Lists submitted declarations (names + consent + submitted time only — the
 * health data is encrypted and NEVER shown here). Each row has a Decrypt button
 * that calls the HQ-only decrypt-medical-declaration Edge Function; every
 * decryption is audit-logged server-side.
 */
import { useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { toast } from 'sonner';
import { PageHeader, StatusPill, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useMedicalDeclarations,
  useDecryptDeclaration,
  type DecryptedDeclaration,
} from './queries';

function formatLondon(iso: string): string {
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy, HH:mm');
  } catch {
    return iso;
  }
}

function yesNo(b: boolean, detail: string | null): string {
  if (!b) return 'No';
  return detail && detail.trim() ? `Yes — ${detail}` : 'Yes';
}

export default function MedicalDeclarationsList() {
  const { data: rows = [], isLoading, error } = useMedicalDeclarations();
  const decrypt = useDecryptDeclaration();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<DecryptedDeclaration | null>(null);

  function onDecrypt(id: string) {
    decrypt.mutate(
      { declaration_id: id },
      {
        onSuccess: (data) => {
          setRevealed(data);
          setOpen(true);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Medical declarations"
        subtitle="Submitted attendee declarations. Health data is encrypted — decrypt a row only when needed; each access is logged."
      />

      {error ? (
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load declarations: {error.message}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {rows.length} declaration{rows.length === 1 ? '' : 's'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No declarations yet"
                body="Medical declarations submitted by attendees will appear here."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-daisy-muted border-daisy-line border-b text-left text-[12px] uppercase">
                    <th className="px-5 py-3 font-bold">Attendee</th>
                    <th className="px-5 py-3 font-bold">Email</th>
                    <th className="px-5 py-3 font-bold">Area</th>
                    <th className="px-5 py-3 font-bold">Submitted</th>
                    <th className="px-5 py-3 font-bold">Consent</th>
                    <th className="px-5 py-3 font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-daisy-line-soft border-b">
                      <td className="text-daisy-ink px-5 py-3 font-semibold">{r.attendee_name}</td>
                      <td className="text-daisy-ink-soft px-5 py-3">{r.attendee_email ?? '-'}</td>
                      <td className="text-daisy-ink-soft px-5 py-3">
                        {r.territory_postcode ?? '-'}
                      </td>
                      <td className="text-daisy-ink-soft px-5 py-3">
                        {formatLondon(r.created_at)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusPill variant={r.consent ? 'paid' : 'failed'}>
                          {r.consent ? 'Given' : 'Missing'}
                        </StatusPill>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onDecrypt(r.id)}
                          disabled={decrypt.isPending}
                        >
                          Decrypt
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Medical declaration — {revealed?.attendee_name}</DialogTitle>
            <DialogDescription>
              This access has been logged. Handle this health information carefully.
            </DialogDescription>
          </DialogHeader>
          {revealed ? (
            <dl className="grid grid-cols-1 gap-3 py-2 text-sm">
              <Field
                label="Medical conditions"
                value={yesNo(
                  revealed.declaration_data.has_medical_conditions,
                  revealed.declaration_data.medical_condition_details,
                )}
              />
              <Field
                label="Allergies"
                value={yesNo(
                  revealed.declaration_data.has_allergies,
                  revealed.declaration_data.allergy_details,
                )}
              />
              <Field
                label="Mobility limitations"
                value={yesNo(
                  revealed.declaration_data.has_mobility_limitations,
                  revealed.declaration_data.mobility_details,
                )}
              />
              <Field
                label="Pregnant"
                value={revealed.declaration_data.is_pregnant ? 'Yes' : 'No'}
              />
              <Field
                label="Emergency contact"
                value={
                  [
                    revealed.declaration_data.emergency_contact_name,
                    revealed.declaration_data.emergency_contact_phone,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '-'
                }
              />
              {revealed.declaration_data.additional_info ? (
                <Field label="Additional info" value={revealed.declaration_data.additional_info} />
              ) : null}
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">{label}</dt>
      <dd className="text-daisy-ink mt-0.5">{value}</dd>
    </div>
  );
}
