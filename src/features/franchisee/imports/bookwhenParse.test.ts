import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  toRecords,
  parseMoneyToPence,
  splitName,
  isTruthyFlag,
  cleanTitle,
  parseAddress,
  parseBookwhenDateTime,
  looksOnline,
  matchTemplate,
  buildPlan,
  type TemplateLite,
} from './bookwhenParse';

const TEMPLATES: TemplateLite[] = [
  {
    id: 't-baby',
    name: 'Baby and Child First Aid Class',
    slug: 'baby-child-first-aid',
    default_capacity: 12,
    default_price_pence: 3000,
  },
  {
    id: 't-efaw',
    name: 'Emergency First Aid At Work',
    slug: 'emergency-first-aid-at-work',
    default_capacity: 12,
    default_price_pence: 9500,
  },
  {
    id: 't-baby-ess',
    name: 'Baby First Aid Essentials Class',
    slug: 'baby-first-aid-essentials',
    default_capacity: 12,
    default_price_pence: 2000,
  },
];

describe('parseCsv', () => {
  it('handles quoted fields, embedded commas, escaped quotes and CRLF', () => {
    const csv = 'a,b,c\r\n1,"x,y","he said ""hi"""\r\n2,z,w';
    expect(parseCsv(csv)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x,y', 'he said "hi"'],
      ['2', 'z', 'w'],
    ]);
  });
  it('strips a leading BOM', () => {
    expect(parseCsv('﻿a,b\n1,2')[0]).toEqual(['a', 'b']);
  });
});

describe('parseMoneyToPence', () => {
  it.each([
    ['£99.00', 9900],
    ['101.09', 10109],
    ['18.00', 1800],
    ['1,234.50', 123450],
    ['', null],
  ])('parses %s -> %s', (input, expected) => {
    expect(parseMoneyToPence(input)).toBe(expected);
  });
});

describe('splitName', () => {
  it('splits on the last space', () => {
    expect(splitName('Anna Gamester')).toEqual({ first_name: 'Anna', last_name: 'Gamester' });
    expect(splitName('Cher')).toEqual({ first_name: 'Cher', last_name: '' });
  });
});

describe('isTruthyFlag', () => {
  it('reads yes/true/1', () => {
    expect(isTruthyFlag('true')).toBe(true);
    expect(isTruthyFlag('Yes')).toBe(true);
    expect(isTruthyFlag('')).toBe(false);
    expect(isTruthyFlag('no')).toBe(false);
  });
});

describe('cleanTitle', () => {
  it('strips leading emoji decoration franchisees use', () => {
    expect(cleanTitle('✅ Level 3 Emergency First Aid at Work - Hitchin')).toBe(
      'Level 3 Emergency First Aid at Work - Hitchin',
    );
    expect(cleanTitle('💻LIVE ONLINE PUBLIC Class - 1 hour Baby Essentials')).toBe(
      'LIVE ONLINE PUBLIC Class - 1 hour Baby Essentials',
    );
  });
});

describe('parseAddress', () => {
  it('splits BookWhen Location into venue + postcode', () => {
    expect(parseAddress('Walsworth Community Centre, 88 Woolgrove Road, Hitchin, SG4 0BX')).toEqual(
      {
        venue_name: 'Walsworth Community Centre',
        venue_postcode: 'SG4 0BX',
      },
    );
  });
  it('returns nulls for empty (online)', () => {
    expect(parseAddress('')).toEqual({ venue_name: null, venue_postcode: null });
  });
});

describe('parseBookwhenDateTime', () => {
  it('reads date + time', () => {
    expect(parseBookwhenDateTime('2026-08-08 09:00:00 +0100')).toEqual({
      date: '2026-08-08',
      time: '09:00',
    });
  });
  it('treats midnight (all-day) as no time', () => {
    expect(parseBookwhenDateTime('2026-08-10 00:00:00 +0100')).toEqual({
      date: '2026-08-10',
      time: null,
    });
  });
});

describe('looksOnline', () => {
  it('true for empty location or online wording', () => {
    expect(looksOnline('Baby Class', '')).toBe(true);
    expect(looksOnline('LIVE ONLINE Baby Essentials', 'Distance learning')).toBe(true);
  });
  it('false for a physical venue', () => {
    expect(looksOnline('Baby Class', 'Church Hall, Sutton, SM1 1AA')).toBe(false);
  });
});

describe('matchTemplate', () => {
  it('matches EFAW from a decorated title + ticket', () => {
    const r = matchTemplate(
      'Level 3 Emergency First Aid at Work Emergency First Aid At Work',
      TEMPLATES,
    );
    expect(r.template?.id).toBe('t-efaw');
  });
  it('unmatched for nonsense', () => {
    expect(matchTemplate('Pottery Workshop', TEMPLATES).match).toBe('unmatched');
  });
});

describe('buildPlan (attendances schema)', () => {
  const H = [
    'Event title',
    'EventID',
    'Event starts',
    'Event ends',
    'Event cancelled',
    'Location',
    'BookingID',
    'Booking status',
    'Booking cost',
    'Booking owed amount',
    'Ticket name',
    'Ticket face value',
    'Contact name',
    'Contact email',
    'Attended?',
    'First name',
    'Last name',
    'Booker phone number',
  ];
  const row = (o: Record<string, string>) =>
    H.map((h) => {
      const v = o[h] ?? '';
      return v.includes(',') ? `"${v}"` : v;
    }).join(',');

  const rows = [
    // Future in-person event EV1: booking BK1 = group of 2, BK2 = single, BK3 = cancelled
    row({
      'Event title': '✅ Baby and Child First Aid Class - Sutton',
      EventID: 'EV1',
      'Event starts': '2026-09-06 10:00:00 +0100',
      'Event ends': '2026-09-06 12:00:00 +0100',
      Location: 'Church Hall, Sutton, SM1 1AA',
      BookingID: 'BK1',
      'Booking status': 'complete',
      'Booking cost': '60.00',
      'Booking owed amount': '0.00',
      'Ticket name': 'Baby & Child',
      'Ticket face value': '30.00',
      'Contact name': 'Sarah Barnes',
      'Contact email': 'sarah@example.com',
      'First name': 'Sarah',
      'Last name': 'Barnes',
      'Booker phone number': '07700 900001',
    }),
    row({
      'Event title': '✅ Baby and Child First Aid Class - Sutton',
      EventID: 'EV1',
      'Event starts': '2026-09-06 10:00:00 +0100',
      'Event ends': '2026-09-06 12:00:00 +0100',
      Location: 'Church Hall, Sutton, SM1 1AA',
      BookingID: 'BK1',
      'Booking status': 'complete',
      'Booking cost': '60.00',
      'Booking owed amount': '0.00',
      'Ticket name': 'Baby & Child',
      'Ticket face value': '30.00',
      'Contact name': 'Sarah Barnes',
      'Contact email': 'sarah@example.com',
      'First name': 'Ellie',
      'Last name': 'Barnes',
      'Booker phone number': '07700 900001',
    }),
    row({
      'Event title': '✅ Baby and Child First Aid Class - Sutton',
      EventID: 'EV1',
      'Event starts': '2026-09-06 10:00:00 +0100',
      'Event ends': '2026-09-06 12:00:00 +0100',
      Location: 'Church Hall, Sutton, SM1 1AA',
      BookingID: 'BK2',
      'Booking status': 'complete',
      'Booking cost': '30.00',
      'Booking owed amount': '0.00',
      'Ticket name': 'Baby & Child',
      'Ticket face value': '30.00',
      'Contact name': 'Tom Lang',
      'Contact email': 'tom@example.com',
      'First name': 'Tom',
      'Last name': 'Lang',
    }),
    row({
      'Event title': '✅ Baby and Child First Aid Class - Sutton',
      EventID: 'EV1',
      'Event starts': '2026-09-06 10:00:00 +0100',
      'Event ends': '2026-09-06 12:00:00 +0100',
      Location: 'Church Hall, Sutton, SM1 1AA',
      BookingID: 'BK3',
      'Booking status': 'cancelled',
      'Booking cost': '30.00',
      'Booking owed amount': '0.00',
      'Ticket name': 'Baby & Child',
      'Ticket face value': '30.00',
      'Contact name': 'Gone Away',
      'Contact email': 'gone@example.com',
      'First name': 'Gone',
      'Last name': 'Away',
    }),
    // Past event -> skipped
    row({
      'Event title': 'Old Class',
      EventID: 'EV0',
      'Event starts': '2020-01-01 09:00:00 +0000',
      Location: 'Hall, AB1 2CD',
      BookingID: 'BKX',
      'Booking status': 'complete',
      'Booking cost': '20.00',
      'Booking owed amount': '0.00',
      'Contact name': 'Amy Doe',
      'Contact email': 'amy@example.com',
      'First name': 'Amy',
      'Last name': 'Doe',
    }),
    // Cancelled future event -> skipped
    row({
      'Event title': 'Cancelled Class',
      EventID: 'EV2',
      'Event starts': '2026-10-01 10:00:00 +0100',
      'Event cancelled': 'true',
      Location: 'Hall, CD3 4EF',
      BookingID: 'BKC',
      'Booking status': 'complete',
      'Booking cost': '30.00',
      'Booking owed amount': '0.00',
      'Contact name': 'Nope Person',
      'Contact email': 'nope@example.com',
    }),
    // Online future event -> no venue
    row({
      'Event title': '💻 LIVE ONLINE Baby Essentials',
      EventID: 'EV3',
      'Event starts': '2026-09-10 19:00:00 +0100',
      'Event ends': '2026-09-10 20:00:00 +0100',
      Location: '',
      BookingID: 'BKO',
      'Booking status': 'complete',
      'Booking cost': '18.00',
      'Booking owed amount': '0.00',
      'Ticket name': 'Live online single',
      'Ticket face value': '18.00',
      'Contact name': 'Zoe Web',
      'Contact email': 'zoe@example.com',
      'First name': 'Zoe',
      'Last name': 'Web',
    }),
  ];

  const plan = buildPlan(toRecords(parseCsv([H.join(','), ...rows].join('\n'))), {
    today: '2026-08-24',
    templates: TEMPLATES,
  });

  it('keeps future events, skips past and cancelled', () => {
    expect(plan.courses.map((c) => c.bookwhen_event_id).sort()).toEqual(['EV1', 'EV3']);
    expect(plan.skippedPastCourses).toBe(1);
    expect(plan.skippedCancelledCourses).toBe(1);
  });

  it('resolves the in-person course from Event starts / title / Location', () => {
    const c = plan.courses.find((x) => x.bookwhen_event_id === 'EV1')!;
    expect(c.title).toBe('Baby and Child First Aid Class - Sutton');
    expect(c.event_date).toBe('2026-09-06');
    expect(c.start_time).toBe('10:00');
    expect(c.end_time).toBe('12:00');
    expect(c.venue_postcode).toBe('SM1 1AA');
    expect(c.online).toBe(false);
    expect(c.template_id).toBe('t-baby');
    expect(c.capacity).toBeGreaterThanOrEqual(12);
  });

  it('groups attendee rows by BookingID into bookings with the right quantity/paid/cancelled', () => {
    const c = plan.courses.find((x) => x.bookwhen_event_id === 'EV1')!;
    const bk1 = c.bookings.find((b) => b.bookwhen_booking_id === 'BK1')!;
    expect(bk1.quantity).toBe(2); // group of two attendees on one booking
    expect(bk1.first_name).toBe('Sarah');
    expect(bk1.email).toBe('sarah@example.com');
    expect(bk1.paid).toBe(true);
    expect(bk1.total_price_pence).toBe(6000);
    expect(bk1.phone).toBe('07700 900001');
    const bk3 = c.bookings.find((b) => b.bookwhen_booking_id === 'BK3')!;
    expect(bk3.status).toBe('cancelled');
    expect(plan.totals.cancelledBookings).toBe(1);
  });

  it('flags an online class with no venue', () => {
    const c = plan.courses.find((x) => x.bookwhen_event_id === 'EV3')!;
    expect(c.online).toBe(true);
    expect(c.venue_postcode).toBeNull();
    expect(c.start_time).toBe('19:00');
  });
});
