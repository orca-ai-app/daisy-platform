import { describe, it, expect } from 'vitest';
import { buildBillingPreviewCSV, buildBillingPreviewPDF } from './exports';
import type { FranchiseePreview } from './queries';

const sample: FranchiseePreview = {
  franchisee_id: 'bb7c1ce3-41b3-4416-a78e-a7945d674a5c',
  franchisee_number: 'F001',
  franchisee_name: 'Franchisee Test 2C',
  fee_tier: 120,
  billing_period_start: '2026-03-01',
  billing_period_end: '2026-03-31',
  territory_breakdown: [
    {
      territory_id: '64039f8d-5eba-41be-9428-12aab79c3082',
      postcode_prefix: 'B1',
      territory_name: 'Birmingham Centre',
      base_fee_pence: 12000,
      revenue_pence: 0,
      percentage_fee_pence: 0,
      fee_charged_pence: 12000,
      logic: 'base_fee_wins',
    },
    {
      territory_id: '8167dde1-3df3-4cd1-86a8-fbe15c5b4cbe',
      postcode_prefix: 'E1',
      territory_name: 'Whitechapel',
      base_fee_pence: 12000,
      revenue_pence: 9500,
      percentage_fee_pence: 950,
      fee_charged_pence: 12000,
      logic: 'base_fee_wins',
    },
  ],
  total_base_fees_pence: 24000,
  total_percentage_fees_pence: 950,
  total_due_pence: 24000,
  pro_rata_applied: false,
};

describe('buildBillingPreviewCSV', () => {
  it('emits header + territory rows + total row with no fractional pence', () => {
    const csv = buildBillingPreviewCSV(sample);
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines[0]).toContain('Franchisee number');
    expect(lines[0]).toContain('Logic');
    expect(lines).toHaveLength(4); // header + 2 territory rows + 1 total row
    expect(lines[1]).toContain('120'); // fee_tier as integer pounds
    expect(lines[1]).toContain('Birmingham Centre');
    expect(lines[2]).toContain('Whitechapel');
    expect(lines[2]).toContain('95.00'); // revenue £95
    expect(lines[2]).toContain('9.50'); // 10% fee £9.50
    expect(lines[3]).toContain('TOTAL');
    expect(lines[3]).toContain('240.00'); // total due £240
  });

  it('handles a multi-franchisee preview array', () => {
    const csv = buildBillingPreviewCSV([sample, { ...sample, franchisee_number: 'F002' }]);
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(7); // header + 4 territory rows + 2 total rows
    expect(lines.filter((l) => l.includes('TOTAL'))).toHaveLength(2);
  });

  it('quotes cells containing commas', () => {
    const csv = buildBillingPreviewCSV({
      ...sample,
      territory_breakdown: [{ ...sample.territory_breakdown[0], territory_name: 'Centre, North' }],
    });
    expect(csv).toContain('"Centre, North"');
  });
});

describe('buildBillingPreviewPDF', () => {
  it('produces a non-empty PDF buffer', () => {
    const doc = buildBillingPreviewPDF(sample);
    const buf = doc.output('arraybuffer');
    // A single-page Daisy-branded PDF is roughly 4-10kB.
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it('renders one page per franchisee in a multi-franchisee preview', () => {
    const doc = buildBillingPreviewPDF([sample, sample, sample]);
    expect(doc.getNumberOfPages()).toBe(3);
  });

  it('renders a single page for an empty list', () => {
    const doc = buildBillingPreviewPDF([]);
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
