/**
 * Wave 7 VERIFIER peer test — MonthCalendar BST-safe date bucketing.
 *
 *   - A course dated 2025-03-30 (the day BST starts, 01:00 UTC) buckets into
 *     MARCH, NOT into the previous day. A naive
 *     `new Date('2025-03-30').toISOString().split('T')[0]` approach would be
 *     at risk of rolling to 29 Mar; this asserts the chip lands on 30 Mar.
 *   - Courses outside the rendered month are filtered out.
 *   - A course at the last day of a 31-day month (31 Jan) renders in January.
 *   - Clicking a chip fires onChipClick with the course id.
 *
 * Pure component test — no network.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MonthCalendar, type MonthCalendarCourse } from './MonthCalendar';

function course(
  partial: Partial<MonthCalendarCourse> & { id: string; event_date: string },
): MonthCalendarCourse {
  return {
    start_time: '10:00:00',
    template_name: 'Baby & Child',
    status: 'scheduled',
    spots_remaining: 5,
    capacity: 12,
    ...partial,
  };
}

describe('MonthCalendar bucketing', () => {
  it('buckets a 2025-03-30 (BST start) course into the 30 Mar cell', () => {
    const courses = [course({ id: 'bst', event_date: '2025-03-30', template_name: 'BST Course' })];
    render(<MonthCalendar year={2025} month={3} courses={courses} onChipClick={() => {}} />);

    // The chip must be present and labelled with its template name.
    const chip = screen.getByRole('button', { name: /BST Course/ });
    expect(chip).toBeInTheDocument();

    // It must live in the same grid cell as the "30" day number, proving it
    // did not roll back to 29 Mar.
    const dayThirty = screen.getByText('30');
    const cell = dayThirty.closest('div');
    expect(cell).not.toBeNull();
    expect(within(cell as HTMLElement).getByRole('button', { name: /BST Course/ })).toBe(chip);
  });

  it('filters out courses that fall outside the rendered month', () => {
    const courses = [
      course({ id: 'in', event_date: '2025-03-15', template_name: 'In Month' }),
      course({ id: 'out', event_date: '2025-04-01', template_name: 'Next Month' }),
    ];
    render(<MonthCalendar year={2025} month={3} courses={courses} onChipClick={() => {}} />);

    expect(screen.getByRole('button', { name: /In Month/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next Month/ })).toBeNull();
  });

  it('renders a 31 Jan course in the January grid', () => {
    const courses = [course({ id: 'eom', event_date: '2025-01-31', template_name: 'EOM Course' })];
    render(<MonthCalendar year={2025} month={1} courses={courses} onChipClick={() => {}} />);

    const dayThirtyOne = screen.getByText('31');
    const cell = dayThirtyOne.closest('div');
    expect(
      within(cell as HTMLElement).getByRole('button', { name: /EOM Course/ }),
    ).toBeInTheDocument();
  });

  it('fires onChipClick with the course id', () => {
    const onChipClick = vi.fn();
    const courses = [course({ id: 'click-me', event_date: '2025-03-10' })];
    render(<MonthCalendar year={2025} month={3} courses={courses} onChipClick={onChipClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Baby & Child/ }));
    expect(onChipClick).toHaveBeenCalledWith('click-me');
  });
});
