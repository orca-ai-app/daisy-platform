import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { BookOpen, Pencil } from 'lucide-react';
import { PageHeader, EmptyState, StatusPill } from '@/components/daisy';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { formatPence } from '@/lib/format';
import { useActivityLog, formatActivityDescription } from '@/lib/queries/activities';
import { useCourseTemplates, useUpdateTemplate, type CourseTemplate } from './queries';

const editSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  default_price_pounds: z
    .number({ invalid_type_error: 'Price must be a number' })
    .nonnegative('Price cannot be negative'),
  default_capacity: z
    .number({ invalid_type_error: 'Capacity must be a number' })
    .int('Capacity must be a whole number')
    .positive('Capacity must be greater than zero'),
});

type EditFormValues = z.infer<typeof editSchema>;

export default function TemplatesPage() {
  const templates = useCourseTemplates();
  const updateTemplate = useUpdateTemplate();
  const activity = useActivityLog({
    entityType: 'course_template',
    limit: 10,
  });
  const [editing, setEditing] = useState<CourseTemplate | null>(null);

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
          subtitle="The six predefined courses Daisy offers. Edits propagate to every new instance."
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
            title="Templates not loaded"
            body="The six seed templates should be present. Contact support if this persists."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {templates.data.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onEdit={() => setEditing(template)}
                onToggleActive={() => void handleToggleActive(template)}
                disabled={updateTemplate.isPending}
              />
            ))}
          </div>
        )}

        <section className="mt-12">
          <h2 className="font-display text-daisy-ink text-xl font-bold">
            Recent template activity
          </h2>
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

      {editing ? (
        <EditTemplateDialog template={editing} open onClose={() => setEditing(null)} />
      ) : null}
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
            <Field label="Certification">{template.certification ?? '—'}</Field>
            {template.age_range ? <Field label="Age range">{template.age_range}</Field> : null}
          </dl>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-daisy-muted text-xs font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="text-daisy-ink text-sm">{children}</dd>
    </div>
  );
}

interface EditTemplateDialogProps {
  template: CourseTemplate;
  open: boolean;
  onClose: () => void;
}

function EditTemplateDialog({ template, open, onClose }: EditTemplateDialogProps) {
  const updateTemplate = useUpdateTemplate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: template.name,
      description: template.description ?? '',
      default_price_pounds: template.default_price_pence / 100,
      default_capacity: template.default_capacity,
    },
  });

  const onSubmit = async (values: EditFormValues) => {
    try {
      await updateTemplate.mutateAsync({
        id: template.id,
        fields: {
          name: values.name.trim(),
          description: values.description?.trim() ?? null,
          default_price_pence: Math.round(values.default_price_pounds * 100),
          default_capacity: values.default_capacity,
        },
      });
      toast.success(`${values.name} saved`);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit template</DialogTitle>
          <DialogDescription>
            Changes are audit-logged and apply to future course instances.
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save changes'}
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
