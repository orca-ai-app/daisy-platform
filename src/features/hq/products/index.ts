/**
 * Barrel for the HQ merchandise-products feature.
 */
export { default as ProductsPage } from './ProductsPage';
export {
  useAllProducts,
  useCreateProduct,
  useUpdateProduct,
  HQ_PRODUCTS_QUERY_KEY,
} from './queries';
export type { Product, ProductKind, CreateProductPayload, UpdateProductPayload } from './queries';
