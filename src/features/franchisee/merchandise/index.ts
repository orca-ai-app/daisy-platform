/**
 * Barrel for the franchisee merchandise feature.
 */
export { default as MerchandisePage } from './MerchandisePage';
export { RecordSaleDialog } from './RecordSaleDialog';
export {
  useProducts,
  useOwnProductSales,
  useSaleCourseOptions,
  useCreateProductSale,
  useDeleteProductSale,
} from './merchandiseQueries';
export type {
  Product,
  ProductSale,
  ProductSaleRow,
  ProductSalePaymentMethod,
  CreateProductSalePayload,
  SaleCourseOption,
} from './merchandiseQueries';
