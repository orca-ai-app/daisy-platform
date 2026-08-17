import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-daisy-primary disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-daisy-primary text-white hover:bg-daisy-primary-deep',
        outline: 'border border-daisy-line bg-transparent text-daisy-ink hover:bg-daisy-line-soft',
        ghost: 'text-daisy-ink hover:bg-daisy-line-soft',
        destructive: 'bg-daisy-orange text-white hover:opacity-90',
      },
      // Mobile-first heights meet the 44px minimum touch target; the `md:`
      // value restores the original desktop sizing exactly.
      size: {
        default: 'h-11 px-4 py-2 md:h-10',
        sm: 'h-10 px-3 md:h-9',
        lg: 'h-11 px-6',
        icon: 'h-11 w-11 md:h-10 md:w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
