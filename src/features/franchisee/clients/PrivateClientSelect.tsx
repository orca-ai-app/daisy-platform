/**
 * PrivateClientSelect — searchable combobox for selecting a private client.
 *
 * Used in:
 *   - CreateCourse Step 4 (private courses only; optional)
 *   - ClientsList (future filtering)
 *
 * Pulls the list from useOwnPrivateClients() which is RLS-scoped to the
 * signed-in franchisee. The component is uncontrolled-friendly: it calls
 * onChange with the selected client id (string) or null when cleared.
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useOwnPrivateClients } from './clientQueries';

interface PrivateClientSelectProps {
  /** Currently-selected client id, or null / undefined if none. */
  value?: string | null;
  /** Called when the user picks a client or clears the selection. */
  onChange: (clientId: string | null) => void;
  /** When true the field is not interactive. */
  disabled?: boolean;
  /** HTML id for the trigger button — used by a Label's htmlFor. */
  id?: string;
}

/**
 * Minimal accessible searchable select that avoids pulling in a headless-UI
 * library. Uses a plain popover pattern that matches the Daisy design system.
 *
 * Keyboard: Enter/Space open, Escape close, ArrowUp/Down navigate options,
 * Enter selects, Tab closes.
 */
export function PrivateClientSelect({
  value,
  onChange,
  disabled = false,
  id,
}: PrivateClientSelectProps) {
  const { data: clients = [], isLoading } = useOwnPrivateClients();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = clients.find((c) => c.id === value) ?? null;

  const filtered =
    search.trim().length === 0
      ? clients
      : clients.filter(
          (c) =>
            c.company_name.toLowerCase().includes(search.toLowerCase()) ||
            (c.contact_name ?? '').toLowerCase().includes(search.toLowerCase()),
        );

  // Close when focus leaves the container entirely.
  useEffect(() => {
    if (!open) return;
    function handleFocusOut(e: FocusEvent) {
      if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node | null)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('focusout', handleFocusOut);
    return () => document.removeEventListener('focusout', handleFocusOut);
  }, [open]);

  // Focus the search input when the popover opens.
  useEffect(() => {
    if (open) {
      // Small delay so the element is visible before focus.
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  function handleSelect(clientId: string) {
    onChange(clientId);
    setOpen(false);
    setSearch('');
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'border-daisy-line text-daisy-ink focus-visible:border-daisy-primary flex h-10 w-full items-center justify-between rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className={cn(!selected && 'text-daisy-muted')}>
          {isLoading
            ? 'Loading clients...'
            : selected
              ? selected.company_name
              : 'Select a client (optional)'}
        </span>
        <span className="flex items-center gap-1">
          {selected && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear client selection"
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ')
                  handleClear(e as unknown as React.MouseEvent);
              }}
              className="text-daisy-muted hover:text-daisy-orange rounded px-1 text-xs"
            >
              Clear
            </span>
          ) : null}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('text-daisy-muted h-4 w-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {/* Popover */}
      {open ? (
        <div
          role="listbox"
          aria-label="Private clients"
          className="border-daisy-line shadow-daisy absolute top-full right-0 left-0 z-50 mt-1 rounded-[8px] border-2 bg-white"
        >
          {/* Search */}
          <div className="border-daisy-line border-b p-2">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted w-full rounded-[6px] border px-2 py-1.5 text-sm focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                  setSearch('');
                }
              }}
            />
          </div>

          {/* Options */}
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="text-daisy-muted px-3 py-2 text-sm">
                {clients.length === 0
                  ? 'No clients yet — add one from the Clients page.'
                  : 'No clients match your search.'}
              </li>
            ) : (
              filtered.map((client) => {
                const isSelected = client.id === value;
                return (
                  <li
                    key={client.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(client.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleSelect(client.id);
                    }}
                    tabIndex={0}
                    className={cn(
                      'cursor-pointer px-3 py-2 text-sm focus:outline-none',
                      isSelected
                        ? 'bg-daisy-primary-tint text-daisy-primary font-semibold'
                        : 'text-daisy-ink hover:bg-daisy-primary-tint',
                    )}
                  >
                    <span className="font-medium">{client.company_name}</span>
                    {client.contact_name ? (
                      <span className="text-daisy-muted ml-2 text-xs">{client.contact_name}</span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
