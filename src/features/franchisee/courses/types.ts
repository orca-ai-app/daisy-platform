/**
 * ============================================================================
 * FROZEN CONTRACT — builders consume, do not redefine.
 * ============================================================================
 *
 * Wave 7 SCAFFOLD owns this file. Build agents 7A (create-course),
 * 7B (ticket-types / edit / cancel) and 7C (list / calendar) import these
 * types and MUST NOT declare parallel shapes for the same concepts. If a new
 * field is genuinely needed, raise it back to the scaffold owner rather than
 * widening the type locally.
 *
 * Every column name below matches the real DB schema exactly:
 *   - supabase/migrations/002_course_tables.sql   (da_course_instances, da_ticket_types)
 *   - supabase/migrations/011_course_instance_cancellation.sql (cancellation_reason)
 *   - supabase/migrations/016_course_template_extensions.sql (default_ticket_types, certification)
 *   - supabase/migrations/001_initial_schema.sql  (da_course_templates)
 *
 * CHECK-constraint-derived unions are taken verbatim from migration 002:
 *   visibility               CHECK (visibility IN ('public', 'private'))
 *   status                   CHECK (status IN ('scheduled', 'completed', 'cancelled'))
 *   out_of_territory_warning CHECK (... IS NULL OR ... IN ('owned_by_other', 'vacant'))
 *
 * DATE / TIME handling (BST-sensitive — read before touching event_date):
 *   - `event_date` is a Postgres DATE returned as a 'YYYY-MM-DD' string. It is
 *     a calendar day with NO timezone. NEVER reconstruct it via
 *     `new Date(event_date).toISOString().split('T')[0]` — in BST (UTC+1) a
 *     local Date built from a midnight-UTC instant can roll back to the
 *     previous day. Parse/format with date-fns (`parseISO` + `format`) or
 *     `Intl.DateTimeFormat` with an explicit `timeZone: 'Europe/London'`,
 *     treating the string as a wall-clock date.
 *   - `start_time` / `end_time` are Postgres TIME, returned 'HH:MM:SS'
 *     (sometimes 'HH:MM'). Wall-clock, no timezone. Display by slicing /
 *     formatting the string; do not pass through a Date constructor.
 */

// ---------------------------------------------------------------------------
// CHECK-constraint unions (migration 002)
// ---------------------------------------------------------------------------

/** da_course_instances.visibility — CHECK (visibility IN ('public','private')). */
export type Visibility = 'public' | 'private';

/** da_course_instances.status — CHECK (status IN ('scheduled','completed','cancelled')). */
export type CourseInstanceStatus = 'scheduled' | 'completed' | 'cancelled';

/**
 * UI-facing out-of-territory state used by the <TerritoryWarning /> component
 * and the create wizard. `'none'` is the UI's representation of "no warning";
 * it maps to a NULL `out_of_territory_warning` column.
 */
export type OutOfTerritoryWarning = 'none' | 'vacant' | 'owned_by_other';

/**
 * The DB column type for da_course_instances.out_of_territory_warning.
 * The CHECK allows NULL OR one of ('owned_by_other','vacant') — note 'none'
 * is NOT a valid column value; persist NULL instead.
 */
export type OutOfTerritoryWarningColumn = 'owned_by_other' | 'vacant' | null;

/**
 * Convert the nullable DB column into the UI union (NULL → 'none').
 * Pure helper so 7A/7C don't each reinvent the mapping.
 */
export function toOutOfTerritoryWarning(
  col: OutOfTerritoryWarningColumn | undefined,
): OutOfTerritoryWarning {
  return col == null ? 'none' : col;
}

// ---------------------------------------------------------------------------
// da_course_instances — full row (column names match the table 1:1)
// ---------------------------------------------------------------------------

/**
 * A da_course_instances row exactly as stored. Nullable columns are `| null`
 * to match the SQL. `geom` is intentionally omitted — it is a PostGIS
 * GEOMETRY managed by the 007 trigger and never read by the franchisee UI.
 */
export interface CourseInstance {
  id: string;
  created_at: string;
  updated_at: string;
  franchisee_id: string;
  template_id: string;
  territory_id: string | null;
  /** Postgres DATE, 'YYYY-MM-DD'. BST-sensitive — see header. */
  event_date: string;
  /** Postgres TIME, 'HH:MM:SS' (or 'HH:MM'). Wall-clock. */
  start_time: string;
  end_time: string;
  venue_name: string | null;
  venue_address: string | null;
  /** NOT NULL in the schema. */
  venue_postcode: string;
  lat: number | null;
  lng: number | null;
  visibility: Visibility;
  capacity: number;
  spots_remaining: number;
  price_pence: number;
  bespoke_details: string | null;
  status: CourseInstanceStatus;
  stripe_payment_link: string | null;
  out_of_territory: boolean;
  out_of_territory_warning: OutOfTerritoryWarningColumn;
  cancellation_reason: string | null;
}

// ---------------------------------------------------------------------------
// da_ticket_types — full row
// ---------------------------------------------------------------------------

/** A da_ticket_types row exactly as stored. */
export interface TicketType {
  id: string;
  created_at: string;
  course_instance_id: string;
  name: string;
  price_pence: number;
  seats_consumed: number;
  /** NULL means unlimited (capped only by the instance's spots_remaining). */
  max_available: number | null;
  sort_order: number | null;
}

/**
 * da_course_templates.default_ticket_types JSONB element (migration 016).
 * Cloned into da_ticket_types by the create-course-instance Edge Function.
 * `price_modifier_pence` is ADDED to the instance base price_pence to derive
 * the ticket's price_pence.
 */
export interface DefaultTicketType {
  name: string;
  seats_consumed: number;
  price_modifier_pence: number;
}

// ---------------------------------------------------------------------------
// Template projection (read-side, for the create wizard)
// ---------------------------------------------------------------------------

/** da_course_templates.certification — CHECK (NULL OR yes|no|if_requested). */
export type Certification = 'yes' | 'no' | 'if_requested' | null;

/**
 * The slice of da_course_templates the create wizard needs to prefill the
 * form. Read via the anon client + RLS (templates are world-readable).
 */
export interface CourseTemplateOption {
  id: string;
  name: string;
  slug: string;
  duration_hours: number;
  default_price_pence: number;
  default_capacity: number;
  age_range: string | null;
  certification: Certification;
  description: string | null;
  is_active: boolean;
  default_ticket_types: DefaultTicketType[];
}

// ---------------------------------------------------------------------------
// Create-course wizard form payload (client-side form state)
// ---------------------------------------------------------------------------

/**
 * The wizard's collected form state, before it is shaped into the Edge
 * Function request. Money is integer pence throughout. Ticket-type rows are
 * editable copies of the template defaults the franchisee may tweak.
 */
export interface CreateCourseFormValues {
  template_id: string;
  /** 'YYYY-MM-DD' wall-clock date from the date picker. */
  event_date: string;
  /** 'HH:MM' from the time inputs. */
  start_time: string;
  end_time: string;
  venue_name: string;
  venue_address: string;
  venue_postcode: string;
  visibility: Visibility;
  capacity: number;
  price_pence: number;
  bespoke_details: string;
  ticket_types: CreateCourseTicketTypeInput[];
  /**
   * The franchisee has explicitly acknowledged the out-of-territory warning.
   * The wizard blocks submission while a warning is present and this is false.
   */
  out_of_territory_confirmed: boolean;
}

/** A single ticket-type row in the create wizard / request body. */
export interface CreateCourseTicketTypeInput {
  name: string;
  price_pence: number;
  seats_consumed: number;
  max_available: number | null;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// create-course-instance Edge Function I/O contract
// ---------------------------------------------------------------------------

/**
 * POST body for the `create-course-instance` Edge Function (7A builds the
 * function). The function:
 *   - authenticates the caller as the owning franchisee (JWT sub →
 *     da_franchisees.auth_user_id),
 *   - server-side geocodes `venue_postcode` via the geocode-postcode function
 *     (so lat/lng/geom are never trusted from the client),
 *   - computes out_of_territory + out_of_territory_warning from the geocoded
 *     point against da_territories,
 *   - inserts the da_course_instances row (spots_remaining initialised to
 *     capacity, status 'scheduled'),
 *   - inserts the da_ticket_types rows.
 *
 * The client therefore does NOT send lat/lng/geom/out_of_territory/
 * out_of_territory_warning/spots_remaining/status — those are server-derived.
 */
export interface CreateCourseInstanceRequest {
  template_id: string;
  event_date: string; // 'YYYY-MM-DD'
  start_time: string; // 'HH:MM' or 'HH:MM:SS'
  end_time: string;
  venue_name?: string | null;
  venue_address?: string | null;
  venue_postcode: string;
  visibility: Visibility;
  capacity: number;
  price_pence: number;
  bespoke_details?: string | null;
  ticket_types: CreateCourseTicketTypeInput[];
  /**
   * Client-side acknowledgement of an out-of-territory warning. The function
   * re-derives the warning server-side; if a warning exists and this is not
   * true, the function rejects with 409.
   */
  out_of_territory_confirmed?: boolean;
}

/** 2xx success body for create-course-instance. */
export interface CreateCourseInstanceResponse {
  instance: CourseInstance;
  ticket_types: TicketType[];
  /** Server-derived warning ('none' when in-territory). Echoed for the UI. */
  out_of_territory_warning: OutOfTerritoryWarning;
}

/**
 * 409 body returned when the venue is out of territory and the client did not
 * set out_of_territory_confirmed. The UI re-renders <TerritoryWarning /> with
 * this `warning`, the franchisee ticks the confirm box, and resubmits with
 * out_of_territory_confirmed: true.
 */
export interface CreateCourseInstanceTerritoryConflict {
  error: 'out_of_territory';
  warning: Exclude<OutOfTerritoryWarning, 'none'>;
}

/** Generic error body shared by all course Edge Functions. */
export interface CourseEdgeErrorResponse {
  error: string;
}
