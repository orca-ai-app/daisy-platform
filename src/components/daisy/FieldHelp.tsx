import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A small "(i)" info tooltip for sitting next to a field label or column header,
 * to explain jargon in one plain sentence. For anything a franchisee must read
 * WHILE filling a field in (they are often on a phone and cannot hover), prefer
 * inline helper text under the input instead of this.
 *
 * Self-contained: it carries its own TooltipProvider so it works anywhere,
 * including in isolated component tests, with no ancestor setup needed.
 */
export function FieldHelp({
  children,
  label = 'More information',
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="text-daisy-muted hover:text-daisy-ink inline-flex shrink-0 cursor-help align-middle"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs leading-snug">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
