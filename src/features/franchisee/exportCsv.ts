/**
 * CSV export for the franchisee's own courses and bookings (Hannah, Sep 2026:
 * planning happens in spreadsheets, so the portal must let the data out).
 *
 * Each export runs its own unpaginated query through the anon client — RLS
 * scopes it to the signed-in franchisee — and downloads a Blob. No Edge
 * Function, no server state.
 */

import { supabase } from '@/lib/supabase';

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, header: string[], rows: unknown[][]): void {
  const lines = [header, ...rows].map((r) => r.map(csvEscape).join(','));
  // BOM so Excel opens UTF-8 (names with accents) correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pounds(pence: unknown): string {
  return typeof pence === 'number' ? (pence / 100).toFixed(2) : '';
}

const today = () => new Date().toISOString().slice(0, 10);

export async function exportCoursesCsv(): Promise<number> {
  const { data, error } = await supabase
    .from('da_course_instances')
    .select(
      `event_date, start_time, end_time, status, visibility, venue_name, venue_address, venue_postcode, venue_tbc,
       capacity, spots_remaining, price_pence, display_name,
       template:da_course_templates ( name ),
       ticket_types:da_ticket_types ( name, price_pence, vat_rate )`,
    )
    .order('event_date', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []).map((c: any) => [
    c.event_date,
    c.start_time,
    c.end_time,
    c.display_name || c.template?.name || '',
    c.status,
    c.visibility,
    c.venue_tbc ? 'TBC' : (c.venue_name ?? ''),
    c.venue_postcode ?? '',
    c.capacity,
    c.spots_remaining,
    c.capacity - c.spots_remaining,
    pounds(c.price_pence),
    (c.ticket_types ?? [])
      .map(
        (t: any) =>
          `${t.name} £${pounds(t.price_pence)}${t.vat_rate != null ? ` incl VAT @${t.vat_rate}%` : ''}`,
      )
      .join('; '),
  ]);
  downloadCsv(
    `daisy-classes-${today()}.csv`,
    [
      'Date',
      'Start',
      'End',
      'Class',
      'Status',
      'Visibility',
      'Venue',
      'Postcode',
      'Capacity',
      'Places left',
      'Booked',
      'Base price £',
      'Tickets',
    ],
    rows,
  );
  return rows.length;
}

export async function exportBookingsCsv(): Promise<number> {
  const { data, error } = await supabase
    .from('da_bookings')
    .select(
      `booking_reference, created_at, quantity, total_price_pence, discount_code, discount_amount_pence,
       payment_status, booking_status, notes,
       customer:da_customers ( first_name, last_name, email, phone ),
       course_instance:da_course_instances ( event_date, venue_name, venue_postcode, display_name,
         template:da_course_templates ( name ) ),
       ticket_type:da_ticket_types ( name )`,
    )
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []).map((b: any) => [
    b.booking_reference,
    (b.created_at ?? '').slice(0, 10),
    b.course_instance?.display_name || b.course_instance?.template?.name || '',
    b.course_instance?.event_date ?? '',
    b.course_instance?.venue_name || b.course_instance?.venue_postcode || '',
    `${b.customer?.first_name ?? ''} ${b.customer?.last_name ?? ''}`.trim(),
    b.customer?.email ?? '',
    b.customer?.phone ?? '',
    b.ticket_type?.name ?? '',
    b.quantity,
    pounds(b.total_price_pence),
    b.discount_code ?? '',
    pounds(b.discount_amount_pence),
    b.payment_status,
    b.booking_status,
    b.notes ?? '',
  ]);
  downloadCsv(
    `daisy-bookings-${today()}.csv`,
    [
      'Reference',
      'Booked on',
      'Class',
      'Class date',
      'Venue',
      'Customer',
      'Email',
      'Phone',
      'Ticket',
      'Qty',
      'Total £',
      'Discount code',
      'Discount £',
      'Payment',
      'Status',
      'Notes',
    ],
    rows,
  );
  return rows.length;
}
