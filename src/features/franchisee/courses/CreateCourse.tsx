/**
 * CreateCourse — Wave 7A.
 *
 * 5-step RHF+Zod wizard at /franchisee/courses/new.
 *
 * Step 1 — Template: pick from active da_course_templates (card grid).
 * Step 2 — Venue & Date: event_date, start/end time, venue fields, postcode.
 *           On postcode blur, calls a lightweight geocode preview to surface
 *           <TerritoryWarning> early. Requires the confirm tick when a warning
 *           shows before the user can proceed to Step 3.
 * Step 3 — Pricing & Capacity: price_pence, capacity, ticket types (editable
 *           rows seeded from template default_ticket_types).
 * Step 4 — Visibility: Public / Private. Private shows bespoke_details textarea
 *           and a private_client_id dropdown stub (Wave 9C back-fills this).
 * Step 5 — Review & Save: summary, then POST to create-course-instance.
 *           On 409 territory conflict: surfaces TerritoryWarning + requires
 *           confirm before allowing re-submit. On 201: routes to
 *           /franchisee/courses/:id.
 *
 * Money is integer pence throughout (no floats, no division until display).
 * Dates are 'YYYY-MM-DD' wall-clock strings (NOT reconstructed via Date).
 */

import { useState, useCallback } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router';
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
import { formatPence } from '@/lib/format';
import { cn } from '@/lib/utils';

import {
  useCourseTemplates,
  useCreateCourseInstance,
  TerritoryConflictError,
} from './createCourseQueries';
import type { CourseTemplateOption, OutOfTerritoryWarning, Visibility } from './types';
import { supabase } from '@/lib/supabase';
import { PrivateClientSelect } from '@/features/franchisee/clients/PrivateClientSelect';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ticketTypeSchema = z.object({
  name: z.string().trim().min(1, 'Name required'),
  price_pence: z
    .number({ invalid_type_error: 'Price required' })
    .int('Price must be whole pence')
    .min(0, 'Price cannot be negative'),
  seats_consumed: z
    .number({ invalid_type_error: 'Seats required' })
    .int()
    .min(1, 'At least 1 seat'),
  max_available: z.number({ invalid_type_error: 'Must be a number' }).int().min(1).nullable(),
  sort_order: z.number().int(),
});

const schema = z.object({
  template_id: z.string().uuid('Select a template'),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date required'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Start time required'),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, 'End time required'),
  venue_name: z.string().trim(),
  venue_address: z.string().trim(),
  venue_postcode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, 'Enter a valid UK postcode'),
  visibility: z.enum(['public', 'private']),
  capacity: z
    .number({ invalid_type_error: 'Capacity required' })
    .int()
    .min(1, 'Capacity must be at least 1'),
  price_pence: z
    .number({ invalid_type_error: 'Price required' })
    .int('Price must be whole pence')
    .min(0, 'Price cannot be negative'),
  bespoke_details: z.string(),
  ticket_types: z.array(ticketTypeSchema).min(1, 'At least one ticket type required'),
  out_of_territory_confirmed: z.boolean(),
  /** Optional: private client selected in Step 4. Only relevant for private courses. */
  private_client_id: z.string().uuid().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Step indicators
// ---------------------------------------------------------------------------

const STEPS = [
  { label: 'Template' },
  { label: 'Venue & Date' },
  { label: 'Pricing' },
  { label: 'Visibility' },
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
                {formatPence(t.default_price_pence)} default
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Postcode territory preview hook (Step 2)
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
// Step 2 — Venue & Date
// ---------------------------------------------------------------------------

function Step2Venue({
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
    watch,
    setValue,
    formState: { errors },
  } = form;

  const confirmed = watch('out_of_territory_confirmed');
  const previewWarning: OutOfTerritoryWarning =
    territoryPreview.status === 'done' ? territoryPreview.warning : 'none';

  return (
    <div className="flex flex-col gap-5">
      {/* Date */}
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

      {/* Venue */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="venue-name">Venue name</Label>
        <Input
          id="venue-name"
          type="text"
          placeholder="e.g. Sutton Community Centre"
          {...register('venue_name')}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="venue-address">Address</Label>
        <Input
          id="venue-address"
          type="text"
          placeholder="e.g. 12 High Street, Sutton"
          {...register('venue_address')}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="venue-postcode">Postcode</Label>
        <Input
          id="venue-postcode"
          type="text"
          placeholder="e.g. SM1 1AB"
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
// Step 3 — Pricing & Capacity
// ---------------------------------------------------------------------------

function Step3Pricing({ form }: { form: ReturnType<typeof useForm<FormValues>> }) {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = form;

  const { fields, append, remove } = useFieldArray({ control, name: 'ticket_types' });
  const basePrice = watch('price_pence');

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price-pence">Base price (pence)</Label>
          <Input
            id="price-pence"
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 6500 = £65.00"
            {...register('price_pence', { valueAsNumber: true })}
          />
          {typeof basePrice === 'number' && Number.isFinite(basePrice) ? (
            <p className="text-daisy-muted text-xs">{formatPence(basePrice)}</p>
          ) : null}
          {errors.price_pence ? (
            <p className="text-daisy-orange text-xs">{errors.price_pence.message}</p>
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
                price_pence: basePrice ?? 0,
                seats_consumed: 1,
                max_available: null,
                sort_order: fields.length,
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
                    Price (pence)
                  </Label>
                  <Input
                    id={`tt-price-${i}`}
                    type="number"
                    min="0"
                    step="1"
                    {...register(`ticket_types.${i}.price_pence`, { valueAsNumber: true })}
                  />
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Visibility
// ---------------------------------------------------------------------------

function Step4Visibility({ form }: { form: ReturnType<typeof useForm<FormValues>> }) {
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
                // Clear private client when switching back to public.
                if (v === 'public') {
                  setValue('private_client_id', null, { shouldDirty: true });
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
// Step 5 — Review
// ---------------------------------------------------------------------------

function Step5Review({
  form,
  template,
  serverWarning,
  onConfirmChange,
}: {
  form: ReturnType<typeof useForm<FormValues>>;
  template: CourseTemplateOption | undefined;
  serverWarning: OutOfTerritoryWarning;
  onConfirmChange: (val: boolean) => void;
}) {
  const values = form.getValues();

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-daisy-muted font-semibold">Template</dt>
          <dd className="text-daisy-ink">{template?.name ?? values.template_id}</dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Date</dt>
          <dd className="text-daisy-ink">{values.event_date}</dd>
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
            {values.venue_name || '—'}, {values.venue_postcode}
          </dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Capacity</dt>
          <dd className="text-daisy-ink">{values.capacity}</dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Base price</dt>
          <dd className="text-daisy-ink">{formatPence(values.price_pence)}</dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Visibility</dt>
          <dd className="text-daisy-ink capitalize">{values.visibility}</dd>
        </div>
        <div>
          <dt className="text-daisy-muted font-semibold">Ticket types</dt>
          <dd className="text-daisy-ink">
            {values.ticket_types
              .map((tt) => `${tt.name} (${formatPence(tt.price_pence)})`)
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
  ['event_date', 'start_time', 'end_time', 'venue_postcode'],
  ['price_pence', 'capacity', 'ticket_types'],
  ['visibility'],
  [],
];

export default function CreateCourse() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [territoryPreview, setTerritoryPreview] = useState<PreviewState>({ status: 'idle' });
  const [serverWarning, setServerWarning] = useState<OutOfTerritoryWarning>('none');
  const [franchiseeId, setFranchiseeId] = useState<string | null>(null);

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
    defaultValues: {
      template_id: '',
      event_date: '',
      start_time: '',
      end_time: '',
      venue_name: '',
      venue_address: '',
      venue_postcode: '',
      visibility: 'public',
      capacity: 12,
      price_pence: 0,
      bespoke_details: '',
      ticket_types: [
        { name: 'Single', price_pence: 0, seats_consumed: 1, max_available: null, sort_order: 0 },
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
        form.setValue('price_pence', t.default_price_pence);
        form.setValue('capacity', t.default_capacity);
        const seeded =
          t.default_ticket_types && t.default_ticket_types.length > 0
            ? t.default_ticket_types.map((dt, i) => ({
                name: dt.name,
                price_pence: t.default_price_pence + dt.price_modifier_pence,
                seats_consumed: dt.seats_consumed,
                max_available: null as number | null,
                sort_order: i,
              }))
            : [
                {
                  name: 'Single',
                  price_pence: t.default_price_pence,
                  seats_consumed: 1,
                  max_available: null as number | null,
                  sort_order: 0,
                },
              ];
        form.setValue('ticket_types', seeded);
      }
    },
    [templates, form],
  );

  // Territory preview on postcode blur
  const handlePostcodeBlur = useCallback(async () => {
    const postcode = form.getValues('venue_postcode');
    const valid = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode);
    if (!valid || !franchiseeId) return;

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

    // Step 2: if a territory warning is showing, require confirmation before advancing.
    if (step === 1) {
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

  // Final submit
  const handleSubmit = form.handleSubmit(async (values: FormValues) => {
    try {
      const result = await createMutation.mutateAsync({
        template_id: values.template_id,
        event_date: values.event_date,
        start_time: values.start_time,
        end_time: values.end_time,
        venue_name: values.venue_name || null,
        venue_address: values.venue_address || null,
        venue_postcode: values.venue_postcode,
        visibility: values.visibility,
        capacity: values.capacity,
        price_pence: values.price_pence,
        bespoke_details: values.bespoke_details || null,
        ticket_types: values.ticket_types,
        out_of_territory_confirmed: values.out_of_territory_confirmed,
        // Only include private_client_id when set; send null to clear any
        // previously linked client (relevant if the form is reused/reset).
        private_client_id: values.private_client_id ?? null,
      });

      toast.success('Course scheduled successfully');
      void navigate(`/franchisee/courses/${result.instance.id}`);
    } catch (err) {
      if (err instanceof TerritoryConflictError) {
        // Server confirmed a territory conflict. Surface the warning on the
        // review step so the franchisee can tick confirm and resubmit.
        setServerWarning(err.conflict.warning);
        form.setValue('out_of_territory_confirmed', false);
        toast.warning('Territory conflict. Please review and confirm below.');
      } else {
        const message = err instanceof Error ? err.message : 'Failed to create course';
        toast.error(message);
      }
    }
  });

  const selectedTemplate = templates.find((t) => t.id === form.watch('template_id'));
  const isPending = createMutation.isPending || form.formState.isSubmitting;

  // Step 5 "Save" button: gate on confirm when a server warning is present.
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
          {step === 1 && (
            <Step2Venue
              form={form}
              territoryPreview={territoryPreview}
              onPostcodeBlur={() => {
                void handlePostcodeBlur();
              }}
            />
          )}
          {step === 2 && <Step3Pricing form={form} />}
          {step === 3 && <Step4Visibility form={form} />}
          {step === 4 && (
            <Step5Review
              form={form}
              template={selectedTemplate}
              serverWarning={serverWarning}
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
