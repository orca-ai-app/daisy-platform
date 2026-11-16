import { describe, it, expect } from 'vitest';
import { formatDeliveryAddress } from './deliveryAddress.ts';

const address = {
  line1: '12 Mill Lane',
  line2: '',
  city: 'Guildford',
  state: 'Surrey',
  postal_code: 'GU1 1AA',
  country: 'GB',
};

describe('formatDeliveryAddress (TRI-0084)', () => {
  it('reads shipping_details (API 2024-06-20)', () => {
    expect(formatDeliveryAddress({ shipping_details: { name: 'Jo Bloggs', address } })).toBe(
      'Jo Bloggs\n12 Mill Lane\nGuildford\nSurrey\nGU1 1AA',
    );
  });

  it('reads collected_information.shipping_details (newer API versions)', () => {
    expect(
      formatDeliveryAddress({
        collected_information: { shipping_details: { name: 'Jo', address } },
      }),
    ).toBe('Jo\n12 Mill Lane\nGuildford\nSurrey\nGU1 1AA');
  });

  it('is null when no address was collected', () => {
    expect(formatDeliveryAddress({})).toBeNull();
    expect(formatDeliveryAddress({ shipping_details: null })).toBeNull();
    expect(formatDeliveryAddress(null)).toBeNull();
  });
});
