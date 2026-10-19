// preview-billing-run/territoryUnits.ts
//
// A billable territory is a TERRITORY NUMBER, not a da_territories row. Since
// the postcode import each row is one postcode district, grouped by
// territory_number (Hannah: 76 postcode rows, 10 territories). Billing per row
// charged the base fee once per postcode: £7,600 a month instead of £1,000.
// Rows with no territory_number stay billable on their own. Pure, so vitest
// can cover it.

export interface TerritoryRow {
  id: string;
  postcode_prefix: string;
  name: string;
  territory_number: number | null;
}

export interface TerritoryUnit {
  /** First row's id, kept as the breakdown's territory_id. */
  id: string;
  /** Every postcode row id in this territory. */
  rowIds: string[];
  /** Postcodes joined for display, e.g. "L17, L18, WA8". */
  postcodes: string;
  name: string;
  territoryNumber: number | null;
}

export function groupTerritories(rows: ReadonlyArray<TerritoryRow>): TerritoryUnit[] {
  const units = new Map<string, TerritoryUnit>();
  for (const r of rows) {
    const key = r.territory_number == null ? `row:${r.id}` : `num:${r.territory_number}`;
    const u = units.get(key);
    if (u) {
      u.rowIds.push(r.id);
      u.postcodes = `${u.postcodes}, ${r.postcode_prefix}`;
    } else {
      units.set(key, {
        id: r.id,
        rowIds: [r.id],
        postcodes: r.postcode_prefix,
        name: r.territory_number == null ? r.name : `Territory ${r.territory_number}`,
        territoryNumber: r.territory_number,
      });
    }
  }
  return Array.from(units.values());
}
