/**
 * AddBookingDialog — record an OFFLINE booking (cheque / invoice / phone).
 *
 * Shared by the franchisee and HQ bookings lists. The course-instance list is
 * scoped by RLS: a franchisee sees only their own scheduled courses, HQ sees
 * all. Calls the create-booking Edge Function, which inserts the booking as
 * payment_status='pending' so it can then be marked paid once money arrives.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone } from 'date-fns-tz';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatPence } from '@/lib/format';

interface BookableInstance {
  id: string;
  event_date: string;
  venue_postcode: string | null;
  spots_remaining: number;
  template_name: string | null;
}

interface InstanceTicketType {
  id: string;
  name: string;
  price_pence: number;
  seats_consumed: number;
}

function formatDate(d: string | null): string {
  if (!d) return '';
  try {
    return formatInTimeZone(new Date(`${d}T00:00:00Z`), 'Europe/London', 'd MMM yyyy');
  } catch {
    return d;
  }
}

/** Scheduled courses with at least one space left. RLS scopes own vs all. */
function useBookableInstances(enabled: boolean) {
  return useQuery<BookableInstance[]>({
    enabled,
    queryKey: ['bookable-instances'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_course_instances')
        .select(
          'id, event_date, venue_postcode, spots_remaining, template:da_course_templates(name)',
        )
        .eq('status', 'scheduled')
        .gt('spots_remaining', 0)
        .order('event_date', { ascending: true });
      if (error) throw error;
      type Row = {
        id: string;
        event_date: string;
        venue_postcode: string | null;
        spots_remaining: number;
        template: { name: string } | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        event_date: r.event_date,
        venue_postcode: r.venue_postcode,
        spots_remaining: r.spots_remaining,
        template_name: r.template?.name ?? null,
      }));
    },
  });
}

function useInstanceTicketTypes(instanceId: string) {
  return useQuery<InstanceTicketType[]>({
    enabled: instanceId.length > 0,
    queryKey: ['instance-ticket-types', instanceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_ticket_types')
        .select('id, name, price_pence, seats_consumed')
        .eq('course_instance_id', instanceId)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as InstanceTicketType[];
    },
  });
}

interface CreateBookingPayload {
  course_instance_id: string;
  ticket_type_id: string;
  quantity: number;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    postcode: string | null;
  };
  notes: string | null;
}

function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; booking_reference: string }, Error, CreateBookingPayload>({
    mutationFn: async (payload) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('You must be signed in to add a booking.');
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // not JSON
        }
        throw new Error(message);
      }
      return (await res.json()) as { id: string; booking_reference: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hq', 'bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['franchisee', 'bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['bookable-instances'] });
    },
  });
}

export default function AddBookingDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (bookingId: string) => void;
}) {
  const [instanceId, setInstanceId] = useState('');
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [postcode, setPostcode] = useState('');
  const [notes, setNotes] = useState('');

  const instances = useBookableInstances(open);
  const ticketTypes = useInstanceTicketTypes(instanceId);
  const mutation = useCreateBooking();

  // Reset the ticket type whenever the chosen course changes.
  useEffect(() => {
    setTicketTypeId('');
  }, [instanceId]);

  function reset() {
    setInstanceId('');
    setTicketTypeId('');
    setQuantity(1);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setPostcode('');
    setNotes('');
  }

  function handleOpenChange(next: boolean) {
    if (!next && !mutation.isPending) {
      reset();
      onClose();
    }
  }

  const selectedTicket = ticketTypes.data?.find((t) => t.id === ticketTypeId) ?? null;
  const total = selectedTicket ? selectedTicket.price_pence * quantity : 0;

  const canSubmit =
    instanceId.length > 0 &&
    ticketTypeId.length > 0 &&
    quantity >= 1 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate(
      {
        course_instance_id: instanceId,
        ticket_type_id: ticketTypeId,
        quantity,
        customer: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          postcode: postcode.trim() || null,
        },
        notes: notes.trim() || null,
      },
      {
        onSuccess: (data) => {
          toast.success(`Booking ${data.booking_reference} added (awaiting payment).`);
          reset();
          onClose();
          onCreated(data.id);
        },
        onError: (err) => toast.error(err.message ?? 'Failed to add booking.'),
      },
    );
  }

  const labelCls = 'text-daisy-muted text-[11px] font-bold tracking-wider uppercase';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a booking</DialogTitle>
          <DialogDescription>
            Record a booking taken offline (cheque, invoice or phone). It's saved as awaiting
            payment, then mark it paid once the money arrives.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ab-course" className={labelCls}>
              Course
            </Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger id="ab-course">
                <SelectValue
                  placeholder={instances.isLoading ? 'Loading courses…' : 'Choose a course'}
                />
              </SelectTrigger>
              <SelectContent>
                {(instances.data ?? []).map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.template_name ?? 'Course'} · {formatDate(i.event_date)}
                    {i.venue_postcode ? ` · ${i.venue_postcode}` : ''} ({i.spots_remaining} left)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!instances.isLoading && (instances.data?.length ?? 0) === 0 ? (
              <p className="text-daisy-muted text-xs">
                No scheduled courses with spaces. Schedule a course first.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-ticket" className={labelCls}>
                Ticket type
              </Label>
              <Select
                value={ticketTypeId}
                onValueChange={setTicketTypeId}
                disabled={instanceId.length === 0}
              >
                <SelectTrigger id="ab-ticket">
                  <SelectValue
                    placeholder={instanceId ? 'Choose a ticket' : 'Pick a course first'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(ticketTypes.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {formatPence(t.price_pence)}
                      {t.seats_consumed !== 1 ? ` · ${t.seats_consumed} seats` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-qty" className={labelCls}>
                Quantity
              </Label>
              <Input
                id="ab-qty"
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-first" className={labelCls}>
                First name
              </Label>
              <Input
                id="ab-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-last" className={labelCls}>
                Last name
              </Label>
              <Input id="ab-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ab-email" className={labelCls}>
              Customer email
            </Label>
            <Input
              id="ab-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-phone" className={labelCls}>
                Phone (optional)
              </Label>
              <Input id="ab-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-postcode" className={labelCls}>
                Postcode (optional)
              </Label>
              <Input
                id="ab-postcode"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ab-notes" className={labelCls}>
              Notes (optional)
            </Label>
            <Input
              id="ab-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. paying by cheque, invoice 1234"
            />
          </div>

          {selectedTicket ? (
            <p className="text-daisy-ink text-sm font-semibold">Total: {formatPence(total)}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? 'Adding…' : 'Add booking'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
