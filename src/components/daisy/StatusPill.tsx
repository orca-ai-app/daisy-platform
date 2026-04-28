import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusVariant =
  | 'active'
  | 'paused'
  | 'terminated'
  | 'paid'
  | 'pending'
  | 'overdue'
  | 'failed'
  | 'manual'
  | 'connected'
  | 'not-connected'
  | 'vacant'
  | 'reserved';

interface StatusPillProps {
  variant: StatusVariant;
  children: ReactNode;
  className?: string;
}

/**
 * Map each status to a pre-baked Tailwind class string. Hex values
 * cover combinations the Daisy palette doesn't already supply.
 */
const VARIANT_CLASSES: Record<StatusVariant, string> = {
  active: 'bg-[#EBF6ED] text-[#2F6F4F]',
  paused: 'bg-[#FEF8DD] text-[#8A5A1A]',
  terminated: 'bg-[#FDEAE5] text-[#8A2A2A]',
  paid: 'bg-[#EBF6ED] text-[#2F6F4F]',
  pending: 'bg-[#FEF8DD] text-[#8A5A1A]',
  overdue: 'bg-[#FDEAE5] text-[#8A2A2A]',
  failed: 'bg-[#FDEAE5] text-[#8A2A2A]',
  manual: 'bg-daisy-primary-soft text-daisy-primary-deep',
  connected: 'bg-[#EBF6ED] text-[#2F6F4F]',
  'not-connected': 'bg-daisy-line-soft text-daisy-muted',
  vacant: 'bg-daisy-line-soft text-daisy-muted',
  reserved: 'bg-daisy-primary-soft text-daisy-primary-deep',
};

export function StatusPill({ variant, children, className }: StatusPillProps) {
  return (
    <span
      data-status={variant}
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
