import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { formatInTimeZone } from 'date-fns-tz';
import { StatusPill } from '@/components/daisy';
import type { StatusVariant } from '@/components/daisy/StatusPill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabase';
import { useRole } from '@/features/auth/RoleContext';

/**
 * "Emails" card shared by the HQ and franchisee booking detail pages.
 *
 * Lists the booking's da_email_sequences rows (journey emails queued by the
 * post-booking webhook, drained by the hourly send-emails cron). Franchisees
 * see their own bookings' rows via the franchisee_own RLS policy; HQ sees
 * everything and additionally gets a "Resend" action on failed rows, which
 * simply flips the row back to pending for the next cron run.
 */

const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

interface EmailSequenceRow {
  id: string;
  template_key: string;
  scheduled_for: string;
  sent_at: string | null;
  opened_at: string | null;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
}

const STATUS_VARIANT: Record<EmailSequenceRow['status'], StatusVariant> = {
  pending: 'pending',
  sent: 'active',
  failed: 'failed',
  cancelled: 'terminated',
};

/** 'recap_head_injuries' → 'Recap head injuries' (with CPR/HQ kept uppercase). */
export function humaniseTemplateKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  const capitalised = words.charAt(0).toUpperCase() + words.slice(1);
  return capitalised.replace(/\bcpr\b/gi, 'CPR').replace(/\bhq\b/gi, 'HQ');
}

function formatLondonDateTime(iso: string): string {
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy, HH:mm');
  } catch {
    return iso;
  }
}

function bookingEmailsKey(bookingId: string) {
  return ['booking-emails', bookingId] as const;
}

function useBookingEmails(bookingId: string) {
  return useQuery<EmailSequenceRow[]>({
    queryKey: bookingEmailsKey(bookingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_email_sequences')
        .select('id, template_key, scheduled_for, sent_at, opened_at, status')
        .eq('booking_id', bookingId)
        .order('scheduled_for', { ascending: true });
      if (error) {
        if (TABLE_MISSING_CODES.has(error.code ?? '')) return [];
        throw error;
      }
      return (data ?? []) as EmailSequenceRow[];
    },
  });
}

/** HQ-only: requeue a failed row. RLS blocks franchisees from this update. */
function useResendBookingEmail(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (sequenceId) => {
      const { error } = await supabase
        .from('da_email_sequences')
        .update({ status: 'pending' })
        .eq('id', sequenceId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Queued — sends on the next hourly run');
      void queryClient.invalidateQueries({ queryKey: bookingEmailsKey(bookingId) });
    },
    onError: (err) => {
      toast.error(err.message || 'Could not requeue the email.');
    },
  });
}

export function BookingEmailsCard({ bookingId }: { bookingId: string }) {
  const { isHQ } = useRole();
  const emails = useBookingEmails(bookingId);
  const resend = useResendBookingEmail(bookingId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Emails</CardTitle>
        <CardDescription>
          Journey emails scheduled for this booking. Sends run hourly.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {emails.isLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : emails.isError ? (
          <p className="text-daisy-muted p-5 text-sm">
            Could not load emails: {emails.error.message}
          </p>
        ) : (emails.data ?? []).length === 0 ? (
          <p className="text-daisy-muted p-5 text-sm italic">
            No emails scheduled for this booking yet.
          </p>
        ) : (
          <ul className="divide-daisy-line divide-y divide-dashed">
            {(emails.data ?? []).map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm"
              >
                <span className="text-daisy-ink min-w-0 flex-1 basis-40 font-semibold">
                  {humaniseTemplateKey(row.template_key)}
                </span>
                <span
                  className="text-daisy-muted text-[13px] whitespace-nowrap"
                  title={row.sent_at ? `Sent ${formatLondonDateTime(row.sent_at)}` : undefined}
                >
                  {formatLondonDateTime(row.scheduled_for)}
                </span>
                <StatusPill variant={STATUS_VARIANT[row.status]}>{row.status}</StatusPill>
                {row.opened_at ? (
                  <span
                    className="inline-flex items-center gap-1 text-[12px] font-bold text-[#2F6F4F]"
                    title={`Opened ${formatLondonDateTime(row.opened_at)}`}
                  >
                    <Check aria-hidden className="h-3.5 w-3.5" />
                    Opened
                  </span>
                ) : null}
                {isHQ && row.status === 'failed' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resend.isPending}
                    onClick={() => resend.mutate(row.id)}
                  >
                    Resend
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default BookingEmailsCard;
