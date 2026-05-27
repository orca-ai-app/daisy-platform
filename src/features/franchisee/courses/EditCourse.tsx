/**
 * /franchisee/courses/:id/edit — full edit form for a course instance.
 *
 * Pre-fills from the live instance data, validates with Zod, submits to
 * the extended update-course-instance Edge Function.  Mirrors the HQ
 * EditInstanceDialog pattern as a full page (franchisees need more space
 * and a clear back-navigation context).
 *
 * Editable fields (matching the Edge Function's ALLOWED_FIELDS set):
 *   event_date, start_time, end_time, venue_name, venue_address,
 *   venue_postcode, capacity, price_pence.
 *
 * Money is handled as pounds (float) in the form and converted to integer
 * pence before sending.  Dates are 'YYYY-MM-DD' wall-clock strings; time
 * inputs produce 'HH:MM' which the EF accepts.
 *
 * Wave 7B.
 */
import { useNavigate, useParams, Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { PageHeader, EmptyState } from '@/components/daisy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

import { useCourseInstance, useUpdateCourseInstance } from './courseDetailQueries';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

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
    .int('Must be a whole number')
    .positive('Must be greater than zero'),
  price_pounds: z
    .number({ invalid_type_error: 'Price must be a number' })
    .nonnegative('Price cannot be negative'),
});

type EditFormValues = z.infer<typeof editSchema>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EditCourse() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: instance, isLoading, error } = useCourseInstance(id);
  const updateInstance = useUpdateCourseInstance();

  // Show loading skeleton while instance is fetching.
  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to={id ? `/franchisee/courses/${id}` : '/franchisee/courses'}
          className="text-daisy-primary mb-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
        >
          ← Back to course
        </Link>
        <PageHeader title="Edit course" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (error || !instance) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to="/franchisee/courses"
          className="text-daisy-primary mb-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
        >
          ← Back to courses
        </Link>
        <EmptyState
          title="Course not found"
          body="This course may have been removed or the link is incorrect."
          action={
            <Button asChild variant="outline">
              <Link to="/franchisee/courses">Back to list</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (instance.status === 'cancelled') {
    return (
      <div className="flex flex-col gap-6">
        <Link
          to={`/franchisee/courses/${instance.id}`}
          className="text-daisy-primary mb-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
        >
          ← Back to course
        </Link>
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          This course has been cancelled and cannot be edited.
        </div>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => void navigate(`/franchisee/courses/${instance.id}`)}
        >
          ← Back to course
        </Button>
      </div>
    );
  }

  return (
    <EditCourseForm
      instanceId={instance.id}
      instance={instance}
      navigate={navigate}
      updateInstance={updateInstance}
    />
  );
}

// ---------------------------------------------------------------------------
// Form sub-component (only rendered once instance is loaded, avoids hook
// ordering issues with conditional default values)
// ---------------------------------------------------------------------------

function EditCourseForm({
  instanceId,
  instance,
  navigate,
  updateInstance,
}: {
  instanceId: string;
  instance: {
    id: string;
    event_date: string;
    start_time: string;
    end_time: string;
    venue_name: string | null;
    venue_address: string | null;
    venue_postcode: string;
    capacity: number;
    price_pence: number;
    template?: { name: string } | null;
  };
  navigate: ReturnType<typeof useNavigate>;
  updateInstance: ReturnType<typeof useUpdateCourseInstance>;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
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
    const fields: Record<string, unknown> = {
      event_date: values.event_date,
      // Normalise to HH:MM:SS so the Edge Function regex accepts it.
      start_time: values.start_time.length === 5 ? `${values.start_time}:00` : values.start_time,
      end_time: values.end_time.length === 5 ? `${values.end_time}:00` : values.end_time,
      venue_name: values.venue_name?.trim() || null,
      venue_address: values.venue_address?.trim() || null,
      venue_postcode: values.venue_postcode.trim().toUpperCase(),
      capacity: values.capacity,
      price_pence: Math.round(values.price_pounds * 100),
    };

    try {
      await updateInstance.mutateAsync({ id: instanceId, fields });
      toast.success('Course updated');
      void navigate(`/franchisee/courses/${instanceId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        to={`/franchisee/courses/${instanceId}`}
        className="text-daisy-primary mb-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
      >
        ← Back to course
      </Link>

      <PageHeader title="Edit course" subtitle={instance.template?.name ?? undefined} />

      <Card>
        <CardHeader>
          <CardTitle>Course details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              void handleSubmit(onSubmit)(e);
            }}
            className="flex flex-col gap-5"
          >
            {/* Date + times */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ec-date">Event date</Label>
                <Input id="ec-date" type="date" {...register('event_date')} />
                {errors.event_date ? (
                  <p className="text-daisy-orange text-xs">{errors.event_date.message}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ec-start">Start time</Label>
                <Input id="ec-start" type="time" {...register('start_time')} />
                {errors.start_time ? (
                  <p className="text-daisy-orange text-xs">{errors.start_time.message}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ec-end">End time</Label>
                <Input id="ec-end" type="time" {...register('end_time')} />
                {errors.end_time ? (
                  <p className="text-daisy-orange text-xs">{errors.end_time.message}</p>
                ) : null}
              </div>
            </div>

            {/* Venue */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-venue-name">Venue name</Label>
              <Input
                id="ec-venue-name"
                placeholder="e.g. Riverside Community Centre"
                {...register('venue_name')}
              />
              {errors.venue_name ? (
                <p className="text-daisy-orange text-xs">{errors.venue_name.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-venue-address">Venue address</Label>
              <Input
                id="ec-venue-address"
                placeholder="e.g. 12 High Street, Townville"
                {...register('venue_address')}
              />
              {errors.venue_address ? (
                <p className="text-daisy-orange text-xs">{errors.venue_address.message}</p>
              ) : null}
            </div>

            {/* Postcode + capacity + price */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ec-postcode">Postcode</Label>
                <Input id="ec-postcode" {...register('venue_postcode')} />
                {errors.venue_postcode ? (
                  <p className="text-daisy-orange text-xs">{errors.venue_postcode.message}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ec-capacity">Capacity</Label>
                <Input
                  id="ec-capacity"
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
                <Label htmlFor="ec-price">Base price (£)</Label>
                <Input
                  id="ec-price"
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

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void navigate(`/franchisee/courses/${instanceId}`)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !isDirty}>
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
