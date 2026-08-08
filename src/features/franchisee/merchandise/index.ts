/**
 * Barrel for the franchisee merchandise feature.
 */
export { default as MerchandisePage } from './MerchandisePage';
export { RecordSaleDialog } from './RecordSaleDialog';
export { ShopPanel } from './ShopPanel';
export { ShopListingDialog } from './ShopListingDialog';
export {
  useProducts,
  useOwnProductSales,
  useSaleCourseOptions,
  useCreateProductSale,
  useDeleteProductSale,
  useOwnFranchiseeProducts,
  useShopItems,
  useUpsertFranchiseeProduct,
  saleChannel,
} from './merchandiseQueries';
export type {
  Product,
  ProductKind,
  ProductSale,
  ProductSaleRow,
  ProductSalePaymentMethod,
  ProductSaleChannel,
  CreateProductSalePayload,
  SaleCourseOption,
  FranchiseeProduct,
  UpsertFranchiseeProductPayload,
  ShopItem,
} from './merchandiseQueries';
