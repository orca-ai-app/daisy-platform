/**
 * Wave 7 VERIFIER peer test — TerritoryWarning render states.
 *
 *   - warning='none'           → renders nothing.
 *   - warning='vacant'         → amber banner + confirm checkbox.
 *   - warning='owned_by_other' → red banner + confirm checkbox.
 *   - the confirm checkbox reflects `confirmed` and fires onConfirmChange.
 *
 * Pure component test — no network, no Supabase.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerritoryWarning } from './TerritoryWarning';

describe('TerritoryWarning', () => {
  it('renders nothing for the none state', () => {
    const { container } = render(
      <TerritoryWarning warning="none" confirmed={false} onConfirmChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an amber vacant banner with a confirm checkbox', () => {
    render(<TerritoryWarning warning="vacant" confirmed={false} onConfirmChange={() => {}} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-territory-warning', 'vacant');
    expect(alert.className).toContain('border-daisy-amber');
    expect(screen.getByText(/unallocated area/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('renders a red owned_by_other banner with a confirm checkbox', () => {
    render(
      <TerritoryWarning warning="owned_by_other" confirmed={false} onConfirmChange={() => {}} />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-territory-warning', 'owned_by_other');
    expect(alert.className).toContain('border-daisy-red');
    expect(screen.getByText(/another franchisee operates here/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('reflects the confirmed prop on the checkbox', () => {
    render(<TerritoryWarning warning="vacant" confirmed={true} onConfirmChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('fires onConfirmChange(true) when the box is ticked', () => {
    const onConfirmChange = vi.fn();
    render(
      <TerritoryWarning warning="vacant" confirmed={false} onConfirmChange={onConfirmChange} />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onConfirmChange).toHaveBeenCalledWith(true);
  });
});
