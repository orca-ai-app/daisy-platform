import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide',
  {
    variants: {
      variant: {
        default: 'bg-daisy-line-soft text-daisy-ink-soft',
        primary: 'bg-daisy-primary-soft text-daisy-primary-deep',
        success: 'bg-[#EBF6ED] text-[#2F6F4F]',
        warning: 'bg-[#FEF8DD] text-[#8A5A1A]',
        danger: 'bg-[#FDEAE5] text-[#8A2A2A]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
