/**
 * RequestTerritoryDialog — a franchisee asks HQ for a new/expanded territory.
 *
 * Replaces the old mailto: link. On submit it calls the create-territory-request
 * Edge Function, which stores a da_territory_requests row. New requests surface
 * in the HQ dashboard Attention list (no email is sent).
 */

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
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

const schema = z.object({
  area: z.string().trim().min(1, 'Tell us which area you would like'),
  note: z.string().trim(),
});
type FormValues = z.infer<typeof schema>;

async function submitTerritoryRequest(payload: FormValues): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in to make a request.');

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-territory-request`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const b = (await res.json()) as { error?: string };
      if (b.error) message = b.error;
    } catch {
      // body wasn't JSON
    }
    throw new Error(message);
  }
}

export interface RequestTerritoryDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RequestTerritoryDialog({ open, onClose }: RequestTerritoryDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { area: '', note: '' },
  });

  const mutation = useMutation({ mutationFn: submitTerritoryRequest });

  function close() {
    reset();
    onClose();
  }

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: () => {
        toast.success('Request sent to HQ.');
        close();
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not send your request.'),
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a territory</DialogTitle>
          <DialogDescription>
            Tell HQ which area you would like to cover. Your request lands in their dashboard to
            review — no email needed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="territory-area">Area you would like</Label>
            <Input
              id="territory-area"
              placeholder="e.g. CR0, CR2 (Croydon) or 'south Manchester'"
              aria-invalid={!!errors.area}
              {...register('area')}
            />
            {errors.area ? (
              <p className="text-daisy-orange text-xs">{errors.area.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="territory-note">Anything to add (optional)</Label>
            <textarea
              id="territory-note"
              rows={4}
              placeholder="Why you want it, demand you are seeing, etc."
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
              {...register('note')}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={close} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
