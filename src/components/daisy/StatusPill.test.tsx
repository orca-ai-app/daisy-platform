import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it('renders the children text', () => {
    render(<StatusPill variant="active">Active</StatusPill>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('exposes the variant via data-status for E2E hooks', () => {
    render(<StatusPill variant="overdue">Overdue</StatusPill>);
    const pill = screen.getByText('Overdue');
    expect(pill.getAttribute('data-status')).toBe('overdue');
  });

  it('applies the connected variant colours', () => {
    render(<StatusPill variant="connected">Connected</StatusPill>);
    const pill = screen.getByText('Connected');
    expect(pill.className).toContain('text-[#2F6F4F]');
  });

  it('applies the not-connected variant colours', () => {
    render(<StatusPill variant="not-connected">Not connected</StatusPill>);
    const pill = screen.getByText('Not connected');
    expect(pill.className).toContain('text-daisy-muted');
  });
});
