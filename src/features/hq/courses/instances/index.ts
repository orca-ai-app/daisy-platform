export { default as InstancesList } from './InstancesList';
export { default as InstanceDetail } from './InstanceDetail';
export { default as EditInstanceDialog } from './EditInstanceDialog';
export { default as CancelInstanceDialog } from './CancelInstanceDialog';
export {
  useCourseInstances,
  useCourseInstance,
  useUpdateCourseInstance,
  useCancelCourseInstance,
  useCourseInstanceBookingsCount,
  useFranchiseeOptions,
  courseInstanceStatusVariant,
  type CourseInstanceListRow,
  type CourseInstanceDetail,
  type CourseInstancesFilters,
  type CourseInstancesResult,
  type CourseInstanceStatus,
  type DateRangePreset,
  type CourseInstanceUpdate,
} from './queries';
