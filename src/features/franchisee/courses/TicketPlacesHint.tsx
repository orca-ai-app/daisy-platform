/**
 * Live consequence of the "Places used per ticket" value (F1, round 2).
 *
 * The ticket field used to be labelled just "Seats", which reads as "how many
 * of these tickets are available". A franchisee typed the class size into it,
 * so one booking consumed the entire class and the public booking page said
 * "Not enough spaces remaining on this course" on a class with nothing sold.
 *
 * This hint makes the mistake visible before it is saved: typing 20 on a class
 * of 20 reads back as "up to 20 people can book (1 ticket)", and anything above
 * the capacity is rejected by validation.
 *
 * Rendered under the field in both the create wizard (CreateCourse) and the
 * ticket dialog (CourseDetail).
 */

export function TicketPlacesHint({
  seatsConsumed,
  capacity,
}: {
  seatsConsumed: number | undefined;
  capacity: number | undefined;
}) {
  if (
    !Number.isFinite(seatsConsumed) ||
    !Number.isFinite(capacity) ||
    (seatsConsumed as number) < 1 ||
    (capacity as number) < 1
  ) {
    return null;
  }

  const seats = seatsConsumed as number;
  const cap = capacity as number;
  // Above capacity the field is invalid; the error message says so instead.
  if (seats > cap) return null;

  const tickets = Math.floor(cap / seats);
  const people = tickets * seats;

  return (
    <p className="text-daisy-ink-soft text-xs">
      At {seats} place{seats === 1 ? '' : 's'} per ticket, up to {people}{' '}
      {people === 1 ? 'person' : 'people'} can book
      {seats > 1 ? ` (${tickets} ticket${tickets === 1 ? '' : 's'})` : ''}.
    </p>
  );
}
