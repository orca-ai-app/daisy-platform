/**
 * Barrel for the franchisee merchandise feature.
 */
export { default as MerchandisePage } from './MerchandisePage';
export { RecordSaleDialog } from './RecordSaleDialog';
export { ShopPanel } from './ShopPanel';
export { ShopListingDialog } from './ShopListingDialog';
export { OwnProductDialog } from './OwnProductDialog';
export {
  useProducts,
  useOwnProductSales,
  useSaleCourseOptions,
  useCreateProductSale,
  useDeleteProductSale,
  useOwnFranchiseeProducts,
  useShopItems,
  useUpsertFranchiseeProduct,
  useCreateOwnProduct,
  useUpdateOwnProduct,
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
  CreateOwnProductPayload,
  UpdateOwnProductPayload,
  SaleCourseOption,
  FranchiseeProduct,
  UpsertFranchiseeProductPayload,
  ShopItem,
} from './merchandiseQueries';
