import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useUpdateCourseInstance, type CourseInstanceDetail } from './queries';

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

const editSchema = z.object({
  event_date: z
    .string()
    .min(1, 'Event date is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  start_time: z
    .string()
    .min(1, 'Start time is required')
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM'),
  end_time: z
    .string()
    .min(1, 'End time is required')
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM'),
  venue_name: z.string().optional(),
  venue_address: z.string().optional(),
  venue_postcode: z
    .string()
    .min(1, 'Postcode is required')
    .regex(UK_POSTCODE_RE, 'Enter a valid UK postcode'),
  capacity: z
    .number({ invalid_type_error: 'Capacity must be a number' })
    .int('Capacity must be a whole number')
    .positive('Capacity must be greater than zero'),
  price_pounds: z
    .number({ invalid_type_error: 'Price must be a number' })
    .nonnegative('Price cannot be negative'),
});

type EditFormValues = z.infer<typeof editSchema>;

interface Props {
  instance: CourseInstanceDetail;
  open: boolean;
  onClose: () => void;
}

export default function EditInstanceDialog({ instance, open, onClose }: Props) {
  const updateInstance = useUpdateCourseInstance();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      event_date: instance.event_date,
      start_time: instance.start_time.slice(0, 5),
      end_time: instance.end_time.slice(0, 5),
      venue_name: instance.venue_name ?? '',
      venue_address: instance.venue_address ?? '',
      venue_postcode: instance.venue_postcode,
      capacity: instance.capacity,
      price_pounds: instance.price_pence / 100,
    },
  });

  const onSubmit = async (values: EditFormValues) => {
    try {
      const fields: Record<string, unknown> = {
        event_date: values.event_date,
        start_time: values.start_time.length === 5 ? `${values.start_time}:00` : values.start_time,
        end_time: values.end_time.length === 5 ? `${values.end_time}:00` : values.end_time,
        venue_name: values.venue_name?.trim() || null,
        venue_address: values.venue_address?.trim() || null,
        venue_postcode: values.venue_postcode.trim().toUpperCase(),
        capacity: values.capacity,
        price_pence: Math.round(values.price_pounds * 100),
      };

      await updateInstance.mutateAsync({ id: instance.id, fields });
      toast.success('Course updated');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed';
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit course</DialogTitle>
          <DialogDescription>
            HQ override for support / admin. Changes are audit-logged. Bookings already taken are
            preserved.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ci-date">Event date</Label>
              <Input id="ci-date" type="date" {...register('event_date')} />
              {errors.event_date ? (
                <p className="text-daisy-orange text-xs">{errors.event_date.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ci-start">Start</Label>
              <Input id="ci-start" type="time" {...register('start_time')} />
              {errors.start_time ? (
                <p className="text-daisy-orange text-xs">{errors.start_time.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ci-end">End</Label>
              <Input id="ci-end" type="time" {...register('end_time')} />
              {errors.end_time ? (
                <p className="text-daisy-orange text-xs">{errors.end_time.message}</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ci-venue-name">Venue name</Label>
            <Input id="ci-venue-name" {...register('venue_name')} />
            {errors.venue_name ? (
              <p className="text-daisy-orange text-xs">{errors.venue_name.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ci-venue-address">Venue address</Label>
            <Input id="ci-venue-address" {...register('venue_address')} />
            {errors.venue_address ? (
              <p className="text-daisy-orange text-xs">{errors.venue_address.message}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ci-postcode">Postcode</Label>
              <Input id="ci-postcode" {...register('venue_postcode')} />
              {errors.venue_postcode ? (
                <p className="text-daisy-orange text-xs">{errors.venue_postcode.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ci-capacity">Capacity</Label>
              <Input
                id="ci-capacity"
                type="number"
                step="1"
                min="1"
                {...register('capacity', { valueAsNumber: true })}
              />
              {errors.capacity ? (
                <p className="text-daisy-orange text-xs">{errors.capacity.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ci-price">Price (£)</Label>
              <Input
                id="ci-price"
                type="number"
                step="0.01"
                min="0"
                {...register('price_pounds', { valueAsNumber: true })}
              />
              {errors.price_pounds ? (
                <p className="text-daisy-orange text-xs">{errors.price_pounds.message}</p>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
