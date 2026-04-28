import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface EmptyStateCTA {
  label: string;
  onClick?: () => void;
  href?: string;
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body?: string;
  /** Structured CTA — convenient for label + href/onClick. */
  cta?: EmptyStateCTA;
  /** Raw action node — escape hatch for callers that need full control. */
  action?: ReactNode;
}

/**
 * Centred empty-state placeholder used across HQ and franchisee pages.
 * Pass any lucide-react icon as `icon`. The icon is rendered at 48px.
 */
export function EmptyState({ icon, title, body, cta, action }: EmptyStateProps) {
  return (
    <div
      className="border-daisy-line flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed p-10 text-center"
      data-daisy-stub="EmptyState"
    >
      {icon ? (
        <div
          className="text-daisy-muted flex h-12 w-12 items-center justify-center"
          aria-hidden="true"
        >
          <span className="[&>svg]:h-12 [&>svg]:w-12">{icon}</span>
        </div>
      ) : null}
      <h2 className="font-display text-daisy-ink text-[20px] font-bold">{title}</h2>
      {body ? <p className="text-daisy-muted max-w-md text-sm">{body}</p> : null}
      {cta ? (
        cta.href ? (
          <Button asChild variant="default">
            <a href={cta.href}>{cta.label}</a>
          </Button>
        ) : (
          <Button onClick={cta.onClick}>{cta.label}</Button>
        )
      ) : null}
      {action}
    </div>
  );
}
