import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Building2, Lock } from 'lucide-react';
import { PageHeader } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useOwnProfile, useUpdateOwnProfile } from './profileQueries';

// ---------------------------------------------------------------------------
// Schema — only name and phone are mutable on this surface.
// Email is read-only: only HQ can change it via the admin form.
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  phone: z.string().trim().optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// Profile page
// ---------------------------------------------------------------------------

export default function Profile() {
  const profile = useOwnProfile();
  const update = useUpdateOwnProfile();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      phone: '',
    },
  });

  // Populate form when profile loads (or reloads after save).
  useEffect(() => {
    if (profile.data) {
      reset({
        name: profile.data.name ?? '',
        phone: profile.data.phone ?? '',
      });
    }
  }, [profile.data, reset]);

  const onSubmit = async (values: ProfileFormValues) => {
    if (!profile.data) return;

    const trimmedName = values.name.trim();
    const trimmedPhone = values.phone?.trim() ?? '';
    const phoneValue = trimmedPhone.length > 0 ? trimmedPhone : null;

    // Compute diff — only send changed fields.
    const fields: { name?: string; phone?: string | null } = {};
    if (trimmedName !== profile.data.name) fields.name = trimmedName;
    if (phoneValue !== (profile.data.phone ?? null)) fields.phone = phoneValue;

    if (Object.keys(fields).length === 0) {
      toast.info('No changes to save');
      return;
    }

    try {
      await update.mutateAsync(fields);
      toast.success('Profile saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      toast.error(message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My profile"
        subtitle="Update your name and contact number. Email changes must go through HQ."
      />

      {profile.isLoading ? (
        <ProfileSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
          {/* Editable details */}
          <Card className="overflow-hidden">
            <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
              <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
                Business details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form
                onSubmit={(e) => {
                  void handleSubmit(onSubmit)(e);
                }}
                className="flex flex-col gap-5"
              >
                {/* Name */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-name">Name</Label>
                  <Input id="profile-name" {...register('name')} />
                  {errors.name ? (
                    <p className="text-daisy-orange text-xs">{errors.name.message}</p>
                  ) : null}
                </div>

                {/* Email — read-only, immutable from this surface */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-email" className="flex items-center gap-1.5">
                    Email
                    <Lock aria-label="Email is read-only" className="text-daisy-muted h-3 w-3" />
                  </Label>
                  <Input
                    id="profile-email"
                    type="email"
                    value={profile.data?.email ?? ''}
                    readOnly
                    disabled
                    className="cursor-not-allowed opacity-60"
                  />
                  <p className="text-daisy-muted text-xs">
                    Your sign-in email can only be changed by HQ. Contact your Daisy support team if
                    you need it updated.
                  </p>
                </div>

                {/* Phone */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-phone">Phone</Label>
                  <Input id="profile-phone" type="tel" {...register('phone')} />
                </div>

                {/* Business name — display only; HQ sets this */}
                {profile.data?.business_name ? (
                  <div className="flex flex-col gap-1.5">
                    <Label>Business name</Label>
                    <Input
                      value={profile.data.business_name}
                      readOnly
                      disabled
                      className="cursor-not-allowed opacity-60"
                    />
                    <p className="text-daisy-muted text-xs">Business name is managed by HQ.</p>
                  </div>
                ) : null}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="submit" disabled={isSubmitting || update.isPending || !isDirty}>
                    {isSubmitting || update.isPending ? 'Saving...' : 'Save changes'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Account summary — read-only metadata */}
          <Card className="overflow-hidden">
            <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
              <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
                Account summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <dl className="flex flex-col gap-4 text-sm">
                <SummaryRow label="Franchisee number" value={profile.data?.number ?? '—'} />
                <SummaryRow
                  label="Status"
                  value={
                    profile.data?.status
                      ? profile.data.status.charAt(0).toUpperCase() + profile.data.status.slice(1)
                      : '—'
                  }
                />
                <SummaryRow
                  label="Fee tier"
                  value={profile.data?.fee_tier != null ? `£${profile.data.fee_tier} / month` : '—'}
                />
                <SummaryRow
                  label="Billing date"
                  value={
                    profile.data?.billing_date != null
                      ? `${profile.data.billing_date}${ordinalSuffix(profile.data.billing_date)} of the month`
                      : '—'
                  }
                />
                <SummaryRow
                  label="VAT registered"
                  value={profile.data?.vat_registered ? 'Yes' : 'No'}
                />
              </dl>

              {profile.data ? (
                <div className="border-daisy-line mt-6 flex items-center gap-2 border-t pt-4">
                  <Building2 className="text-daisy-muted h-4 w-4 shrink-0" aria-hidden />
                  <p className="text-daisy-muted text-xs">
                    Fee tier, billing date and status are managed by HQ. Contact your support team
                    to discuss changes.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-daisy-muted text-xs font-bold tracking-[0.06em] uppercase">{label}</dt>
      <dd className="text-daisy-ink font-semibold">{value}</dd>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 p-6">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-3 p-6">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    </div>
  );
}
