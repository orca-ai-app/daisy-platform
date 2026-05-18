import { useState } from 'react';
import { Link } from 'react-router';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { BookOpen, Pencil, Plus, X } from 'lucide-react';
import { PageHeader, EmptyState, StatusPill } from '@/components/daisy';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { formatPence } from '@/lib/format';
import { useActivityLog, formatActivityDescription } from '@/lib/queries/activities';
import {
  useCourseTemplates,
  useUpdateTemplate,
  useCreateTemplate,
  type CourseTemplate,
  type TemplateTicketType,
} from './queries';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ticketTypeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  seats_consumed: z
    .number({ invalid_type_error: 'Seats must be a number' })
    .int('Seats must be a whole number')
    .min(1, 'Seats must be at least 1'),
  price_modifier_pence: z
    .number({ invalid_type_error: 'Modifier must be a number' })
    .int('Modifier must be a whole number')
    .min(0, 'Modifier cannot be negative'),
});

const editSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(SLUG_REGEX, 'Slug must be lowercase, hyphen-separated'),
  description: z.string().optional(),
  default_price_pounds: z
    .number({ invalid_type_error: 'Price must be a number' })
    .nonnegative('Price cannot be negative'),
  default_capacity: z
    .number({ invalid_type_error: 'Capacity must be a number' })
    .int('Capacity must be a whole number')
    .positive('Capacity must be greater than zero'),
  duration_hours: z
    .number({ invalid_type_error: 'Duration must be a number' })
    .positive('Duration must be greater than zero'),
  certification: z.enum(['yes', 'no', 'if_requested']).default('no'),
  default_ticket_types: z.array(ticketTypeSchema).min(1, 'At least one ticket type is required'),
});

type EditFormValues = z.infer<typeof editSchema>;

type DialogMode = { type: 'edit'; template: CourseTemplate } | { type: 'create' };

const DEFAULT_TICKET_TYPES: TemplateTicketType[] = [
  { name: 'Single', seats_consumed: 1, price_modifier_pence: 0 },
];

export default function TemplatesPage() {
  const templates = useCourseTemplates();
  const updateTemplate = useUpdateTemplate();
  const activity = useActivityLog({
    entityType: 'course_template',
    limit: 10,
  });
  const [mode, setMode] = useState<DialogMode | null>(null);

  const handleToggleActive = async (template: CourseTemplate) => {
    try {
      await updateTemplate.mutateAsync({
        id: template.id,
        fields: { is_active: !template.is_active },
      });
      toast.success(`${template.name} ${!template.is_active ? 'activated' : 'deactivated'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed';
      toast.error(message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Course templates"
        subtitle="The predefined courses Daisy offers. Edits propagate to every new instance."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setMode({ type: 'create' })}>
              <Plus className="h-4 w-4" />
              New course template
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/hq/courses/instances">View course instances →</Link>
            </Button>
          </div>
        }
      />

      {templates.isLoading ? (
        <p className="text-daisy-muted text-sm">Loading templates...</p>
      ) : templates.isError ? (
        <p className="text-daisy-orange text-sm">
          Failed to load templates: {templates.error.message}
        </p>
      ) : !templates.data || templates.data.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title="No course templates yet"
          body="Daisy's default templates haven't been loaded for this account. Use New course template to add one, or contact support if this looks wrong."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {templates.data.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onEdit={() => setMode({ type: 'edit', template })}
              onToggleActive={() => void handleToggleActive(template)}
              disabled={updateTemplate.isPending}
            />
          ))}
        </div>
      )}

      <section className="mt-12">
        <h2 className="font-display text-daisy-ink text-xl font-bold">Recent template activity</h2>
        <p className="text-daisy-muted mb-3 text-sm">Last ten changes across all templates.</p>
        {activity.isLoading ? (
          <p className="text-daisy-muted text-sm">Loading activity...</p>
        ) : activity.isError ? (
          <p className="text-daisy-orange text-sm">
            Failed to load activity: {activity.error.message}
          </p>
        ) : (
          <ActivitySidebar pages={activity.data?.pages} />
        )}
      </section>

      {mode ? <TemplateDialog mode={mode} open onClose={() => setMode(null)} /> : null}
    </div>
  );
}

interface TemplateCardProps {
  template: CourseTemplate;
  onEdit: () => void;
  onToggleActive: () => void;
  disabled?: boolean;
}

function TemplateCard({ template, onEdit, onToggleActive, disabled }: TemplateCardProps) {
  const ticketTypes = template.default_ticket_types ?? [];
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-daisy-ink text-xl font-bold">{template.name}</h3>
            <StatusPill variant={template.is_active ? 'active' : 'paused'}>
              {template.is_active ? 'Active' : 'Inactive'}
            </StatusPill>
          </div>
          <p className="text-daisy-muted mt-1 text-xs tracking-wide uppercase">{template.slug}</p>
          {template.description ? (
            <p className="text-daisy-ink-soft mt-3 text-sm">{template.description}</p>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Field label="Duration">{template.duration_hours} hrs</Field>
            <Field label="Default price">{formatPence(template.default_price_pence)}</Field>
            <Field label="Default capacity">{template.default_capacity}</Field>
            <Field label="Certification">{formatCertification(template.certification)}</Field>
            {template.age_range ? <Field label="Age range">{template.age_range}</Field> : null}
          </dl>

          {ticketTypes.length > 0 ? (
            <div className="mt-4">
              <p className="text-daisy-muted text-xs font-semibold tracking-wide uppercase">
                Ticket types
              </p>
              <ul className="text-daisy-ink mt-1 flex flex-wrap gap-2 text-xs">
                {ticketTypes.map((tt, idx) => (
                  <li
                    key={`${tt.name}-${idx}`}
                    className="border-daisy-line-soft rounded-full border px-2 py-0.5"
                  >
                    {tt.name} ({tt.seats_consumed} seat{tt.seats_consumed === 1 ? '' : 's'}
                    {tt.price_modifier_pence > 0
                      ? `, +${formatPence(tt.price_modifier_pence)}`
                      : ''}
                    )
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-daisy-muted mt-4 text-xs">
            Franchisees can amend templates for themselves in their portal (coming with M2).
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <Button variant="outline" size="sm" onClick={onEdit} disabled={disabled}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button
            variant={template.is_active ? 'ghost' : 'default'}
            size="sm"
            onClick={onToggleActive}
            disabled={disabled}
          >
            {template.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function formatCertification(value: CourseTemplate['certification']): string {
  switch (value) {
    case 'yes':
      return 'Yes';
    case 'no':
      return 'No';
    case 'if_requested':
      return 'If requested';
    default:
      return '-';
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-daisy-muted text-xs font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="text-daisy-ink text-sm">{children}</dd>
    </div>
  );
}

interface TemplateDialogProps {
  mode: DialogMode;
  open: boolean;
  onClose: () => void;
}

function TemplateDialog({ mode, open, onClose }: TemplateDialogProps) {
  const updateTemplate = useUpdateTemplate();
  const createTemplate = useCreateTemplate();
  const isCreate = mode.type === 'create';

  const defaultValues: EditFormValues = isCreate
    ? {
        name: '',
        slug: '',
        description: '',
        default_price_pounds: 0,
        default_capacity: 1,
        duration_hours: 1,
        certification: 'no',
        default_ticket_types: DEFAULT_TICKET_TYPES,
      }
    : {
        name: mode.template.name,
        slug: mode.template.slug,
        description: mode.template.description ?? '',
        default_price_pounds: mode.template.default_price_pence / 100,
        default_capacity: mode.template.default_capacity,
        duration_hours: Number(mode.template.duration_hours),
        certification: (mode.template.certification ?? 'no') as EditFormValues['certification'],
        default_ticket_types:
          mode.template.default_ticket_types?.length > 0
            ? mode.template.default_ticket_types
            : DEFAULT_TICKET_TYPES,
      };

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues,
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'default_ticket_types',
  });

  const onSubmit = async (values: EditFormValues) => {
    const description = values.description?.trim() ?? '';
    const ticketTypes: TemplateTicketType[] = values.default_ticket_types.map((tt) => ({
      name: tt.name.trim(),
      seats_consumed: tt.seats_consumed,
      price_modifier_pence: tt.price_modifier_pence,
    }));

    try {
      if (mode.type === 'create') {
        await createTemplate.mutateAsync({
          name: values.name.trim(),
          slug: values.slug.trim(),
          duration_hours: values.duration_hours,
          default_price_pence: Math.round(values.default_price_pounds * 100),
          default_capacity: values.default_capacity,
          certification: values.certification,
          description: description.length > 0 ? description : null,
          default_ticket_types: ticketTypes,
          is_active: true,
        });
        toast.success(`${values.name.trim()} created`);
      } else {
        await updateTemplate.mutateAsync({
          id: mode.template.id,
          fields: {
            name: values.name.trim(),
            description: description.length > 0 ? description : null,
            default_price_pence: Math.round(values.default_price_pounds * 100),
            default_capacity: values.default_capacity,
            certification: values.certification,
            default_ticket_types: ticketTypes,
          },
        });
        toast.success(`${values.name.trim()} saved`);
      }
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : isCreate ? 'Create failed' : 'Save failed';
      toast.error(message);
    }
  };

  const ticketTypeErrors = errors.default_ticket_types;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCreate ? 'New course template' : 'Edit template'}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? 'Templates are network-wide. Franchisees can amend them for themselves with M2.'
              : 'Changes are audit-logged and apply to future course instances.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" {...register('name')} />
            {errors.name ? (
              <p className="text-daisy-orange text-xs">{errors.name.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-slug">Slug</Label>
            <Input
              id="template-slug"
              placeholder="e.g. paediatric-first-aid"
              readOnly={!isCreate}
              disabled={!isCreate}
              {...register('slug')}
            />
            {errors.slug ? (
              <p className="text-daisy-orange text-xs">{errors.slug.message}</p>
            ) : (
              <p className="text-daisy-muted text-xs">
                {isCreate
                  ? 'Lowercase, hyphen-separated. Used in URLs and exports.'
                  : 'Slug is fixed once a template is created.'}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-description">Description</Label>
            <textarea
              id="template-description"
              rows={3}
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
              {...register('description')}
            />
            {errors.description ? (
              <p className="text-daisy-orange text-xs">{errors.description.message}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-duration">Duration (hours)</Label>
              <Input
                id="template-duration"
                type="number"
                step="0.25"
                min="0.25"
                {...register('duration_hours', { valueAsNumber: true })}
              />
              {errors.duration_hours ? (
                <p className="text-daisy-orange text-xs">{errors.duration_hours.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-price">Default price (£)</Label>
              <Input
                id="template-price"
                type="number"
                step="0.01"
                min="0"
                {...register('default_price_pounds', { valueAsNumber: true })}
              />
              {errors.default_price_pounds ? (
                <p className="text-daisy-orange text-xs">{errors.default_price_pounds.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-capacity">Default capacity</Label>
              <Input
                id="template-capacity"
                type="number"
                step="1"
                min="1"
                {...register('default_capacity', { valueAsNumber: true })}
              />
              {errors.default_capacity ? (
                <p className="text-daisy-orange text-xs">{errors.default_capacity.message}</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-certification">Certification</Label>
            <Controller
              control={control}
              name="certification"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="template-certification">
                    <SelectValue placeholder="Select certification" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                    <SelectItem value="if_requested">If requested</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.certification ? (
              <p className="text-daisy-orange text-xs">{errors.certification.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Ticket types</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ name: '', seats_consumed: 1, price_modifier_pence: 0 })}
              >
                <Plus className="h-4 w-4" />
                Add ticket type
              </Button>
            </div>
            <p className="text-daisy-muted text-xs">
              At least one row is required. Use the modifier to add a surcharge (in pence) on top of
              the default price for variants like &ldquo;Double&rdquo;.
            </p>

            <div className="flex flex-col gap-2">
              {fields.map((field, index) => {
                const rowErrors = Array.isArray(ticketTypeErrors)
                  ? ticketTypeErrors[index]
                  : undefined;
                return (
                  <div
                    key={field.id}
                    className="border-daisy-line-soft grid grid-cols-1 gap-2 rounded-[8px] border p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
                  >
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`tt-name-${index}`} className="text-xs">
                        Name
                      </Label>
                      <Input
                        id={`tt-name-${index}`}
                        placeholder="Single"
                        {...register(`default_ticket_types.${index}.name` as const)}
                      />
                      {rowErrors?.name ? (
                        <p className="text-daisy-orange text-xs">{rowErrors.name.message}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`tt-seats-${index}`} className="text-xs">
                        Seats consumed
                      </Label>
                      <Input
                        id={`tt-seats-${index}`}
                        type="number"
                        min="1"
                        step="1"
                        {...register(`default_ticket_types.${index}.seats_consumed` as const, {
                          valueAsNumber: true,
                        })}
                      />
                      {rowErrors?.seats_consumed ? (
                        <p className="text-daisy-orange text-xs">
                          {rowErrors.seats_consumed.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`tt-modifier-${index}`} className="text-xs">
                        Price modifier (pence)
                      </Label>
                      <Input
                        id={`tt-modifier-${index}`}
                        type="number"
                        min="0"
                        step="1"
                        {...register(
                          `default_ticket_types.${index}.price_modifier_pence` as const,
                          { valueAsNumber: true },
                        )}
                      />
                      {rowErrors?.price_modifier_pence ? (
                        <p className="text-daisy-orange text-xs">
                          {rowErrors.price_modifier_pence.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex sm:justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                        disabled={fields.length <= 1}
                        aria-label={`Remove ticket type ${index + 1}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {ticketTypeErrors && !Array.isArray(ticketTypeErrors) && ticketTypeErrors.message ? (
              <p className="text-daisy-orange text-xs">{ticketTypeErrors.message}</p>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? isCreate
                  ? 'Creating...'
                  : 'Saving...'
                : isCreate
                  ? 'Create template'
                  : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ActivitySidebar({
  pages,
}: {
  pages?: { rows: import('@/lib/queries/activities').ActivityRow[] }[];
}) {
  const rows = pages?.flatMap((p) => p.rows) ?? [];
  if (rows.length === 0) {
    return <p className="text-daisy-muted text-sm">No template changes logged yet.</p>;
  }
  return (
    <ol className="border-daisy-line-soft flex flex-col gap-2 border-l-2 pl-4">
      {rows.map((row) => (
        <li key={row.id} className="text-sm">
          <span className="text-daisy-ink font-semibold">{formatActivityDescription(row)}</span>
          <span className="text-daisy-muted ml-2 text-xs">
            {new Date(row.created_at).toLocaleString('en-GB', {
              timeZone: 'Europe/London',
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </li>
      ))}
    </ol>
  );
}
