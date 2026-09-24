/**
 * ShareLinkCard — a link the franchisee sends to customers, with Copy and
 * Send via WhatsApp. Lifted from the class page's Booking link card (the one
 * control nobody has ever needed the guide for) so the same pattern can sit
 * on My shop and the Courses list.
 */

import { Copy, Link2, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface ShareLinkCardProps {
  title: string;
  description: string;
  url: string;
  /** Message body for the WhatsApp share; the URL is appended if absent. */
  whatsAppText: string;
  /** Small caps label above the URL. Defaults to "Link". */
  urlLabel?: string;
  /** Optional extra controls rendered before the Copy button. */
  children?: React.ReactNode;
}

export function ShareLinkCard({
  title,
  description,
  url,
  whatsAppText,
  urlLabel = 'Link',
  children,
}: ShareLinkCardProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const message = whatsAppText.includes(url) ? whatsAppText : `${whatsAppText} ${url}`;
  const whatsAppHref = encodeURIComponent(message);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Link2 aria-hidden className="text-daisy-primary h-4 w-4" />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {children}
        <div className="border-daisy-line bg-daisy-paper rounded-[8px] border px-3 py-2">
          <p className="text-daisy-muted mb-1 text-[11px] font-bold tracking-wider uppercase">
            {urlLabel}
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-daisy-primary text-sm font-medium break-all underline underline-offset-2"
          >
            {url}
          </a>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleCopy()}>
            <Copy aria-hidden className="h-4 w-4" />
            Copy link
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a
              href={`https://wa.me/?text=${whatsAppHref}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle aria-hidden className="h-4 w-4" />
              Send via WhatsApp
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
