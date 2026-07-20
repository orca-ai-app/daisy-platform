/**
 * /hq/medical — HQ medical declarations list (Wave 12).
 *
 * Lists submitted declarations with search + filter bar. Health data is
 * encrypted and NEVER shown in the list — decrypt a row only when needed;
 * every decryption is audit-logged server-side.
 */
import { useMemo, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { toast } from 'sonner';
import { PageHeader, StatusPill, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  type MedicalConditionKey,
} from './queries';

// ---------------------------------------------------------------------------
// Condition label map
// ---------------------------------------------------------------------------

const CONDITION_LABELS: Record<MedicalConditionKey, string> = {
  back_neck_arm_knee: 'Back/Neck/Arm/Knee problems',
  rupture_hernia: 'Rupture or Hernia',
  heart_bp_chest: 'Heart Disease/High Blood Pressure/Bronchitis/Asthma/chest problems',
  blackouts_seizures_epilepsy: 'Blackouts/Seizures/Epilepsy',
  pregnant: 'Currently or recently pregnant',
  none: 'Not applicable',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLondon(iso: string): string {
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy, HH:mm');
  } catch {
    return iso;
  }
}

function triBoolean(val: boolean | null, yesLabel = 'Yes', noLabel = 'No'): string {
  if (val === null || val === undefined) return '—';
  return val ? yesLabel : noLabel;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MedicalDeclarationsList() {
  const { data: rows = [], isLoading, error } = useMedicalDeclarations();
  const decrypt = useDecryptDeclaration();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<DecryptedDeclaration | null>(null);

  // Filter state
  const [search, setSearch] = useState('');
  const [franchiseeFilter, setFranchiseeFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [linkedFilter, setLinkedFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [emailOptInFilter, setEmailOptInFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [photoConsentFilter, setPhotoConsentFilter] = useState<'all' | 'yes' | 'no'>('all');

  // Distinct franchisees from loaded rows
  const franchiseeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.franchisee_number && r.franchisee_name) {
        seen.set(r.franchisee_number, r.franchisee_name);
      }
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  // Client-side filtering
  const filtered = useMemo(() => {
    const searchLower = search.toLowerCase().trim();
    return rows.filter((r) => {
      if (searchLower) {
        const haystack = [r.attendee_name, r.attendee_email ?? ''].join(' ').toLowerCase();
        if (!haystack.includes(searchLower)) return false;
      }
      if (franchiseeFilter !== 'all' && r.franchisee_number !== franchiseeFilter) return false;
      if (fromDate) {
        const rowDate = r.created_at.slice(0, 10);
        if (rowDate < fromDate) return false;
      }
      if (toDate) {
        const rowDate = r.created_at.slice(0, 10);
        if (rowDate > toDate) return false;
      }
      if (linkedFilter === 'linked' && !r.booking_reference) return false;
      if (linkedFilter === 'unlinked' && r.booking_reference) return false;
      if (emailOptInFilter === 'yes' && r.email_opt_in !== true) return false;
      if (emailOptInFilter === 'no' && r.email_opt_in !== false) return false;
      if (photoConsentFilter === 'yes' && r.photo_consent !== true) return false;
      if (photoConsentFilter === 'no' && r.photo_consent !== false) return false;
      return true;
    });
  }, [
    rows,
    search,
    franchiseeFilter,
    fromDate,
    toDate,
    linkedFilter,
    emailOptInFilter,
    photoConsentFilter,
  ]);

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
        subtitle="All submitted attendee declarations. Health data is encrypted — decrypt a row only when needed; each access is logged."
      />

      {error ? (
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load declarations: {error.message}
        </div>
      ) : null}

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email..."
          className="h-10 max-w-sm flex-1 rounded-full"
          aria-label="Search declarations"
        />

        <Select value={franchiseeFilter} onValueChange={setFranchiseeFilter}>
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="All franchisees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All franchisees</SelectItem>
            {franchiseeOptions.map(([number, name]) => (
              <SelectItem key={number} value={number}>
                {number} — {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-col gap-1">
          <label className="text-daisy-muted text-[10px] font-bold tracking-wider uppercase">
            From
          </label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-10 w-[150px]"
            aria-label="From date"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-daisy-muted text-[10px] font-bold tracking-wider uppercase">
            To
          </label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-10 w-[150px]"
            aria-label="To date"
          />
        </div>

        <Select
          value={linkedFilter}
          onValueChange={(v) => setLinkedFilter(v as 'all' | 'linked' | 'unlinked')}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any booking</SelectItem>
            <SelectItem value="linked">Linked booking</SelectItem>
            <SelectItem value="unlinked">No booking</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={emailOptInFilter}
          onValueChange={(v) => setEmailOptInFilter(v as 'all' | 'yes' | 'no')}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any email opt-in</SelectItem>
            <SelectItem value="yes">Email opted in</SelectItem>
            <SelectItem value="no">Email not opted in</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={photoConsentFilter}
          onValueChange={(v) => setPhotoConsentFilter(v as 'all' | 'yes' | 'no')}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any photo consent</SelectItem>
            <SelectItem value="yes">Photo consent given</SelectItem>
            <SelectItem value="no">Photo consent denied</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {filtered.length} declaration{filtered.length === 1 ? '' : 's'}
            {filtered.length !== rows.length ? ` (${rows.length} total)` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No declarations found"
                body={
                  rows.length === 0
                    ? 'Medical declarations submitted by attendees will appear here.'
                    : 'No declarations match the current filters.'
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-daisy-muted border-daisy-line border-b text-left text-[12px] uppercase">
                    <th className="px-5 py-3 font-bold">Attendee</th>
                    <th className="px-5 py-3 font-bold">Email</th>
                    <th className="px-5 py-3 font-bold">Franchisee</th>
                    <th className="px-5 py-3 font-bold">Area</th>
                    <th className="px-5 py-3 font-bold">Submitted</th>
                    <th className="px-5 py-3 font-bold">Booking</th>
                    <th className="px-5 py-3 font-bold">Emails</th>
                    <th className="px-5 py-3 font-bold">Photos</th>
                    <th className="px-5 py-3 font-bold">Consent</th>
                    <th className="px-5 py-3 font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-daisy-line-soft border-b">
                      <td className="text-daisy-ink px-5 py-3 font-semibold">{r.attendee_name}</td>
                      <td className="text-daisy-ink-soft px-5 py-3">{r.attendee_email ?? '—'}</td>
                      <td className="px-5 py-3">
                        {r.franchisee_number ? (
                          <span className="flex flex-col">
                            <span className="text-daisy-ink font-mono text-[12px] font-bold">
                              {r.franchisee_number}
                            </span>
                            <span className="text-daisy-muted text-[12px]">
                              {r.franchisee_name}
                            </span>
                          </span>
                        ) : (
                          <span className="text-daisy-muted">—</span>
                        )}
                      </td>
                      <td className="text-daisy-ink-soft px-5 py-3">
                        {r.territory_postcode ?? '—'}
                      </td>
                      <td className="text-daisy-ink-soft px-5 py-3">
                        {formatLondon(r.created_at)}
                      </td>
                      <td className="text-daisy-ink-soft px-5 py-3 font-mono text-[12px]">
                        {r.booking_reference ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={
                            r.email_opt_in === true
                              ? 'text-daisy-primary font-semibold'
                              : 'text-daisy-muted'
                          }
                        >
                          {triBoolean(r.email_opt_in, '✓', '—')}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={
                            r.photo_consent === true
                              ? 'text-daisy-primary font-semibold'
                              : r.photo_consent === false
                                ? 'text-[#8A2A2A]'
                                : 'text-daisy-muted'
                          }
                        >
                          {r.photo_consent === true ? '✓' : r.photo_consent === false ? '✗' : '—'}
                        </span>
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
              <div>
                <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
                  Conditions declared
                </dt>
                <dd className="text-daisy-ink mt-1">
                  {revealed.declaration_data.conditions.length === 0 ? (
                    <span className="text-daisy-muted">None declared</span>
                  ) : (
                    <ul className="mt-1 flex flex-col gap-1">
                      {revealed.declaration_data.conditions.map((key) => (
                        <li key={key} className="flex items-start gap-1.5">
                          <span className="text-daisy-primary mt-0.5 shrink-0">•</span>
                          <span>{CONDITION_LABELS[key] ?? key}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
              <Field
                label="Special requirements advised"
                value={
                  revealed.declaration_data.special_requirements_advised === 'yes'
                    ? 'Yes'
                    : 'Not applicable'
                }
              />
              {(revealed.declaration_data as { special_requirements_detail?: string })
                .special_requirements_detail ? (
                <Field
                  label="Special requirements detail"
                  value={
                    (revealed.declaration_data as { special_requirements_detail?: string })
                      .special_requirements_detail ?? ''
                  }
                />
              ) : null}
              <Field
                label="Property disclaimer acknowledged"
                value={revealed.declaration_data.property_disclaimer_acknowledged ? 'Yes' : 'No'}
              />
              <Field
                label="Age 16+ confirmed"
                value={revealed.declaration_data.age_16_plus_confirmed ? 'Yes' : 'No'}
              />
              <Field
                label="GDPR terms agreed"
                value={revealed.declaration_data.gdpr_terms_agreed ? 'Yes' : 'No'}
              />
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
