import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Building2, Camera, Lock } from 'lucide-react';
import { FieldHelp, PageHeader } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabase';
import { useOwnProfile, useUpdateOwnProfile, type ProfileSelfUpdateFields } from './profileQueries';
import { MedicalQr } from './components/MedicalQr';

// ---------------------------------------------------------------------------
// Schema — only name, phone, business name and the booking email message are
// mutable on this surface. Email is read-only: only HQ can change it via the
// admin form.
// ---------------------------------------------------------------------------

/** Mirrors the server cap in update-franchisee-self (migration 046). */
const BOOKING_EMAIL_MESSAGE_MAX = 1500;

/** Mirrors the server cap in update-franchisee-self (migration 052). */
const ABOUT_TRAINER_MAX = 2500;

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  phone: z.string().trim().optional(),
  business_name: z
    .string()
    .trim()
    .max(80, 'Business name must be 80 characters or fewer')
    .refine((v) => v.length === 0 || v.length >= 2, {
      message: 'Business name must be at least 2 characters',
    })
    .optional(),
  booking_email_message: z
    .string()
    .trim()
    .max(
      BOOKING_EMAIL_MESSAGE_MAX,
      `Your message must be ${BOOKING_EMAIL_MESSAGE_MAX} characters or fewer`,
    )
    .optional(),
  about_trainer: z
    .string()
    .trim()
    .max(ABOUT_TRAINER_MAX, `Your bio must be ${ABOUT_TRAINER_MAX} characters or fewer`)
    .optional(),
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
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      phone: '',
      business_name: '',
      booking_email_message: '',
      about_trainer: '',
    },
  });

  const bookingEmailMessage = watch('booking_email_message') ?? '';
  const aboutTrainer = watch('about_trainer') ?? '';

  // Populate form when profile loads (or reloads after save).
  useEffect(() => {
    if (profile.data) {
      reset({
        name: profile.data.name ?? '',
        phone: profile.data.phone ?? '',
        business_name: profile.data.business_name ?? '',
        booking_email_message: profile.data.booking_email_message ?? '',
        about_trainer: profile.data.about_trainer ?? '',
      });
    }
  }, [profile.data, reset]);

  const onSubmit = async (values: ProfileFormValues) => {
    if (!profile.data) return;

    const trimmedName = values.name.trim();
    const trimmedPhone = values.phone?.trim() ?? '';
    const phoneValue = trimmedPhone.length > 0 ? trimmedPhone : null;
    const trimmedBusinessName = values.business_name?.trim() ?? '';
    const trimmedEmailMessage = values.booking_email_message?.trim() ?? '';
    // Unlike business name, this one CAN be cleared: emptying the box sends
    // null so the extra block disappears from the emails again.
    const emailMessageValue = trimmedEmailMessage.length > 0 ? trimmedEmailMessage : null;

    // Compute diff — only send changed fields. Business name cannot be
    // cleared from this surface (the server requires 2-80 characters), so an
    // emptied field is treated as "no change".
    const fields: ProfileSelfUpdateFields = {};
    if (trimmedName !== profile.data.name) fields.name = trimmedName;
    if (phoneValue !== (profile.data.phone ?? null)) fields.phone = phoneValue;
    if (
      trimmedBusinessName.length > 0 &&
      trimmedBusinessName !== (profile.data.business_name ?? '')
    ) {
      fields.business_name = trimmedBusinessName;
    }
    if (emailMessageValue !== (profile.data.booking_email_message ?? null)) {
      fields.booking_email_message = emailMessageValue;
    }
    const trimmedAbout = values.about_trainer?.trim() ?? '';
    const aboutValue = trimmedAbout.length > 0 ? trimmedAbout : null;
    if (aboutValue !== (profile.data.about_trainer ?? null)) {
      fields.about_trainer = aboutValue;
    }

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
        subtitle="Update your name, contact number, business name and the message customers see on their confirmation emails. Email changes must go through HQ."
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

                {/* Business name — the public trading name shown to customers */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-business-name">Business name</Label>
                  <Input
                    id="profile-business-name"
                    placeholder="e.g. Daisy First Aid Sutton"
                    {...register('business_name')}
                  />
                  <p className="text-daisy-muted text-xs">
                    Your public trading name — shown to customers on booking pages.
                  </p>
                  {errors.business_name ? (
                    <p className="text-daisy-orange text-xs">{errors.business_name.message}</p>
                  ) : null}
                </div>

                {/* Booking email message — the franchisee's own words on the
                    confirmation emails their customers receive (G2). */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-booking-email-message">
                    Your message on confirmation emails
                  </Label>
                  <textarea
                    id="profile-booking-email-message"
                    rows={5}
                    maxLength={BOOKING_EMAIL_MESSAGE_MAX}
                    className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
                    placeholder="e.g. Parking is easiest on the side street. Please wear comfy clothes, we do a lot on the floor. Any questions, just reply to this email."
                    {...register('booking_email_message')}
                  />
                  <p className="text-daisy-muted text-xs">
                    Added to the confirmation email every customer receives after booking a class or
                    buying from your shop, in its own block below the booking details. Leave it
                    blank for nothing extra.
                  </p>
                  <p className="text-daisy-muted text-xs tabular-nums">
                    {bookingEmailMessage.length} / {BOOKING_EMAIL_MESSAGE_MAX}
                  </p>
                  {errors.booking_email_message ? (
                    <p className="text-daisy-orange text-xs">
                      {errors.booking_email_message.message}
                    </p>
                  ) : null}
                </div>

                {/* About your trainer — shown to customers in the booking
                    window's trainer block (migration 052). */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="profile-about-trainer">About you, for customers</Label>
                  <textarea
                    id="profile-about-trainer"
                    rows={6}
                    maxLength={ABOUT_TRAINER_MAX}
                    className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
                    placeholder="e.g. Hi, I'm Sam and I've taught baby and child first aid across Sutton for eight years..."
                    {...register('about_trainer')}
                  />
                  <p className="text-daisy-muted text-xs">
                    Shown as "About your trainer" when customers book one of your classes, next to
                    your photo. We pre-filled it from your page on the Daisy website where we could,
                    so give it a read and make it yours.
                  </p>
                  <p className="text-daisy-muted text-xs tabular-nums">
                    {aboutTrainer.length} / {ABOUT_TRAINER_MAX}
                  </p>
                  {errors.about_trainer ? (
                    <p className="text-daisy-orange text-xs">{errors.about_trainer.message}</p>
                  ) : null}
                </div>

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
                <SummaryRow
                  label={
                    <>
                      Franchisee number
                      <FieldHelp>
                        Your unique instructor number. Customers can type it to open your medical
                        form if they cannot scan the QR code.
                      </FieldHelp>
                    </>
                  }
                  value={profile.data?.number ?? '—'}
                />
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
                  label={
                    <>
                      VAT registered
                      <FieldHelp>
                        Whether your business is registered for VAT. HQ sets this. If it is wrong,
                        contact your support team.
                      </FieldHelp>
                    </>
                  }
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

      {/* Trainer photo — shown in the booking window; Daisy logo until set */}
      {!profile.isLoading && profile.data ? <TrainerPhotoCard /> : null}

      {/* THE permanent medical form QR — one code, every class, forever */}
      {!profile.isLoading && profile.data?.number ? (
        <MedicalQr franchiseeNumber={profile.data.number} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trainer photo (migration 052) — uploaded to the public franchisee-photos
// bucket under the caller's auth uid, then saved to the profile through the
// same constrained self-update EF as the text fields. Shown to customers in
// the booking window; the widget falls back to the Daisy logo when unset.
// ---------------------------------------------------------------------------

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

function TrainerPhotoCard() {
  const profile = useOwnProfile();
  const update = useUpdateOwnProfile();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const photoUrl = profile.data?.photo_url ?? null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      toast.error('Please choose an image under 5 MB');
      return;
    }
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid) throw new Error('You must be signed in to upload a photo.');
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      // A changing filename beats CDN/browser caching of the old photo.
      const path = `${uid}/photo-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('franchisee-photos')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from('franchisee-photos').getPublicUrl(path);
      await update.mutateAsync({ photo_url: pub.publicUrl });
      toast.success('Photo saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Photo upload failed');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await update.mutateAsync({ photo_url: null });
      toast.success('Photo removed — the Daisy logo will show instead');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the photo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
        <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
          Your photo
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt="Your trainer photo"
              className="border-daisy-line h-24 w-24 rounded-full border-2 object-cover"
            />
          ) : (
            <div className="border-daisy-line text-daisy-muted flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed">
              <Camera className="h-8 w-8" aria-hidden />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <p className="text-daisy-muted text-sm">
              Shown to customers next to "About your trainer" when they book one of your classes.
              Until you add one, the Daisy logo shows instead. A friendly headshot works best.
            </p>
            <div className="flex gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <Button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
                {busy ? 'Working…' : photoUrl ? 'Replace photo' : 'Upload photo'}
              </Button>
              {photoUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void onRemove()}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
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

function SummaryRow({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-daisy-muted flex items-center gap-1 text-xs font-bold tracking-[0.06em] uppercase">
        {label}
      </dt>
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
