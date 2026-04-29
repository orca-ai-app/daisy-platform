/**
 * Pick up to two initials from a name. Falls back to "??" so the
 * avatar circle is never empty.
 *
 * Examples:
 *   getInitials('Jenni Dunman')       -> 'JD'
 *   getInitials('Maria O\'Connell')   -> 'MO'
 *   getInitials('Ashley')             -> 'A'
 *   getInitials(null)                 -> '??'
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '??';
  const cleaned = name.trim();
  if (!cleaned) return '??';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  const first = parts[0]!.charAt(0);
  const last = parts[parts.length - 1]!.charAt(0);
  return (first + last).toUpperCase();
}
