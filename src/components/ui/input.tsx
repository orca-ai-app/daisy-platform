import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        // text-[16px] below md is the iOS zoom guard: Safari zooms the page
        // when a focused field renders under 16px. md:text-sm restores the
        // original desktop sizing.
        'border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary flex h-11 w-full rounded-[8px] border-2 bg-white px-3 py-2 text-[16px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
