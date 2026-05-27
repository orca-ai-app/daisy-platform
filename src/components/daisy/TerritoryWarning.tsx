/**
 * TerritoryWarning — Wave 7A build.
 *
 * Renders a styled banner when a course venue is out of the franchisee's
 * territory. Two states:
 *   - owned_by_other → red banner (hard conflict)
 *   - vacant         → amber banner (soft conflict)
 *   - none           → renders nothing
 *
 * The confirmation checkbox must be ticked before the wizard allows
 * submission. The parent controls both `confirmed` state and the
 * `onConfirmChange` handler so the wizard can gate the Save button.
 *
 * Tokens: Daisy palette only (no raw hex values that are already in the
 * palette; StatusPill-style hex literals only where the palette is silent).
 */

import { cn } from '@/lib/utils';
import type { OutOfTerritoryWarning } from '@/features/franchisee/courses/types';

export interface TerritoryWarningProps {
  /** Server-derived warning state. 'none' renders nothing. */
  warning: OutOfTerritoryWarning;
  /** Whether the franchisee has acknowledged the warning. */
  confirmed: boolean;
  /** Called when the confirm checkbox toggles. */
  onConfirmChange: (confirmed: boolean) => void;
  /** Optional extra class on the outer wrapper. */
  className?: string;
}

interface WarningConfig {
  wrapperClass: string;
  iconBgClass: string;
  titleClass: string;
  confirmBorderClass: string;
  title: string;
  body: string;
  confirmLabel: string;
  /** SVG path(s) for the icon, drawn at 24×24 with stroke. */
  iconPaths: string[];
}

const CONFIG: Record<Exclude<OutOfTerritoryWarning, 'none'>, WarningConfig> = {
  owned_by_other: {
    wrapperClass: 'border-daisy-red bg-[#FDEAE5]',
    iconBgClass: 'bg-daisy-red',
    titleClass: 'text-[#8A2A2A]',
    confirmBorderClass: 'border-daisy-red',
    title: 'Outside your territory — another franchisee operates here',
    body: 'The postcode you have entered falls within a territory assigned to another franchisee. You may still schedule here, but Daisy HQ will be notified.',
    confirmLabel:
      "I understand this is another franchisee's territory and still want to schedule here",
    iconPaths: [
      'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
      'M12 9v4',
      'M12 17h.01',
    ],
  },
  vacant: {
    wrapperClass: 'border-daisy-amber bg-[#FEF8DD]',
    iconBgClass: 'bg-daisy-amber',
    titleClass: 'text-[#8A5A1A]',
    confirmBorderClass: 'border-daisy-amber',
    title: 'Outside your territory — unallocated area',
    body: 'The postcode you have entered is in a territory that has not yet been assigned to any franchisee. You may schedule here, but it is outside your allocated area.',
    confirmLabel: 'I understand this is outside my territory and still want to schedule here',
    iconPaths: [
      'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
      'M12 8v4',
      'M12 16h.01',
    ],
  },
};

export function TerritoryWarning({
  warning,
  confirmed,
  onConfirmChange,
  className,
}: TerritoryWarningProps) {
  if (warning === 'none') return null;

  const cfg = CONFIG[warning];

  return (
    <div
      role="alert"
      data-territory-warning={warning}
      className={cn('rounded-[12px] border-2 p-4', cfg.wrapperClass, className)}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
            cfg.iconBgClass,
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            {cfg.iconPaths.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </svg>
        </div>

        <div className="flex flex-col gap-1">
          <p className={cn('text-sm leading-snug font-bold', cfg.titleClass)}>{cfg.title}</p>
          <p className="text-daisy-ink-soft text-sm">{cfg.body}</p>
        </div>
      </div>

      {/* Confirm checkbox */}
      <label
        className={cn(
          'mt-4 flex cursor-pointer items-start gap-3 rounded-[8px] border-2 bg-white p-3',
          cfg.confirmBorderClass,
        )}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer"
        />
        <span className={cn('text-sm leading-snug font-semibold', cfg.titleClass)}>
          {cfg.confirmLabel}
        </span>
      </label>
    </div>
  );
}
