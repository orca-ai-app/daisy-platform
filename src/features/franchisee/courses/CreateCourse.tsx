/**
 * CreateCourse — Wave 7A (+ pre-launch changes NTH-1/8/9/11/15).
 *
 * 5-step RHF+Zod wizard at /franchisee/courses/new.
 *
 * Step 1 — Template: pick from active da_course_templates (card grid).
 * Step 2 — Visibility: Public / Private. Private shows bespoke_details,
 *           private_client_id dropdown and a customer-facing class name
 *           override (display_name). Chosen BEFORE the venue step so the
 *           private-only venue relaxations (outcode / venue TBC) can apply.
 * Step 3 — Venue & Dates: event_date (+ optional additional dates — one
 *           instance is created per date on save), start/end time, venue
 *           fields, postcode. Private courses may give an outcode only
 *           (e.g. GU1) or tick "Venue to be confirmed". On postcode blur,
 *           calls a lightweight geocode preview to surface
 *           <TerritoryWarning> early. Requires the confirm tick when a
 *           warning shows before the user can proceed.
 * Step 4 — Pricing & Capacity: base price in POUNDS, capacity, ticket types
 *           (editable rows seeded from template default_ticket_types, with
 *           optional session details + VAT rate).
 * Step 5 — Review & Save: summary, then POST to create-course-instance once
 *           per date (sequentially). Per-date success/failure summary shown
 *           on partial failure; failed dates stay in the form for retry.
 *           On 409 territory conflict: surfaces TerritoryWarning + requires
 *           confirm before allowing re-submit. On success: routes to the
 *           new course (single date) or the list (multiple dates).
 *
 * Money is entered in POUNDS (max 2 decimals) and converted to integer pence
 * at submit — storage and the Edge Function contract stay pence.
 * Dates are 'YYYY-MM-DD' wall-clock strings (NOT reconstructed via Date).
 *
 * Duplicate (NTH-8): CourseDetail navigates here with
 * location.state.duplicate — the form pre-fills from that course with
 * event_date left empty.
 */

import { useState, useCallback } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/daisy';
import { TerritoryWarning } from '@/components/daisy/TerritoryWarning';
import { cn } from '@/lib/utils';

import {
  useCourseTemplates,
  useCreateCourseInstance,
  TerritoryConflictError,
} from './createCourseQueries';
import type {
  CourseTemplateOption,
  CreateCourseInstanceRequest,
  OutOfTerritoryWarning,
  Visibility,
} from './types';
import { formatPrice, penceToPounds, poundsSchema, poundsToPence } from './money';
import { supabase } from '@/lib/supabase';
import { PrivateClientSelect } from '@/features/franchisee/clients/PrivateClientSelect';

// ---------------------------------------------------------------------------
// Duplicate-course navigation state (NTH-8) — CourseDetail builds this.
// ---------------------------------------------------------------------------

export interface DuplicateCourseState {
  template_id: string;
  start_time: string;
  end_time: string;
  venue_name: string | null;
  venue_address: string | null;
  venue_postcode: string | null;
  venue_tbc: boolean;
  display_name: string | null;
  visibility: Visibility;
  bespoke_details: string | null;
  capacity: number;
  price_pence: number;
  ticket_types: Array<{
    name: string;
    price_pence: number;
    seats_consumed: number;
    max_available: number | null;
    sort_order: number | null;
    session_label: string | null;
    vat_rate: number | null;
  }>;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const FULL_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

/** Allowed VAT rate options (NTH-11). null = no VAT treatment recorded. */
const VAT_RATES = [0, 5, 20] as const;

const ticketTypeSchema = z.object({
  name: z.string().trim().min(1, 'Name required'),
  price_pounds: poundsSchema,
  seats_consumed: z
    .number({ invalid_type_error: 'Seats required' })
    .int()
    .min(1, 'At least 1 seat'),
  max_available: z.number({ invalid_type_error: 'Must be a number' }).int().min(1).nullable(),
  sort_order: z.number().int(),
  /** Optional session details, e.g. "6-hour · 9:30–15:30" (NTH-15). */
  session_label: z.string(),
  /** Optional VAT rate percentage; null = not recorded (NTH-11). */
  vat_rate: z.union([z.literal(0), z.literal(5), z.literal(20)]).nullable(),
});

const schema = z
  .object({
    template_id: z.string().uuid('Select a template'),
    event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date required'),
    /** Extra dates — one course instance is created per date (NTH-8). */
    additional_dates: z.array(
      z.object({ value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date required') }),
    ),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Start time required'),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, 'End time required'),
    venue_name: z.string().trim(),
    venue_address: z.string().trim(),
    venue_postcode: z.string().trim().toUpperCase(),
    /** Venue not yet confirmed — private courses only (NTH-9). */
    venue_tbc: z.boolean(),
    /** Customer-facing class name override — private courses (NTH-9). */
    display_name: z.string(),
    visibility: z.enum(['public', 'private']),
    capacity: z
      .number({ invalid_type_error: 'Capacity required' })
      .int()
      .min(1, 'Capacity must be at least 1'),
    price_pounds: poundsSchema,
    bespoke_details: z.string(),
    ticket_types: z.array(ticketTypeSchema).min(1, 'At least one ticket type required'),
    out_of_territory_confirmed: z.boolean(),
    /** Optional: private client selected in Step 2. Only relevant for private courses. */
    private_client_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((vals, ctx) => {
    // Postcode rules (NTH-9): public needs a full postcode; private accepts a
    // full postcode, an outcode (e.g. GU1), or nothing when venue TBC.
    const pc = vals.venue_postcode.trim();
    if (vals.visibility === 'public') {
      if (!FULL_POSTCODE_RE.test(pc)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['venue_postcode'],
          message: 'Enter a valid UK postcode',
        });
      }
    } else if (pc) {
      if (!FULL_POSTCODE_RE.test(pc) && !OUTCODE_RE.test(pc)) {
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

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Step indicators
// ---------------------------------------------------------------------------

const STEPS = [
  { label: 'Template' },
  { label: 'Visibility' },
  { label: 'Venue & Dates' },
  { label: 'Pricing' },
  { label: 'Review' },
] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Wizard steps" className="mb-8 flex items-center gap-0">
      {STEPS.map((step, i) => {
        const isComplete = i < current;
        const isActive = i === current;
        return (
          <div key={step.label} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full items-center">
              {i > 0 && (
                <div
                  className={cn(
                    'h-[2px] flex-1',
                    isComplete || isActive ? 'bg-daisy-primary' : 'bg-daisy-line',
                  )}
                />
              )}
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold',
                  isComplete
                    ? 'bg-daisy-primary text-white'
                    : isActive
                      ? 'border-daisy-primary text-daisy-primary border-2 bg-white'
                      : 'border-daisy-line text-daisy-muted border-2 bg-white',
                )}
                aria-current={isActive ? 'step' : undefined}
              >
                {isComplete ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-[2px] flex-1',
                    isComplete ? 'bg-daisy-primary' : 'bg-daisy-line',
                  )}
                />
              )}
            </div>
            <span
              className={cn(
                'text-[11px] font-semibold',
                isActive ? 'text-daisy-primary' : 'text-daisy-muted',
              )}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Template selection
// ---------------------------------------------------------------------------

function Step1Template({
  templates,
  isLoading,
  selectedId,
  onSelect,
}: {
  templates: CourseTemplateOption[];
  isLoading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="border-daisy-line bg-daisy-line-soft h-40 animate-pulse rounded-[12px] border-2"
          />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <p className="text-daisy-muted text-sm">
        No active course templates found. Ask HQ to activate a template first.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => {
        const isSelected = t.id === selectedId;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={cn(
              'flex flex-col gap-2 rounded-[12px] border-2 p-4 text-left transition-colors',
              isSelected
                ? 'border-daisy-primary bg-daisy-primary-tint'
                : 'border-daisy-line hover:border-daisy-primary hover:bg-daisy-primary-tint bg-white',
            )}
            aria-pressed={isSelected}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-daisy-ink text-base leading-snug font-bold">
                {t.name}
              </h3>
              {isSelected && (
                <div className="bg-daisy-primary flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </div>
            {t.description ? (
              <div className="text-daisy-muted text-xs">
                <p className={expandedIds.has(t.id) ? '' : 'line-clamp-2'}>{t.description}</p>
                {t.description.length > 70 ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(t.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleExpanded(t.id);
                      }
                    }}
                    className="text-daisy-primary mt-0.5 inline-block cursor-pointer text-[11px] font-semibold hover:underline"
                  >
                    {expandedIds.has(t.id) ? 'Show less' : 'Show more'}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-daisy-ink-soft text-xs">{t.duration_hours}h</span>
              {t.age_range ? (
                <span className="text-daisy-ink-soft text-xs">Ages {t.age_range}</span>
              ) : null}
              <span className="text-daisy-ink-soft text-xs font-semibold">
                {formatPrice(t.default_price_pence)} default
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Postcode territory preview hook (venue step)
//
// On blur of venue_postcode, we call geocode-postcode with the anon+session
// token to get a lightweight lat/lng + postcode_prefix, then check
// da_territories client-side to surface the warning early.
// This is a preview ONLY — the Edge Function re-derives everything server-side.
// A mismatch between preview and server result is acceptable (the 409 path
// handles it).
// ---------------------------------------------------------------------------

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; warning: OutOfTerritoryWarning }
  | { status: 'error'; message: string };

async function previewTerritoryWarning(
  postcode: string,
  franchiseeId: string,
): Promise<OutOfTerritoryWarning> {
  // 1. Geocode
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return 'none';

  const geocodeUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode-postcode`;
  const geocodeRes = await fetch(geocodeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ postcode }),
  });

  if (!geocodeRes.ok) return 'none';
  const { postcode_prefix } = (await geocodeRes.json()) as { postcode_prefix: string };
  if (!postcode_prefix) return 'none';

  // 2. Look up territory
  const { data: territory } = await supabase
    .from('da_territories')
    .select('franchisee_id, status')
    .eq('postcode_prefix', postcode_prefix)
    .maybeSingle();

  if (!territory) return 'vacant';
  if (territory.franchisee_id === franchiseeId) return 'none';
  if (territory.franchisee_id === null || territory.status === 'vacant') return 'vacant';
  return 'owned_by_other';
}

// ---------------------------------------------------------------------------
// Step 2 — Visibility (chosen before the venue so private-only venue
// relaxations can apply on the next step)
// ---------------------------------------------------------------------------

function Step2Visibility({ form }: { form: ReturnType<typeof useForm<FormValues>> }) {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const visibility = watch('visibility');
  const privateClientId = watch('private_client_id');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label>Visibility</Label>
        <Controller
          name="visibility"
          control={form.control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(v) => {
                setValue('visibility', v as Visibility, { shouldDirty: true });
                // Clear private-only fields when switching back to public.
                if (v === 'public') {
                  setValue('private_client_id', null, { shouldDirty: true });
                  setValue('venue_tbc', false, { shouldDirty: true });
                  setValue('display_name', '', { shouldDirty: true });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public - appears in the course finder</SelectItem>
                <SelectItem value="private">Private - invite-only, not in public search</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        {errors.visibility ? (
          <p className="text-daisy-orange text-xs">{errors.visibility.message}</p>
        ) : null}
      </div>

      {visibility === 'private' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="display-name">
              Class name shown to customers{' '}
              <span className="text-daisy-muted font-normal">(optional)</span>
            </Label>
            <Input
              id="display-name"
              type="text"
              placeholder="e.g. BOOKED – Private 2hr Class for Anne S"
              {...register('display_name')}
            />
            <p className="text-daisy-muted text-xs">
              Overrides the template name wherever customers see this class. Leave blank to use the
              template name.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bespoke-details">Bespoke details</Label>
            <textarea
              id="bespoke-details"
              rows={4}
              placeholder="Describe the private arrangement, special instructions, or client notes..."
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
              {...register('bespoke_details')}
            />
          </div>

          {/* Wave 9C — private client dropdown (wired) */}
          <div className="flex flex-col gap-1.5" data-wiring="private-client-id">
            <Label htmlFor="private-client-id">
              Private client <span className="text-daisy-muted font-normal">(optional)</span>
            </Label>
            <PrivateClientSelect
              id="private-client-id"
              value={privateClientId ?? null}
              onChange={(id) => setValue('private_client_id', id, { shouldDirty: true })}
            />
            <p className="text-daisy-muted text-xs">
              Link this course to a client in your directory. The Wave 8 booking webhook will stamp
              the client on every booking automatically.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Venue & Dates
// ---------------------------------------------------------------------------

function Step3Venue({
  form,
  territoryPreview,
  onPostcodeBlur,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  territoryPreview: PreviewState;
  onPostcodeBlur: () => void;
}) {
  const {
    register,
    control,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const confirmed = watch('out_of_territory_confirmed');
  const visibility = watch('visibility');
  const venueTbc = watch('venue_tbc');
  const previewWarning: OutOfTerritoryWarning =
    territoryPreview.status === 'done' ? territoryPreview.warning : 'none';

  const {
    fields: extraDates,
    append: appendDate,
    remove: removeDate,
  } = useFieldArray({ control, name: 'additional_dates' });

  return (
    <div className="flex flex-col gap-5">
      {/* Date + times */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-date">Date</Label>
          <Input id="event-date" type="date" {...register('event_date')} />
          {errors.event_date ? (
            <p className="text-daisy-orange text-xs">{errors.event_date.message}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="start-time">Start time</Label>
          <Input id="start-time" type="time" {...register('start_time')} />
          {errors.start_time ? (
            <p className="text-daisy-orange text-xs">{errors.start_time.message}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="end-time">End time</Label>
          <Input id="end-time" type="time" {...register('end_time')} />
          {errors.end_time ? (
            <p className="text-daisy-orange text-xs">{errors.end_time.message}</p>
          ) : null}
        </div>
      </div>

      {/* Additional dates (NTH-8) — one instance is created per date */}
      <div className="flex flex-col gap-2">
        {extraDates.map((field, i) => (
          <div key={field.id} className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5 sm:max-w-[calc(33.333%-0.667rem)]">
              <Label htmlFor={`extra-date-${i}`}>Additional date {i + 1}</Label>
              <Input
                id={`extra-date-${i}`}
                type="date"
                {...register(`additional_dates.${i}.value`)}
              />
              {errors.additional_dates?.[i]?.value ? (
                <p className="text-daisy-orange text-xs">
                  {errors.additional_dates[i].value?.message}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeDate(i)}
              aria-label={`Remove additional date ${i + 1}`}
              className="text-daisy-muted hover:text-daisy-orange"
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => appendDate({ value: '' })}
          >
            Add another date
          </Button>
          {extraDates.length > 0 ? (
            <p className="text-daisy-muted mt-1 text-xs">
              A separate course will be created for each date, with the same times, venue, pricing
              and tickets.
            </p>
          ) : null}
        </div>
      </div>

      {/* Venue TBC (private courses only, NTH-9) */}
      {visibility === 'private' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={venueTbc}
            onChange={(e) => {
              setValue('venue_tbc', e.target.checked, { shouldDirty: true, shouldValidate: true });
            }}
            className="accent-daisy-primary h-4 w-4"
          />
          <span className="text-daisy-ink font-semibold">Venue to be confirmed</span>
          <span className="text-daisy-muted">— you can add the venue later</span>
        </label>
      ) : null}

      {/* Venue */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="venue-name">Venue name</Label>
        <Input
          id="venue-name"
          type="text"
          placeholder="e.g. Sutton Community Centre"
          disabled={venueTbc}
          {...register('venue_name')}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="venue-address">Address</Label>
        <Input
          id="venue-address"
          type="text"
          placeholder="e.g. 12 High Street, Sutton"
          disabled={venueTbc}
          {...register('venue_address')}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="venue-postcode">
          {visibility === 'private'
            ? 'Postcode or district (e.g. GU1) — optional if venue TBC'
            : 'Postcode'}
        </Label>
        <Input
          id="venue-postcode"
          type="text"
          placeholder={visibility === 'private' ? 'e.g. SM1 1AB or GU1' : 'e.g. SM1 1AB'}
          disabled={venueTbc}
          {...register('venue_postcode', {
            onBlur: onPostcodeBlur,
          })}
          className="uppercase"
        />
        {errors.venue_postcode ? (
          <p className="text-daisy-orange text-xs">{errors.venue_postcode.message}</p>
        ) : null}
        {territoryPreview.status === 'loading' ? (
          <p className="text-daisy-muted text-xs">Checking territory...</p>
        ) : null}
        {territoryPreview.status === 'error' ? (
          <p className="text-daisy-muted text-xs">
            Territory check unavailable. Postcode will be verified when you save.
          </p>
        ) : null}
      </div>

      {/* Territory warning (preview) */}
      {previewWarning !== 'none' ? (
        <TerritoryWarning
          warning={previewWarning}
          confirmed={confirmed}
          onConfirmChange={(val) =>
            setValue('out_of_territory_confirmed', val, { shouldDirty: true })
          }
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Pricing & Capacity
// ---------------------------------------------------------------------------

function Step4Pricing({ form }: { form: ReturnType<typeof useForm<FormValues>> }) {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = form;

  const { fields, append, remove } = useFieldArray({ control, name: 'ticket_types' });
  const basePrice = watch('price_pounds');

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price-pounds">Base price (£)</Label>
          <Input
            id="price-pounds"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 65 or 65.50"
            {...register('price_pounds', { valueAsNumber: true })}
          />
          {errors.price_pounds ? (
            <p className="text-daisy-orange text-xs">{errors.price_pounds.message}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="capacity">Capacity</Label>
          <Input
            id="capacity"
            type="number"
            min="1"
            step="1"
            {...register('capacity', { valueAsNumber: true })}
          />
          {errors.capacity ? (
            <p className="text-daisy-orange text-xs">{errors.capacity.message}</p>
          ) : null}
        </div>
      </div>

      {/* Ticket types */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-daisy-ink text-sm font-bold">Ticket types</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({
                name: '',
                price_pounds: Number.isFinite(basePrice) ? basePrice : 0,
                seats_consumed: 1,
                max_available: null,
                sort_order: fields.length,
                session_label: '',
                vat_rate: null,
              })
            }
          >
            Add ticket type
          </Button>
        </div>
        {errors.ticket_types?.root ? (
          <p className="text-daisy-orange text-xs">{errors.ticket_types.root.message}</p>
        ) : null}

        {fields.map((field, i) => (
          <Card key={field.id} className="border-daisy-line">
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`tt-name-${i}`} className="text-xs">
                    Name
                  </Label>
                  <Input
                    id={`tt-name-${i}`}
                    type="text"
                    placeholder="Single"
                    {...register(`ticket_types.${i}.name`)}
                  />
                  {errors.ticket_types?.[i]?.name ? (
                    <p className="text-daisy-orange text-xs">
                      {errors.ticket_types[i].name?.message}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor={`tt-price-${i}`} className="text-xs">
                    Price (£)
                  </Label>
                  <Input
                    id={`tt-price-${i}`}
                    type="number"
                    min="0"
                    step="0.01"
                    {...register(`ticket_types.${i}.price_pounds`, { valueAsNumber: true })}
                  />
                  {errors.ticket_types?.[i]?.price_pounds ? (
                    <p className="text-daisy-orange text-xs">
                      {errors.ticket_types[i].price_pounds?.message}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor={`tt-seats-${i}`} className="text-xs">
                    Seats
                  </Label>
                  <Input
                    id={`tt-seats-${i}`}
                    type="number"
                    min="1"
                    step="1"
                    {...register(`ticket_types.${i}.seats_consumed`, { valueAsNumber: true })}
                  />
                </div>

                <div className="flex items-end pb-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(i)}
                    disabled={fields.length === 1}
                    aria-label={`Remove ticket type ${i + 1}`}
                    className="text-daisy-muted hover:text-daisy-orange"
                  >
                    Remove
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`tt-session-${i}`} className="text-xs">
                    Session details <span className="text-daisy-muted font-normal">(optional)</span>
                  </Label>
                  <Input
                    id={`tt-session-${i}`}
                    type="text"
                    placeholder="e.g. 6-hour · 9:30–15:30"
                    {...register(`ticket_types.${i}.session_label`)}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor={`tt-vat-${i}`} className="text-xs">
                    VAT rate
                  </Label>
                  <Controller
                    name={`ticket_types.${i}.vat_rate`}
                    control={control}
                    render={({ field: vatField }) => (
                      <Select
                        value={vatField.value === null ? 'none' : String(vatField.value)}
                        onValueChange={(v) => vatField.onChange(v === 'none' ? null : Number(v))}
                      >
                        <SelectTrigger id={`tt-vat-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {VAT_RATES.map((r) => (
                            <SelectItem key={r} value={String(r)}>
                              {r}%
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Review
// ---------------------------------------------------------------------------

/** Per-date outcome of a multi-date save (NTH-8). */
interface DateResult {
  date: string;
  ok: boolean;
  error?: string;
}

function Step5Review({
  form,
  template,
  serverWarning,
  multiResults,
  onConfirmChange,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  template: CourseTemplateOption | undefined;
  serverWarning: OutOfTerritoryWarning;
  multiResults: DateResult[] | null;
  onConfirmChange: (val: boolean) => void;
}) {
  const values = form.getValues();
  const allDates = [values.event_date, ...values.additional_dates.map((d) => d.value)];

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-daisy-muted font-semibold">Template</dt>
          <dd className="text-daisy-ink">{template?.name ?? values.template_id}</dd>
        </div>
        {values.visibility === 'private' && values.display_name.trim() ? (
          <div>
            <dt className="text-daisy-muted font-semibold">Shown to customers as</dt>
            <dd className="text-daisy-ink">{values.display_name.trim()}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-daisy-muted font-semibold">
            {allDates.length > 1 ? `Dates (${allDates.length} courses)` : 'Date'}
          </dt>
          <dd className="text-daisy-ink">{allDates.join(', ')}</dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Time</dt>
          <dd className="text-daisy-ink">
            {values.start_time} – {values.end_time}
          </dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Venue</dt>
          <dd className="text-daisy-ink">
            {values.venue_tbc
              ? 'To be confirmed'
              : `${values.venue_name || '—'}, ${values.venue_postcode}`}
          </dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Capacity</dt>
          <dd className="text-daisy-ink">{values.capacity}</dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Base price</dt>
          <dd className="text-daisy-ink">{formatPrice(poundsToPence(values.price_pounds))}</dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Visibility</dt>
          <dd className="text-daisy-ink capitalize">{values.visibility}</dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Ticket types</dt>
          <dd className="text-daisy-ink">
            {values.ticket_types
              .map((tt) => `${tt.name} (${formatPrice(poundsToPence(tt.price_pounds))})`)
              .join(', ')}
          </dd>
        </div>
        {values.visibility === 'private' && values.bespoke_details ? (
          <div className="sm:col-span-2">
            <dt className="text-daisy-muted font-semibold">Bespoke details</dt>
            <dd className="text-daisy-ink">{values.bespoke_details}</dd>
          </div>
        ) : null}
      </dl>

      {/* Per-date outcome summary after a multi-date save (NTH-8) */}
      {multiResults ? (
        <div className="border-daisy-line rounded-[8px] border-2 bg-white p-3">
          <p className="text-daisy-ink mb-2 text-sm font-bold">Save summary</p>
          <ul className="flex flex-col gap-1 text-sm">
            {multiResults.map((r) => (
              <li key={r.date} className="flex items-baseline gap-2">
                <span
                  className={
                    r.ok ? 'text-daisy-primary font-semibold' : 'text-daisy-orange font-semibold'
                  }
                >
                  {r.ok ? 'Created' : 'Failed'}
                </span>
                <span className="text-daisy-ink font-mono text-[13px]">{r.date}</span>
                {r.error ? <span className="text-daisy-muted text-xs">{r.error}</span> : null}
              </li>
            ))}
          </ul>
          {multiResults.some((r) => !r.ok) ? (
            <p className="text-daisy-muted mt-2 text-xs">
              The failed dates are still in the form — fix the problem and save again to retry just
              those dates.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Server-side territory warning (from 409 response) */}
      {serverWarning !== 'none' ? (
        <TerritoryWarning
          warning={serverWarning}
          confirmed={values.out_of_territory_confirmed}
          onConfirmChange={onConfirmChange}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard component
// ---------------------------------------------------------------------------

// Fields required per step (used to decide if Next is blocked by validation)
const STEP_FIELDS: (keyof FormValues)[][] = [
  ['template_id'],
  ['visibility'],
  ['event_date', 'additional_dates', 'start_time', 'end_time', 'venue_postcode'],
  ['price_pounds', 'capacity', 'ticket_types'],
  [],
];

/** Index of the venue step (territory-confirm gate lives there). */
const VENUE_STEP = 2;

export default function CreateCourse() {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(0);
  const [territoryPreview, setTerritoryPreview] = useState<PreviewState>({ status: 'idle' });
  const [serverWarning, setServerWarning] = useState<OutOfTerritoryWarning>('none');
  const [franchiseeId, setFranchiseeId] = useState<string | null>(null);
  const [multiResults, setMultiResults] = useState<DateResult[] | null>(null);

  // Duplicate prefill (NTH-8) — CourseDetail passes the source course via
  // navigation state; event_date is deliberately left empty.
  const [duplicate] = useState<DuplicateCourseState | null>(() => {
    const state = location.state as { duplicate?: DuplicateCourseState } | null;
    return state?.duplicate ?? null;
  });

  // Fetch the current franchisee id once, for territory preview only.
  useState(() => {
    void supabase
      .from('da_franchisees')
      .select('id')
      .then(async () => {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) return;
        const { data } = await supabase
          .from('da_franchisees')
          .select('id')
          .eq('auth_user_id', sessionData.session.user.id)
          .maybeSingle();
        if (data) setFranchiseeId((data as { id: string }).id);
      });
  });

  const { data: templates = [], isLoading: templatesLoading } = useCourseTemplates();
  const createMutation = useCreateCourseInstance();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: duplicate
      ? {
          template_id: duplicate.template_id,
          event_date: '',
          additional_dates: [],
          start_time: duplicate.start_time.slice(0, 5),
          end_time: duplicate.end_time.slice(0, 5),
          venue_name: duplicate.venue_name ?? '',
          venue_address: duplicate.venue_address ?? '',
          venue_postcode: duplicate.venue_postcode ?? '',
          venue_tbc: duplicate.venue_tbc,
          display_name: duplicate.display_name ?? '',
          visibility: duplicate.visibility,
          capacity: duplicate.capacity,
          price_pounds: penceToPounds(duplicate.price_pence),
          bespoke_details: duplicate.bespoke_details ?? '',
          ticket_types: duplicate.ticket_types.map((tt, i) => ({
            name: tt.name,
            price_pounds: penceToPounds(tt.price_pence),
            seats_consumed: tt.seats_consumed,
            max_available: tt.max_available,
            sort_order: tt.sort_order ?? i,
            session_label: tt.session_label ?? '',
            vat_rate: (VAT_RATES as readonly number[]).includes(tt.vat_rate ?? -1)
              ? (tt.vat_rate as 0 | 5 | 20)
              : null,
          })),
          out_of_territory_confirmed: false,
          private_client_id: null,
        }
      : {
          template_id: '',
          event_date: '',
          additional_dates: [],
          start_time: '',
          end_time: '',
          venue_name: '',
          venue_address: '',
          venue_postcode: '',
          venue_tbc: false,
          display_name: '',
          visibility: 'public',
          capacity: 12,
          price_pounds: 0,
          bespoke_details: '',
          ticket_types: [
            {
              name: 'Single',
              price_pounds: 0,
              seats_consumed: 1,
              max_available: null,
              sort_order: 0,
              session_label: '',
              vat_rate: null,
            },
          ],
          out_of_territory_confirmed: false,
          private_client_id: null,
        },
  });

  // When a template is selected, prefill pricing/capacity and seed ticket types.
  const handleTemplateSelect = useCallback(
    (id: string) => {
      const t = templates.find((x) => x.id === id);
      form.setValue('template_id', id, { shouldValidate: true });
      if (t) {
        form.setValue('price_pounds', penceToPounds(t.default_price_pence));
        form.setValue('capacity', t.default_capacity);
        const seeded =
          t.default_ticket_types && t.default_ticket_types.length > 0
            ? t.default_ticket_types.map((dt, i) => ({
                name: dt.name,
                price_pounds: penceToPounds(t.default_price_pence + dt.price_modifier_pence),
                seats_consumed: dt.seats_consumed,
                max_available: null as number | null,
                sort_order: i,
                session_label: '',
                vat_rate: null,
              }))
            : [
                {
                  name: 'Single',
                  price_pounds: penceToPounds(t.default_price_pence),
                  seats_consumed: 1,
                  max_available: null as number | null,
                  sort_order: 0,
                  session_label: '',
                  vat_rate: null,
                },
              ];
        form.setValue('ticket_types', seeded);
      }
    },
    [templates, form],
  );

  // Territory preview on postcode blur (full postcodes only — outcodes and
  // TBC venues are resolved server-side).
  const handlePostcodeBlur = useCallback(async () => {
    const postcode = form.getValues('venue_postcode');
    const valid = FULL_POSTCODE_RE.test(postcode);
    if (!valid || !franchiseeId || form.getValues('venue_tbc')) return;

    setTerritoryPreview({ status: 'loading' });
    try {
      const warning = await previewTerritoryWarning(postcode, franchiseeId);
      setTerritoryPreview({ status: 'done', warning });
      // If postcode changed to an in-territory location, clear any prior confirmation.
      if (warning === 'none') {
        form.setValue('out_of_territory_confirmed', false);
      }
    } catch {
      setTerritoryPreview({ status: 'error', message: 'Territory check failed' });
    }
  }, [form, franchiseeId]);

  // Validate only the fields for the current step before advancing.
  const handleNext = useCallback(async () => {
    const fields = STEP_FIELDS[step];
    if (fields.length > 0) {
      const ok = await form.trigger(fields as Parameters<typeof form.trigger>[0]);
      if (!ok) return;
    }

    // Venue step: if a territory warning is showing, require confirmation
    // before advancing.
    if (step === VENUE_STEP) {
      const preview = territoryPreview.status === 'done' ? territoryPreview.warning : 'none';
      if (preview !== 'none' && !form.getValues('out_of_territory_confirmed')) {
        form.setError('out_of_territory_confirmed', {
          message: 'Please confirm the territory warning before continuing.',
        });
        return;
      }
    }

    setStep((s) => s + 1);
  }, [step, form, territoryPreview]);

  const handleBack = () => setStep((s) => s - 1);

  // Final submit — one create-course-instance call per date (NTH-8).
  const handleSubmit = form.handleSubmit(async (values: FormValues) => {
    const isPrivate = values.visibility === 'private';
    const venueTbc = isPrivate && values.venue_tbc;
    const postcode = values.venue_postcode.trim().toUpperCase();

    const basePayload: Omit<CreateCourseInstanceRequest, 'event_date'> = {
      template_id: values.template_id,
      start_time: values.start_time,
      end_time: values.end_time,
      venue_name: (venueTbc ? '' : values.venue_name) || null,
      venue_address: (venueTbc ? '' : values.venue_address) || null,
      venue_postcode: venueTbc ? null : postcode || null,
      visibility: values.visibility,
      capacity: values.capacity,
      price_pence: poundsToPence(values.price_pounds),
      bespoke_details: values.bespoke_details || null,
      ticket_types: values.ticket_types.map((tt, i) => ({
        name: tt.name,
        price_pence: poundsToPence(tt.price_pounds),
        seats_consumed: tt.seats_consumed,
        max_available: tt.max_available,
        sort_order: tt.sort_order ?? i,
        session_label: tt.session_label.trim() || null,
        vat_rate: tt.vat_rate,
      })),
      out_of_territory_confirmed: values.out_of_territory_confirmed,
      // Only include private_client_id when set; send null to clear any
      // previously linked client (relevant if the form is reused/reset).
      private_client_id: values.private_client_id ?? null,
      display_name: isPrivate ? values.display_name.trim() || null : null,
      venue_tbc: venueTbc,
    };

    // De-duplicated date list: the primary date plus any additional dates.
    const dates = [...new Set([values.event_date, ...values.additional_dates.map((d) => d.value)])];

    const results: Array<DateResult & { instanceId?: string }> = [];
    for (const date of dates) {
      try {
        const result = await createMutation.mutateAsync({ ...basePayload, event_date: date });
        results.push({ date, ok: true, instanceId: result.instance.id });
      } catch (err) {
        if (err instanceof TerritoryConflictError && !results.some((r) => r.ok)) {
          // Server confirmed a territory conflict before anything was created.
          // Surface the warning on the review step so the franchisee can tick
          // confirm and resubmit all dates.
          setServerWarning(err.conflict.warning);
          form.setValue('out_of_territory_confirmed', false);
          toast.warning('Territory conflict. Please review and confirm below.');
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to create course';
        results.push({ date, ok: false, error: message });
      }
    }

    const failures = results.filter((r) => !r.ok);

    if (failures.length === 0) {
      if (results.length === 1) {
        toast.success('Course scheduled successfully');
        void navigate(`/franchisee/courses/${results[0].instanceId}`);
      } else {
        toast.success(`${results.length} courses scheduled successfully`);
        void navigate('/franchisee/courses');
      }
      return;
    }

    // Partial (or total) failure: show the per-date summary and keep ONLY the
    // failed dates in the form so a re-save doesn't duplicate the successes.
    setMultiResults(results.map(({ date, ok, error }) => ({ date, ok, error })));
    form.setValue('event_date', failures[0].date);
    form.setValue(
      'additional_dates',
      failures.slice(1).map((f) => ({ value: f.date })),
    );
    const created = results.length - failures.length;
    toast.error(
      created > 0
        ? `${created} of ${results.length} courses created — ${failures.length} failed`
        : 'Failed to create course',
    );
  });

  const selectedTemplate = templates.find((t) => t.id === form.watch('template_id'));
  const isPending = createMutation.isPending || form.formState.isSubmitting;

  // Review "Save" button: gate on confirm when a server warning is present.
  const saveBlocked =
    step === 4 && serverWarning !== 'none' && !form.watch('out_of_territory_confirmed');

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12">
      <PageHeader
        title="Schedule a course"
        breadcrumb="Courses"
        subtitle={selectedTemplate ? selectedTemplate.name : undefined}
      />

      <StepIndicator current={step} />

      <Card>
        <CardContent className="pt-6">
          {/* Step content */}
          {step === 0 && (
            <Step1Template
              templates={templates}
              isLoading={templatesLoading}
              selectedId={form.watch('template_id')}
              onSelect={handleTemplateSelect}
            />
          )}
          {step === 1 && <Step2Visibility form={form} />}
          {step === 2 && (
            <Step3Venue
              form={form}
              territoryPreview={territoryPreview}
              onPostcodeBlur={() => {
                void handlePostcodeBlur();
              }}
            />
          )}
          {step === 3 && <Step4Pricing form={form} />}
          {step === 4 && (
            <Step5Review
              form={form}
              template={selectedTemplate}
              serverWarning={serverWarning}
              multiResults={multiResults}
              onConfirmChange={(val) =>
                form.setValue('out_of_territory_confirmed', val, { shouldDirty: true })
              }
            />
          )}

          {/* Template validation error (step 0) */}
          {step === 0 && form.formState.errors.template_id ? (
            <p className="text-daisy-orange mt-3 text-xs">
              {form.formState.errors.template_id.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="mt-6 flex justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={step === 0 ? () => void navigate('/franchisee/courses') : handleBack}
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>

        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            onClick={() => {
              void handleNext();
            }}
            disabled={step === 0 && !form.watch('template_id')}
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={isPending || saveBlocked}
          >
            {isPending ? 'Saving...' : 'Save course'}
          </Button>
        )}
      </div>
    </div>
  );
}
