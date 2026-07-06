/**
 * MedicalQr — THE franchisee's ONE permanent medical-form QR code.
 *
 * Design decision (Chris, 6 Jul): every franchisee has exactly one QR, forever.
 * The URL contains ONLY their instructor number — no course token, no postcode,
 * nothing that can ever go stale. Scanning it opens the medical form, which
 * resolves whichever of their classes is running that day (one-tap picker when
 * they run two). Per-event QR codes were deliberately REMOVED: they were the
 * only kind that could be laminated and silently pin future attendees to an
 * old class. This same component renders everywhere a franchisee might look
 * for "the QR" (Profile, dashboard, course pages) so the right code is the
 * only code they can find.
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, QrCode } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const MEDICAL_BASE = 'https://medical.daisyfirstaid.com/';

/** The permanent medical-form URL for an instructor. Nothing else goes in it. */
export function medicalFormUrl(franchiseeNumber: string): string {
  return `${MEDICAL_BASE}?instructor=${encodeURIComponent(franchiseeNumber)}`;
}

interface MedicalQrProps {
  franchiseeNumber: string;
  /** Compact tile (dashboard) vs full card (Profile / course page). */
  compact?: boolean;
  /** Override the card title. */
  title?: string;
  /** Override the descriptive copy under the title. */
  blurb?: string;
}

const DEFAULT_BLURB =
  'This is your medical form QR code, the same one for every class you run, forever. ' +
  'Print or laminate it once and display it at your classes. When someone scans it, the form ' +
  'automatically finds whichever of your classes is on that day.';

export function MedicalQr({ franchiseeNumber, compact = false, title, blurb }: MedicalQrProps) {
  const url = medicalFormUrl(franchiseeNumber);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 256, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } })
      .then((du) => {
        if (!cancelled) setDataUrl(du);
      })
      .catch((err: unknown) => {
        if (!cancelled) setQrError(err instanceof Error ? err.message : 'QR generation failed');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleDownload = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `medical-form-qr-${franchiseeNumber}.png`;
    a.click();
  };

  if (compact) {
    return (
      <Card>
        <CardContent className="flex items-center gap-4 py-4">
          {dataUrl ? (
            <img
              src={dataUrl}
              alt="Your medical form QR code"
              width={88}
              height={88}
              className="rounded-[8px] border border-[#E5E7EB]"
            />
          ) : (
            <div className="border-daisy-line flex h-[88px] w-[88px] items-center justify-center rounded-[8px] border">
              <QrCode aria-hidden className="text-daisy-muted h-6 w-6" />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <p className="text-daisy-ink text-sm font-bold">My medical form QR</p>
            <p className="text-daisy-muted text-xs">
              One QR for every class you run. Print it once.
            </p>
            <Button size="sm" variant="outline" onClick={handleDownload} disabled={!dataUrl}>
              <Download aria-hidden className="h-4 w-4" />
              Download PNG
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <QrCode aria-hidden className="text-daisy-primary h-4 w-4" />
          <CardTitle>{title ?? 'My medical form QR'}</CardTitle>
        </div>
        <CardDescription>{blurb ?? DEFAULT_BLURB}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {qrError ? (
          <p className="text-daisy-orange text-sm">{qrError}</p>
        ) : dataUrl ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={dataUrl}
              alt="Your medical form QR code"
              width={192}
              height={192}
              className="rounded-[8px] border border-[#E5E7EB]"
            />
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center">
            <span className="text-daisy-muted text-sm">Generating QR…</span>
          </div>
        )}

        <div className="border-daisy-line bg-daisy-paper rounded-[8px] border px-3 py-2">
          <p className="text-daisy-muted mb-1 text-[11px] font-bold tracking-wider uppercase">
            Destination URL
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-daisy-primary text-xs font-medium break-all underline underline-offset-2"
          >
            {url}
          </a>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleDownload} disabled={!dataUrl}>
            <Download aria-hidden className="h-4 w-4" />
            Download PNG
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            Print
          </Button>
        </div>

        <p className="text-daisy-muted text-[11px]">
          Attendees without a camera can type your instructor number{' '}
          <strong>{franchiseeNumber}</strong> at medical.daisyfirstaid.com instead.
        </p>
      </CardContent>
    </Card>
  );
}

export default MedicalQr;
