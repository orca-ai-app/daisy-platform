/**
 * The six course families the PUBLIC booking page filters on. These are the
 * `course-type` values accepted by booking.daisyfirstaid.com/search, so they
 * must stay identical to daisy-booking/src/widget/courseFamilies.ts
 * (COURSE_FAMILIES ids + labels). They are NOT the same buckets as the
 * portal's own Courses-list filter (courseTypeGroups.ts); never mix the two.
 */
export interface PublicCourseFamily {
  id: string;
  label: string;
}

export const PUBLIC_COURSE_FAMILIES: ReadonlyArray<PublicCourseFamily> = [
  { id: 'baby-family', label: 'Baby & family' },
  { id: 'paediatric', label: 'Paediatric' },
  { id: 'workplace', label: 'Workplace' },
  { id: 'teaching-children', label: 'Teaching children' },
  { id: 'online', label: 'Live online' },
  { id: 'bespoke-other', label: 'Bespoke & other' },
];
