import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { PageHeader } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCreateFranchisee,
  useNextFranchiseeNumber,
  type CreateFranchiseeResult,
} from './queries';

const formSchema = z.object({
  number: z.string().regex(/^\d{4}$/, 'Number must be exactly 4 digits (e.g. 0042)'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z.string().trim().optional(),
  fee_tier: z.union([z.literal(100), z.literal(120)]),
  billing_date: z
    .number({ invalid_type_error: 'Billing date is required' })
    .int('Billing date must be a whole number')
    .min(1, 'Billing date must be 1 or later')
    .max(28, 'Billing date must be 28 or earlier'),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewFranchiseePage() {
  const navigate = useNavigate();
  const create = useCreateFranchisee();
  const nextNumber = useNextFranchiseeNumber();
  const [created, setCreated] = useState<CreateFranchiseeResult | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      number: '',
      name: '',
      email: '',
      phone: '',
      fee_tier: 120,
      billing_date: 28,
      notes: '',
    },
  });

  // When the next-number query resolves, pre-fill the form. Only set the
  // value when the field is empty so we don't clobber user typing if
  // they raced the network.
  useEffect(() => {
    if (nextNumber.data && !watch('number')) {
      setValue('number', nextNumber.data, { shouldDirty: false });
    }
    // We intentionally only run when the suggestion arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextNumber.data]);

  const feeTier = watch('fee_tier');

  const onSubmit = async (values: FormValues) => {
    try {
      const result = await create.mutateAsync({
        number: values.number,
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        fee_tier: values.fee_tier as 100 | 120,
        billing_date: values.billing_date,
        phone: values.phone && values.phone.trim().length > 0 ? values.phone.trim() : null,
        notes: values.notes && values.notes.trim().length > 0 ? values.notes.trim() : null,
      });
      toast.success(`${result.franchisee.name} onboarded`);
      setCreated(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Create failed';
      toast.error(message);
    }
  };

  if (created) {
    return (
      <SuccessCard
        result={created}
        onDone={() => navigate(`/hq/franchisees/${created.franchisee.id}`)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/hq/franchisees"
        className="text-daisy-primary mb-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
      >
        ← Back to franchisees
      </Link>

      <PageHeader
        title="New franchisee"
        subtitle="Onboard a franchisee. Creates their auth account and returns a magic-link sign-in URL you can send via WhatsApp or email."
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            All fields except phone and notes are required. Number is suggested from the next free
            slot but you can override it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              void handleSubmit(onSubmit)(e);
            }}
            className="flex flex-col gap-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="franchisee-number">Number</Label>
                <Input
                  id="franchisee-number"
                  placeholder="0042"
                  inputMode="numeric"
                  maxLength={4}
                  {...register('number')}
                />
                <p className="text-daisy-muted text-xs">
                  4-digit zero-padded. Suggested:{' '}
                  <span className="font-mono">{nextNumber.data ?? '----'}</span>
                </p>
                {errors.number ? (
                  <p className="text-daisy-orange text-xs">{errors.number.message}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="franchisee-name">Name</Label>
                <Input id="franchisee-name" placeholder="Sarah Hughes" {...register('name')} />
                {errors.name ? (
                  <p className="text-daisy-orange text-xs">{errors.name.message}</p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="franchisee-email">Email</Label>
                <Input
                  id="franchisee-email"
                  type="email"
                  placeholder="sarah@example.com"
                  {...register('email')}
                />
                {errors.email ? (
                  <p className="text-daisy-orange text-xs">{errors.email.message}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="franchisee-phone">Phone (optional)</Label>
                <Input
                  id="franchisee-phone"
                  type="tel"
                  placeholder="07700 900000"
                  {...register('phone')}
                />
                {errors.phone ? (
                  <p className="text-daisy-orange text-xs">{errors.phone.message}</p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Fee tier</Label>
                <div className="flex gap-2">
                  <FeeTierOption
                    label="£100 / month"
                    sublabel="Legacy tier"
                    selected={feeTier === 100}
                    onSelect={() => setValue('fee_tier', 100, { shouldDirty: true })}
                  />
                  <FeeTierOption
                    label="£120 / month"
                    sublabel="Standard tier"
                    selected={feeTier === 120}
                    onSelect={() => setValue('fee_tier', 120, { shouldDirty: true })}
                  />
                </div>
                {errors.fee_tier ? (
                  <p className="text-daisy-orange text-xs">{errors.fee_tier.message}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="franchisee-billing-date">Billing date</Label>
                <Input
                  id="franchisee-billing-date"
                  type="number"
                  min="1"
                  max="28"
                  step="1"
                  {...register('billing_date', { valueAsNumber: true })}
                />
                <p className="text-daisy-muted text-xs">Direct debit collection day (1 - 28).</p>
                {errors.billing_date ? (
                  <p className="text-daisy-orange text-xs">{errors.billing_date.message}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="franchisee-notes">Notes (optional)</Label>
              <textarea
                id="franchisee-notes"
                rows={3}
                placeholder="Anything HQ should remember about this franchisee."
                className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
                {...register('notes')}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button asChild type="button" variant="outline">
                <Link to="/hq/franchisees">Cancel</Link>
              </Button>
              <Button type="submit" disabled={isSubmitting || create.isPending}>
                {isSubmitting || create.isPending ? 'Creating...' : 'Create franchisee'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

interface SuccessCardProps {
  result: CreateFranchiseeResult;
  onDone: () => void;
}

function SuccessCard({ result, onDone }: SuccessCardProps) {
  const [copied, setCopied] = useState(false);
  const link = result.magic_link;

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Magic link copied');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Franchisee created"
        subtitle={`#${result.franchisee.number.padStart(4, '0')} - ${result.franchisee.name}`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Send the sign-in link</CardTitle>
          <CardDescription>
            {link
              ? `Send this magic link to ${result.franchisee.name} so they can complete sign-in. The link expires in roughly one hour.`
              : 'The franchisee was created but the magic link could not be generated automatically. Use the password-reset flow on the login page to send them a sign-in email.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {link ? (
            <div className="flex items-center gap-2">
              <Input readOnly value={link} className="font-mono text-xs" />
              <Button type="button" variant="outline" onClick={() => void handleCopy()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : null}

          <div className="text-daisy-muted text-sm">
            Email: <span className="text-daisy-ink font-semibold">{result.franchisee.email}</span>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={onDone}>Done, view franchisee</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface FeeTierOptionProps {
  label: string;
  sublabel: string;
  selected: boolean;
  onSelect: () => void;
}

function FeeTierOption({ label, sublabel, selected, onSelect }: FeeTierOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'flex flex-1 flex-col items-start gap-0.5 rounded-[8px] border-2 px-3 py-2 text-left transition-colors',
        selected
          ? 'border-daisy-primary bg-daisy-primary-soft text-daisy-primary-deep'
          : 'border-daisy-line hover:border-daisy-primary bg-white',
      ].join(' ')}
    >
      <span className="text-sm font-bold">{label}</span>
      <span className="text-daisy-muted text-xs">{sublabel}</span>
    </button>
  );
}
