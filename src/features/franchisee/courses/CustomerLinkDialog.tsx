/**
 * "Link for customers" — build a pre-filtered link to the franchisee's public
 * class list (course type and/or month) and copy it or send it via WhatsApp.
 *
 * This is the BookWhen "?tags=" habit, made a button. Before it existed the
 * recipe lived only in the Help guide and produced a steady stream of "how do
 * I send customers a list of just my Level 3 classes" tickets (TRI-0007,
 * 0019, 0020). The course types are the public page's six families
 * (src/lib/courseFamilies.ts), not the portal's own filter buckets.
 */

import { useMemo, useState } from 'react';
import { ShareLinkCard } from '@/components/daisy';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PUBLIC_COURSE_FAMILIES } from '@/lib/courseFamilies';
import { franchiseePageUrl } from '@/lib/publicUrls';
import { useOwnProfile } from '../profileQueries';

const ANY = 'any';

/** The next six months as 'YYYY-MM' values with "October 2026" labels. */
function buildMonthChoices(): ReadonlyArray<{ value: string; label: string }> {
  const now = new Date();
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    });
  }
  return out;
}

interface CustomerLinkDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CustomerLinkDialog({ open, onClose }: CustomerLinkDialogProps) {
  const profile = useOwnProfile();
  const [family, setFamily] = useState<string>(ANY);
  const [month, setMonth] = useState<string>(ANY);
  const months = useMemo(buildMonthChoices, []);

  const number = profile.data?.number ?? null;
  const url = number
    ? franchiseePageUrl(number, {
        courseType: family === ANY ? undefined : family,
        month: month === ANY ? undefined : month,
      })
    : '';

  const familyLabel = PUBLIC_COURSE_FAMILIES.find((f) => f.id === family)?.label;
  const monthLabel = months.find((m) => m.value === month)?.label;
  const business = profile.data?.business_name ?? 'Daisy First Aid';
  const whatsAppText = `${familyLabel ? `${familyLabel} classes` : 'Classes'}${
    monthLabel ? ` in ${monthLabel}` : ''
  } with ${business}, book here:`;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Link for customers</DialogTitle>
          <DialogDescription>
            Send a link that shows only the classes someone asked about. They can widen or clear the
            filters themselves on the page, so a link never traps anyone.
          </DialogDescription>
        </DialogHeader>

        {number ? (
          <ShareLinkCard
            title="Your link"
            description="Pick a course type and, if you like, a month. The link updates as you choose."
            url={url}
            urlLabel="Link to send"
            whatsAppText={whatsAppText}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-link-family">Course type</Label>
                <Select value={family} onValueChange={setFamily}>
                  <SelectTrigger id="customer-link-family">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>All my classes</SelectItem>
                    {PUBLIC_COURSE_FAMILIES.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customer-link-month">Month</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger id="customer-link-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Any month</SelectItem>
                    {months.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </ShareLinkCard>
        ) : (
          <p className="text-daisy-muted text-sm">Loading your details…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
