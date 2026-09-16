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
 *   venue_postcode, capacity, price_pence, display_name, venue_tbc.
 *
 * Private courses (NTH-9): the postcode may be a full postcode, an outcode
 * (e.g. GU1), or empty while "Venue to be confirmed" is ticked — so a TBC
 * venue can be completed later. Public courses still require a full postcode.
 *
 * Notifications (NTH-14, reworked 16 Sep 2026): when a material field
 * (date, time, venue address/postcode/TBC) changed on a class with
 * bookings, saving opens a dialog — "Save and email N customers" or
 * "Save without emailing". Cosmetic edits (labels, description, price)
 * save silently and never email; venue_name is also excluded server-side.
 *
 * Money is handled as pounds (max 2 decimals) in the form and converted to
 * integer pence before sending.  Dates are 'YYYY-MM-DD' wall-clock strings;
 * time inputs produce 'HH:MM' which the EF accepts.
 *
 * Wave 7B.
 */
import { useRef, useState } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  useCourseInstance,
  useUpdateCourseInstance,
  useCourseBookingsCount,
} from './courseDetailQueries';
import { poundsSchema } from './money';
import type { Visibility } from './types';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const UK_OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

function buildEditSchema(visibility: Visibility, isOnline: boolean) {
  return z
    .object({
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
      venue_postcode: z.string(),
      venue_tbc: z.boolean(),
      display_name: z.string(),
      capacity: z
        .number({ invalid_type_error: 'Capacity must be a number' })
        .int('Must be a whole number')
        .positive('Must be greater than zero'),
      price_pounds: poundsSchema,
      /** Optional customer-facing class description (G1 / migration 045). */
      description_override: z.string(),
      /** Private operational notes (Sep 2026) — never shown to customers. */
      bespoke_details: z.string().max(2000, 'Keep notes under 2000 characters'),
      /** Explicit confirmation that a £0.00 class is intentional (F6). */
      allow_free: z.boolean(),
    })
    .superRefine((vals, ctx) => {
      // F6: block an accidental £0.00 class unless explicitly confirmed.
      if (vals.price_pounds === 0 && !vals.allow_free) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price_pounds'],
          message: 'Enter a price, or tick "This class really is free" below.',
        });
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['allow_free'],
          message:
            'This class is priced at £0.00. Enter a price, or tick "This class really is free" to confirm.',
        });
      }

      const pc = vals.venue_postcode.trim();
      if (isOnline) {
        // Online classes have no venue; no postcode rules.
      } else if (visibility === 'public') {
        if (!UK_POSTCODE_RE.test(pc) && !UK_OUTCODE_RE.test(pc)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['venue_postcode'],
            message: 'Enter a valid UK postcode or district (e.g. SM1)',
          });
        }
      } else if (pc) {
        if (!UK_POSTCODE_RE.test(pc) && !UK_OUTCODE_RE.test(pc)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['venue_postcode'],
            message: 'Enter a valid UK postcode or district (e.g. GU1)',
          });
        }
      } else if (!vals.venue_tbc) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['venue_postcode'],
          message: 'Enter a postcode or district, or tick "Venue to be confirmed"',
        });
      }
    });
}

type EditFormValues = z.infer<ReturnType<typeof buildEditSchema>>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EditCourse() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: instance, isLoading, error } = useCourseInstance(id);
  const updateInstance = useUpdateCourseInstance();
  const bookingsCount = useCourseBookingsCount(id);

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
      bookingsCount={bookingsCount.data ?? 0}
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
  bookingsCount,
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
    venue_postcode: string | null;
    venue_tbc: boolean;
    display_name: string | null;
    visibility: Visibility;
    capacity: number;
    price_pence: number;
    /** Customer-facing description override (migration 045). */
    description_override?: string | null;
    /** Private operational notes — never shown to customers. */
    bespoke_details?: string | null;
    template?: { name: string; description?: string | null; is_online?: boolean } | null;
  };
  bookingsCount: number;
  navigate: ReturnType<typeof useNavigate>;
  updateInstance: ReturnType<typeof useUpdateCourseInstance>;
}) {
  const isPrivate = instance.visibility === 'private';

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty, dirtyFields },
  } = useForm<EditFormValues>({
    resolver: zodResolver(
      buildEditSchema(instance.visibility, instance.template?.is_online === true),
    ),
    defaultValues: {
      event_date: instance.event_date,
      start_time: instance.start_time.slice(0, 5),
      end_time: instance.end_time.slice(0, 5),
      venue_name: instance.venue_name ?? '',
      venue_address: instance.venue_address ?? '',
      venue_postcode: instance.venue_postcode ?? '',
      venue_tbc: instance.venue_tbc,
      display_name: instance.display_name ?? '',
      capacity: instance.capacity,
      price_pounds: instance.price_pence / 100,
      // G1: pre-fill from the saved override, falling back to the template's
      // description so the box shows the wording customers currently see.
      description_override: instance.description_override ?? instance.template?.description ?? '',
      bespoke_details: instance.bespoke_details ?? '',
      // Pre-tick for a class that is already saved as free, so editing an
      // unrelated field on an existing free class is not blocked.
      allow_free: instance.price_pence === 0,
    },
  });

  const venueTbc = watch('venue_tbc');
  const allowFree = watch('allow_free');
  const pricePounds = watch('price_pounds');

  // Notify gate (NTH-14, reworked 16 Sep): emailing booked customers is an
  // explicit save-time choice, never a silent side effect. Only material
  // changes (date, time, venue address/postcode/TBC) even offer it —
  // venue_name is a display label and cosmetic edits (description, prices,
  // labels) must not email anyone. The old auto-ticked checkbox let a label
  // rename email a whole class without the franchisee realising.
  const scheduleChanged = Boolean(
    dirtyFields.event_date ||
    dirtyFields.start_time ||
    dirtyFields.end_time ||
    dirtyFields.venue_address ||
    dirtyFields.venue_postcode ||
    dirtyFields.venue_tbc,
  );
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);
  const pendingValues = useRef<EditFormValues | null>(null);

  const onSubmit = async (values: EditFormValues) => {
    // Material change with live bookings: ask before saving. The dialog
    // resolves into saveCourse with the franchisee's explicit choice.
    if (scheduleChanged && bookingsCount > 0) {
      pendingValues.current = values;
      setNotifyDialogOpen(true);
      return;
    }
    await saveCourse(values, false);
  };

  const saveCourse = async (values: EditFormValues, notify: boolean) => {
    const tbc = isPrivate && values.venue_tbc;
    const postcode = values.venue_postcode.trim().toUpperCase();

    const fields: Record<string, unknown> = {
      event_date: values.event_date,
      // Normalise to HH:MM:SS so the Edge Function regex accepts it.
      start_time: values.start_time.length === 5 ? `${values.start_time}:00` : values.start_time,
      end_time: values.end_time.length === 5 ? `${values.end_time}:00` : values.end_time,
      venue_name: values.venue_name?.trim() || null,
      venue_address: values.venue_address?.trim() || null,
      venue_postcode: tbc && !postcode ? null : postcode,
      capacity: values.capacity,
      price_pence: Math.round(values.price_pounds * 100),
      // G1 (migration 045): null falls back to the template description.
      description_override: values.description_override.trim() || null,
      bespoke_details: values.bespoke_details.trim() || null,
    };
    if (isPrivate) {
      fields.venue_tbc = tbc;
      fields.display_name = values.display_name.trim() || null;
    }

    try {
      await updateInstance.mutateAsync({
        id: instanceId,
        fields,
        notify_attendees: notify,
      });
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

            {/* Private-only: customer-facing name + venue TBC (NTH-9) */}
            {isPrivate ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ec-display-name">
                    Class name shown to customers{' '}
                    <span className="text-daisy-muted font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="ec-display-name"
                    placeholder="e.g. BOOKED – Private 2hr Class for Anne S"
                    {...register('display_name')}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={venueTbc}
                    onChange={(e) =>
                      setValue('venue_tbc', e.target.checked, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    className="accent-daisy-primary h-4 w-4"
                  />
                  <span className="text-daisy-ink font-semibold">Venue to be confirmed</span>
                  <span className="text-daisy-muted">— you can add the venue later</span>
                </label>
              </>
            ) : null}

            {/* Venue */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-venue-name">Venue name</Label>
              <Input
                id="ec-venue-name"
                placeholder="e.g. Riverside Community Centre"
                disabled={venueTbc}
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
                disabled={venueTbc}
                {...register('venue_address')}
              />
              {errors.venue_address ? (
                <p className="text-daisy-orange text-xs">{errors.venue_address.message}</p>
              ) : null}
            </div>

            {/* Postcode + capacity + price */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ec-postcode">
                  {isPrivate
                    ? 'Postcode or district (e.g. GU1) — optional if venue TBC'
                    : 'Postcode'}
                </Label>
                <Input id="ec-postcode" disabled={venueTbc} {...register('venue_postcode')} />
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
                <Label htmlFor="ec-price">Standard price (£)</Label>
                <Input
                  id="ec-price"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('price_pounds', { valueAsNumber: true })}
                />
                <p className="text-daisy-muted text-xs">
                  The price used unless a ticket type sets its own. When ticket prices differ,
                  customers see "From £X".
                </p>
                {errors.price_pounds ? (
                  <p className="text-daisy-orange text-xs">{errors.price_pounds.message}</p>
                ) : null}
              </div>
            </div>

            {/* Free-class confirmation (F6) */}
            {pricePounds === 0 ? (
              <div className="border-daisy-line rounded-[8px] border-2 bg-white p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allowFree}
                    onChange={(e) =>
                      setValue('allow_free', e.target.checked, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    className="accent-daisy-primary mt-0.5 h-4 w-4"
                  />
                  <span>
                    <span className="text-daisy-ink font-semibold">This class really is free</span>
                    <span className="text-daisy-muted block text-xs">
                      This class is priced at £0.00. Tick this only if customers should pay nothing,
                      otherwise enter a price above.
                    </span>
                  </span>
                </label>
                {errors.allow_free ? (
                  <p className="text-daisy-orange mt-2 text-xs">{errors.allow_free.message}</p>
                ) : null}
              </div>
            ) : null}

            {/* Customer-facing description (G1 / migration 045) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-description">
                Description shown to customers{' '}
                <span className="text-daisy-muted font-normal">(optional)</span>
              </Label>
              <textarea
                id="ec-description"
                rows={4}
                placeholder="Describe what this class covers and who it suits..."
                className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
                {...register('description_override')}
              />
              <p className="text-daisy-muted text-xs">
                Starts from the standard description for this course type. Edit it to describe this
                particular class, or clear it to use the standard wording.
              </p>
            </div>

            {/* Private notes (Jenni, Sep 2026) — operational, never public */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-bespoke">Private notes (never shown to customers)</Label>
              <textarea
                id="ec-bespoke"
                rows={3}
                placeholder="e.g. freelancer name and fee, venue contact, key-safe code..."
                className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
                {...register('bespoke_details')}
              />
            </div>

            {/* Notify gate (NTH-14): the email decision moved to a save-time
                dialog — see notifyDialogOpen. Cosmetic edits never ask. */}

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

      {/* NTH-14 notify gate: shown only when date/time/venue changed on a
          class with live bookings. Both buttons save; they differ only in
          whether booked customers get the course_updated email. */}
      <Dialog open={notifyDialogOpen} onOpenChange={setNotifyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email this change to booked customers?</DialogTitle>
            <DialogDescription>
              You&apos;ve changed the date, time or venue.{' '}
              {bookingsCount === 1 ? 'There is 1 booking' : `There are ${bookingsCount} bookings`}{' '}
              on this class — they can be emailed the updated details so nobody turns up wrong.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={updateInstance.isPending}
              onClick={() => {
                const vals = pendingValues.current;
                setNotifyDialogOpen(false);
                if (vals) void saveCourse(vals, false);
              }}
            >
              Save without emailing
            </Button>
            <Button
              type="button"
              disabled={updateInstance.isPending}
              onClick={() => {
                const vals = pendingValues.current;
                setNotifyDialogOpen(false);
                if (vals) void saveCourse(vals, true);
              }}
            >
              Save and email {bookingsCount === 1 ? 'the customer' : `${bookingsCount} customers`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
