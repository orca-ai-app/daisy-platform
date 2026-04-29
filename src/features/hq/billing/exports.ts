/**
 * CSV + PDF accountant exports for billing previews and saved runs.
 *
 * Reference: docs/M1-build-plan.md §6 Wave 4 Agent 4C task 7.
 *
 * The CSV and PDF accept the same input shape (one or many FranchiseePreview-
 * like records) so the preview dialog and the saved-run detail page can both
 * call them.
 */

import { jsPDF } from 'jspdf';
import { formatPence } from '@/lib/format';
import type { FranchiseePreview, TerritoryBreakdownRow } from './queries';

// Daisy primary blue (#006FAC), used for PDF section headers + table header strip.
const DAISY_PRIMARY_RGB: [number, number, number] = [0, 111, 172];

// ---------------------------------------------------------------------
// Filename helper
// ---------------------------------------------------------------------

export function billingExportFilename(
  periodStart: string,
  periodEnd: string,
  ext: 'csv' | 'pdf',
): string {
  return `daisy-billing-${periodStart}-to-${periodEnd}.${ext}`;
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------

/** Escape a CSV cell — quote if contains comma/quote/newline; escape inner quotes. */
function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const CSV_HEADERS = [
  'Franchisee number',
  'Franchisee name',
  'Fee tier (£)',
  'Period start',
  'Period end',
  'Territory',
  'Postcode prefix',
  'Base fee (£)',
  'Revenue (£)',
  'Percentage fee (£)',
  'Fee charged (£)',
  'Logic',
];

/** Pence integer → "£12.50" but bare (no symbol) for spreadsheet friendliness. */
function poundsString(pence: number): string {
  return (pence / 100).toFixed(2);
}

function logicLabel(logic: TerritoryBreakdownRow['logic']): string {
  switch (logic) {
    case 'base_fee_wins':
      return 'Base fee wins';
    case 'percentage_wins':
      return 'Percentage (10%) wins';
    case 'base_fee_wins_pro_rata':
      return 'Base fee wins (pro-rata)';
    case 'percentage_wins_pro_rata':
      return 'Percentage (10%) wins (pro-rata)';
    default:
      return logic;
  }
}

/**
 * Build a CSV string for one or many franchisee previews. Each territory is a
 * row. Totals per franchisee are appended as a "TOTAL" line so accountants can
 * eyeball the per-franchisee subtotal next to the territory rows.
 */
export function buildBillingPreviewCSV(previews: FranchiseePreview | FranchiseePreview[]): string {
  const list = Array.isArray(previews) ? previews : [previews];
  const lines: string[] = [];
  lines.push(CSV_HEADERS.join(','));

  for (const preview of list) {
    if (preview.territory_breakdown.length === 0) {
      lines.push(
        [
          csvEscape(preview.franchisee_number),
          csvEscape(preview.franchisee_name),
          csvEscape(preview.fee_tier),
          csvEscape(preview.billing_period_start),
          csvEscape(preview.billing_period_end),
          csvEscape('(no territories)'),
          '',
          '0.00',
          '0.00',
          '0.00',
          '0.00',
          '',
        ].join(','),
      );
      continue;
    }

    for (const row of preview.territory_breakdown) {
      lines.push(
        [
          csvEscape(preview.franchisee_number),
          csvEscape(preview.franchisee_name),
          csvEscape(preview.fee_tier),
          csvEscape(preview.billing_period_start),
          csvEscape(preview.billing_period_end),
          csvEscape(row.territory_name),
          csvEscape(row.postcode_prefix),
          poundsString(row.base_fee_pence),
          poundsString(row.revenue_pence),
          poundsString(row.percentage_fee_pence),
          poundsString(row.fee_charged_pence),
          csvEscape(logicLabel(row.logic)),
        ].join(','),
      );
    }

    // Per-franchisee total row.
    lines.push(
      [
        csvEscape(preview.franchisee_number),
        csvEscape(preview.franchisee_name),
        csvEscape(preview.fee_tier),
        csvEscape(preview.billing_period_start),
        csvEscape(preview.billing_period_end),
        csvEscape('TOTAL'),
        '',
        poundsString(preview.total_base_fees_pence),
        '',
        poundsString(preview.total_percentage_fees_pence),
        poundsString(preview.total_due_pence),
        '',
      ].join(','),
    );
  }

  // CRLF line endings — Excel/Numbers behave better with these.
  return lines.join('\r\n') + '\r\n';
}

/**
 * Trigger a CSV download in the browser. No-ops outside a DOM environment.
 */
export function exportBillingPreviewToCSV(
  previews: FranchiseePreview | FranchiseePreview[],
  filename: string,
): void {
  if (typeof document === 'undefined') return;
  const csv = buildBillingPreviewCSV(previews);
  // BOM so Excel detects UTF-8.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------

interface PdfTableColumn {
  header: string;
  width: number; // mm
  align?: 'left' | 'right';
}

const PAGE_MARGIN_MM = 14;

/**
 * Build a multi-page PDF: one franchisee per page. Header carries the Daisy
 * brand mark (text only; no asset upload required), then a summary block,
 * then the territory table, then the totals. Footer on every page with the
 * generation timestamp + page number.
 */
export function buildBillingPreviewPDF(previews: FranchiseePreview | FranchiseePreview[]): jsPDF {
  const list = Array.isArray(previews) ? previews : [previews];
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  if (list.length === 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Daisy First Aid: billing preview', PAGE_MARGIN_MM, 30);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('No franchisees in this preview.', PAGE_MARGIN_MM, 40);
    return doc;
  }

  list.forEach((preview, idx) => {
    if (idx > 0) doc.addPage();
    drawFranchiseePage(doc, preview);
  });

  // Footer — pass over every page after content is drawn.
  const totalPages = doc.getNumberOfPages();
  const generatedAt = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(doc, generatedAt, p, totalPages);
  }

  return doc;
}

function drawFooter(doc: jsPDF, generatedAt: string, page: number, total: number) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.2);
  doc.line(PAGE_MARGIN_MM, pageHeight - 16, pageWidth - PAGE_MARGIN_MM, pageHeight - 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text(`Generated ${generatedAt}`, PAGE_MARGIN_MM, pageHeight - 10);
  const pageLabel = `Page ${page} of ${total}`;
  doc.text(pageLabel, pageWidth - PAGE_MARGIN_MM - doc.getTextWidth(pageLabel), pageHeight - 10);
  // Reset text colour to black so subsequent draws aren't affected.
  doc.setTextColor(0, 0, 0);
}

function drawFranchiseePage(doc: jsPDF, preview: FranchiseePreview) {
  const pageWidth = doc.internal.pageSize.getWidth();
  let cursorY = 18;

  // Brand mark — Daisy in primary blue, then "First Aid" in deeper ink.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...DAISY_PRIMARY_RGB);
  doc.text('Daisy', PAGE_MARGIN_MM, cursorY);
  const daisyW = doc.getTextWidth('Daisy');
  doc.setTextColor(20, 20, 20);
  doc.text(' First Aid', PAGE_MARGIN_MM + daisyW, cursorY);

  // Document type label, right-aligned.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  const label = 'BILLING PREVIEW';
  doc.text(label, pageWidth - PAGE_MARGIN_MM - doc.getTextWidth(label), cursorY);
  doc.setTextColor(0, 0, 0);

  cursorY += 4;
  doc.setDrawColor(...DAISY_PRIMARY_RGB);
  doc.setLineWidth(0.6);
  doc.line(PAGE_MARGIN_MM, cursorY, pageWidth - PAGE_MARGIN_MM, cursorY);

  cursorY += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 20);
  doc.text(`${preview.franchisee_name} (${preview.franchisee_number})`, PAGE_MARGIN_MM, cursorY);

  cursorY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(
    `Period: ${preview.billing_period_start} to ${preview.billing_period_end}`,
    PAGE_MARGIN_MM,
    cursorY,
  );
  cursorY += 5;
  doc.text(`Fee tier: £${preview.fee_tier}/territory/month`, PAGE_MARGIN_MM, cursorY);
  if (preview.pro_rata_applied) {
    cursorY += 5;
    doc.setTextColor(140, 90, 26); // amber-ish for the pro-rata note
    doc.text('Pro-rata applied: franchisee created mid-period.', PAGE_MARGIN_MM, cursorY);
    doc.setTextColor(80, 80, 80);
  }

  cursorY += 9;

  // Territory table.
  const cols: PdfTableColumn[] = [
    { header: 'Territory', width: 50 },
    { header: 'Postcode', width: 22 },
    { header: 'Base fee', width: 22, align: 'right' },
    { header: 'Revenue', width: 26, align: 'right' },
    { header: '10% fee', width: 22, align: 'right' },
    { header: 'Charged', width: 22, align: 'right' },
    { header: 'Logic', width: 18, align: 'right' },
  ];

  cursorY = drawTableHeader(doc, cols, cursorY);
  if (preview.territory_breakdown.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(110, 110, 110);
    doc.text('No territories assigned to this franchisee.', PAGE_MARGIN_MM + 2, cursorY + 6);
    doc.setTextColor(0, 0, 0);
    return;
  }

  for (const row of preview.territory_breakdown) {
    cursorY = drawTableRow(doc, cols, cursorY, [
      row.territory_name,
      row.postcode_prefix,
      formatPence(row.base_fee_pence),
      formatPence(row.revenue_pence),
      formatPence(row.percentage_fee_pence),
      formatPence(row.fee_charged_pence),
      row.logic.startsWith('base_fee') ? 'Base' : '10%',
    ]);
  }

  // Totals strip.
  cursorY += 4;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.line(PAGE_MARGIN_MM, cursorY, pageWidth - PAGE_MARGIN_MM, cursorY);
  cursorY += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text('Totals', PAGE_MARGIN_MM, cursorY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  cursorY += 6;
  drawKeyValue(doc, 'Total base fees', formatPence(preview.total_base_fees_pence), cursorY);
  cursorY += 5;
  drawKeyValue(
    doc,
    'Total percentage fees (10%)',
    formatPence(preview.total_percentage_fees_pence),
    cursorY,
  );
  cursorY += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...DAISY_PRIMARY_RGB);
  drawKeyValue(doc, 'Total due', formatPence(preview.total_due_pence), cursorY);
  doc.setTextColor(0, 0, 0);
}

function drawTableHeader(doc: jsPDF, cols: PdfTableColumn[], y: number): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const totalWidth = cols.reduce((sum, c) => sum + c.width, 0);
  const startX = PAGE_MARGIN_MM;
  // Header strip in Daisy blue.
  doc.setFillColor(...DAISY_PRIMARY_RGB);
  doc.rect(startX, y - 4, Math.min(totalWidth, pageWidth - PAGE_MARGIN_MM * 2), 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  let x = startX + 2;
  for (const c of cols) {
    const text = c.header;
    if (c.align === 'right') {
      doc.text(text, x + c.width - 2 - doc.getTextWidth(text), y);
    } else {
      doc.text(text, x, y);
    }
    x += c.width;
  }
  doc.setTextColor(0, 0, 0);
  return y + 5;
}

function drawTableRow(doc: jsPDF, cols: PdfTableColumn[], y: number, values: string[]): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(20, 20, 20);
  let x = PAGE_MARGIN_MM + 2;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const text = values[i] ?? '';
    if (c.align === 'right') {
      doc.text(text, x + c.width - 2 - doc.getTextWidth(text), y);
    } else {
      // Truncate so long territory names don't overflow.
      const maxWidth = c.width - 2;
      let drawn = text;
      if (doc.getTextWidth(text) > maxWidth) {
        while (drawn.length > 1 && doc.getTextWidth(drawn + '…') > maxWidth) {
          drawn = drawn.slice(0, -1);
        }
        drawn = `${drawn}…`;
      }
      doc.text(drawn, x, y);
    }
    x += c.width;
  }
  // Dashed separator under the row.
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(0.1);
  doc.line(PAGE_MARGIN_MM, y + 1.5, pageWidth - PAGE_MARGIN_MM, y + 1.5);
  return y + 6;
}

function drawKeyValue(doc: jsPDF, label: string, value: string, y: number): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.text(label, PAGE_MARGIN_MM, y);
  doc.text(value, pageWidth - PAGE_MARGIN_MM - doc.getTextWidth(value), y);
}

/** Trigger a PDF download in the browser. No-ops outside a DOM environment. */
export function exportBillingPreviewToPDF(
  previews: FranchiseePreview | FranchiseePreview[],
  filename: string,
): void {
  if (typeof document === 'undefined') return;
  const doc = buildBillingPreviewPDF(previews);
  doc.save(filename);
}
