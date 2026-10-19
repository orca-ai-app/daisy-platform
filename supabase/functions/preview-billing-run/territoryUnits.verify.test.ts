/**
 * Billing groups postcode rows into territories by territory_number, so the
 * base fee is charged once per territory, not once per postcode (19 Oct 2026).
 */
import { describe, it, expect } from 'vitest';
import { groupTerritories } from './territoryUnits';

const row = (id: string, pc: string, n: number | null, name = pc) => ({
  id,
  postcode_prefix: pc,
  name,
  territory_number: n,
});

describe('groupTerritories', () => {
  it('one unit per territory number, carrying every postcode row', () => {
    const units = groupTerritories([
      row('a', 'L17', 130),
      row('b', 'L18', 130),
      row('c', 'WA8', 130),
      row('d', 'CH41', 131),
    ]);
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({
      id: 'a',
      rowIds: ['a', 'b', 'c'],
      postcodes: 'L17, L18, WA8',
      name: 'Territory 130',
    });
    expect(units[1]).toMatchObject({ rowIds: ['d'], territoryNumber: 131 });
  });

  it('a row with no territory number is billed on its own', () => {
    const units = groupTerritories([
      row('x', 'GU1', null, 'Guildford'),
      row('y', 'GU2', null, 'Guildford 2'),
    ]);
    expect(units.map((u) => u.name)).toEqual(['Guildford', 'Guildford 2']);
  });

  it("Hannah's shape: 76 postcode rows across 10 territories is 10 base fees, not 76", () => {
    const rows = Array.from({ length: 76 }, (_, i) => row(`r${i}`, `P${i}`, 100 + (i % 10)));
    expect(groupTerritories(rows)).toHaveLength(10);
  });
});
