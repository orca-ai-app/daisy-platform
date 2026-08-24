import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  toRecords,
  parseMoneyToPence,
  splitName,
  isTruthyFlag,
  bookingStatusFrom,
  parseAddress,
  findIsoDate,
  findTimeRange,
  parseTicketQuantity,
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
    id: 't-ana',
    name: 'Anaphylaxis Awareness Class',
    slug: 'anaphylaxis-awareness',
    default_capacity: 12,
    default_price_pence: 2000,
  },
  {
    id: 't-efaw',
    name: 'Emergency First Aid At Work',
    slug: 'emergency-first-aid-at-work',
    default_capacity: 12,
    default_price_pence: 9500,
  },
];

describe('parseCsv', () => {
  it('handles quoted fields, embedded commas, escaped quotes and CRLF', () => {
    const csv = 'a,b,c\r\n1,"x,y","he said ""hi"""\r\n2,z,w';
    const grid = parseCsv(csv);
    expect(grid).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x,y', 'he said "hi"'],
      ['2', 'z', 'w'],
    ]);
  });

  it('strips a leading BOM', () => {
    const grid = parseCsv('﻿a,b\n1,2');
    expect(grid[0]).toEqual(['a', 'b']);
  });
});

describe('toRecords', () => {
  it('keys cells by trimmed header and skips blank lines', () => {
    const recs = toRecords(parseCsv('BookingID, Schedule \n7,Class\n\n8,Other\n'));
    expect(recs).toEqual([
      { BookingID: '7', Schedule: 'Class' },
      { BookingID: '8', Schedule: 'Other' },
    ]);
  });
});

describe('parseMoneyToPence', () => {
  it.each([
    ['£30.00', 3000],
    ['30', 3000],
    ['1,234.50', 123450],
    ['GBP 30', 3000],
    ['£0.00', 0],
  ])('parses %s -> %i', (input, expected) => {
    expect(parseMoneyToPence(input)).toBe(expected);
  });
  it('returns null for junk', () => {
    expect(parseMoneyToPence('')).toBeNull();
    expect(parseMoneyToPence('n/a')).toBeNull();
  });
});

describe('splitName', () => {
  it('splits on the last space', () => {
    expect(splitName('Sarah Jane Barnes')).toEqual({
      first_name: 'Sarah Jane',
      last_name: 'Barnes',
    });
    expect(splitName('Cher')).toEqual({ first_name: 'Cher', last_name: '' });
    expect(splitName('  ')).toEqual({ first_name: '', last_name: '' });
  });
});

describe('status flags', () => {
  it('reads truthy payment flags', () => {
    expect(isTruthyFlag('Yes')).toBe(true);
    expect(isTruthyFlag('true')).toBe(true);
    expect(isTruthyFlag('No')).toBe(false);
  });
  it('maps booking status', () => {
    expect(bookingStatusFrom('Cancelled')).toBe('cancelled');
    expect(bookingStatusFrom('Refunded')).toBe('cancelled');
    expect(bookingStatusFrom('Attended')).toBe('attended');
    expect(bookingStatusFrom('Booked')).toBe('confirmed');
    expect(bookingStatusFrom('')).toBe('confirmed');
  });
});

describe('parseAddress', () => {
  it('extracts venue name and UK postcode', () => {
    expect(parseAddress('The Church Hall, 5 High St, Sutton, SM1 1AA')).toEqual({
      venue_name: 'The Church Hall',
      venue_postcode: 'SM1 1AA',
    });
  });
  it('returns nulls when nothing is present', () => {
    expect(parseAddress('')).toEqual({ venue_name: null, venue_postcode: null });
  });
});

describe('findIsoDate', () => {
  it.each([
    ['2026-09-06', '2026-09-06'],
    ['06/09/2026', '2026-09-06'],
    ['6-9-2026', '2026-09-06'],
    ['Saturday 6 September 2026', '2026-09-06'],
    ['6th Sep 2026', '2026-09-06'],
  ])('reads %s', (input, expected) => {
    expect(findIsoDate(input)).toBe(expected);
  });
  it('returns null when no date', () => {
    expect(findIsoDate('Baby Class, morning')).toBeNull();
  });
});

describe('findTimeRange', () => {
  it('reads 24h ranges', () => {
    expect(findTimeRange('10:00-12:00')).toEqual({ start: '10:00', end: '12:00' });
  });
  it('reads am/pm ranges', () => {
    expect(findTimeRange('10am - 12:30pm')).toEqual({ start: '10:00', end: '12:30' });
  });
  it('ignores bare day/year numbers', () => {
    expect(findTimeRange('Baby Class 2026')).toEqual({ start: null, end: null });
  });
});

describe('parseTicketQuantity', () => {
  it('takes the first integer, defaulting to 1', () => {
    expect(parseTicketQuantity('2 x Baby Class')).toBe(2);
    expect(parseTicketQuantity('1')).toBe(1);
    expect(parseTicketQuantity('')).toBe(1);
    expect(parseTicketQuantity('Baby Class')).toBe(1);
  });
});

describe('matchTemplate', () => {
  it('matches exactly on name', () => {
    const r = matchTemplate('Anaphylaxis Awareness Class', TEMPLATES);
    expect(r.template?.id).toBe('t-ana');
    expect(r.match).toBe('matched');
  });
  it('matches on substring', () => {
    expect(matchTemplate('Baby and Child First Aid', TEMPLATES).template?.id).toBe('t-baby');
  });
  it('guesses on token overlap', () => {
    const r = matchTemplate('Emergency First Aid (Work)', TEMPLATES);
    expect(r.template?.id).toBe('t-efaw');
    expect(['matched', 'guessed']).toContain(r.match);
  });
  it('returns unmatched for nonsense', () => {
    expect(matchTemplate('Pottery Workshop', TEMPLATES).match).toBe('unmatched');
  });
});

describe('buildPlan', () => {
  const HEADERS =
    'BookingID,Booking status,Payment complete?,Cost,Tickets,Total cost,Booker email,Contact name,Contact email,ScheduleID,Schedule,Booker Phone Number,Class Address,Select Class Type';

  const rows = [
    // Future course, two bookings (one cancelled)
    '1,Booked,Yes,£30.00,1,£30.00,,Sarah Barnes,sarah@example.com,SCH-100,"Class, Saturday 6 September 2026, 10:00-12:00",07700 900001,"Church Hall, Sutton, SM1 1AA",Baby and Child First Aid Class',
    '2,Cancelled,No,£30.00,2,£60.00,,Tom Lang,tom@example.com,SCH-100,"Class, Saturday 6 September 2026, 10:00-12:00",,"Church Hall, Sutton, SM1 1AA",Baby and Child First Aid Class',
    // Past course -> skipped
    '3,Booked,Yes,£20.00,1,£20.00,,Amy Doe,amy@example.com,SCH-050,"Class, 1 January 2020, 09:00-11:00",,"Hall, AB1 2CD",Anaphylaxis Awareness Class',
  ];

  const plan = buildPlan(toRecords(parseCsv([HEADERS, ...rows].join('\n'))), {
    today: '2026-08-24',
    templates: TEMPLATES,
  });

  it('groups by ScheduleID and drops past courses', () => {
    expect(plan.courses).toHaveLength(1);
    expect(plan.skippedPastCourses).toBe(1);
  });

  it('resolves the course date, time, venue, template and capacity', () => {
    const c = plan.courses[0];
    expect(c.event_date).toBe('2026-09-06');
    expect(c.start_time).toBe('10:00');
    expect(c.end_time).toBe('12:00');
    expect(c.venue_postcode).toBe('SM1 1AA');
    expect(c.template_id).toBe('t-baby');
    expect(c.template_match).toBe('matched');
    expect(c.capacity).toBeGreaterThanOrEqual(12);
  });

  it('maps bookings including customer, quantity, paid and cancelled status', () => {
    const c = plan.courses[0];
    expect(c.bookings).toHaveLength(2);
    const sarah = c.bookings.find((b) => b.email === 'sarah@example.com')!;
    expect(sarah.first_name).toBe('Sarah');
    expect(sarah.last_name).toBe('Barnes');
    expect(sarah.paid).toBe(true);
    expect(sarah.quantity).toBe(1);
    expect(sarah.total_price_pence).toBe(3000);
    expect(sarah.phone).toBe('07700 900001');
    const tom = c.bookings.find((b) => b.email === 'tom@example.com')!;
    expect(tom.status).toBe('cancelled');
    expect(tom.quantity).toBe(2);
    expect(plan.totals.cancelledBookings).toBe(1);
  });
});
