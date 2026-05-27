/**
 * Barrel for the franchisee course-management feature (Wave 7).
 *
 * Scaffold exports the page stubs and re-exports the frozen contract so
 * builders import everything from one place. 7A/7B/7C add their query hooks
 * (e.g. from a future `queries.ts`) here as they land.
 */
export { default as CoursesList } from './CoursesList';
export { default as CreateCourse } from './CreateCourse';
export { default as CourseDetail } from './CourseDetail';
export { default as EditCourse } from './EditCourse';

export type {
  Visibility,
  CourseInstanceStatus,
  OutOfTerritoryWarning,
  OutOfTerritoryWarningColumn,
  CourseInstance,
  TicketType,
  DefaultTicketType,
  Certification,
  CourseTemplateOption,
  CreateCourseFormValues,
  CreateCourseTicketTypeInput,
  CreateCourseInstanceRequest,
  CreateCourseInstanceResponse,
  CreateCourseInstanceTerritoryConflict,
  CourseEdgeErrorResponse,
} from './types';
export { toOutOfTerritoryWarning } from './types';
