export { default as FranchiseeList } from './FranchiseeList';
export { default as FranchiseeDetail } from './FranchiseeDetail';
export { default as NewFranchiseePage } from './NewFranchiseePage';
export { default as EditFranchiseeDialog } from './EditFranchiseeDialog';
export {
  useFranchisees,
  useFranchisee,
  useFranchiseeBookings,
  useFranchiseeActivity,
  useFranchiseeTerritories,
  useCreateFranchisee,
  useUpdateFranchisee,
  useNextFranchiseeNumber,
  type FranchiseeRow,
  type FranchiseeListFilters,
  type FranchiseeListResult,
  type FranchiseeDetailResult,
  type CreateFranchiseeInput,
  type CreateFranchiseeResult,
  type UpdateFranchiseeInput,
  type FranchiseeUpdateFields,
} from './queries';
