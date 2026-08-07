/**
 * Shape of `data/fashion-catalog.json`.
 *
 * Hand-written rather than inferred from the file: importing the 886KB JSON
 * would make `medusa build`'s type-check construct a literal type for a
 * 1289-object array on every build.
 */
export interface CatalogVariant {
  sku: string
  color: string
  colorHex: string
  size: string
  sizeSystem: string
  fit: string
  variantImageUrl: string
  price: number
  originalPrice: number
  currency: string
  inStock: boolean
  stockQuantity: number
  barcode: string
  isDefaultVariant: boolean
}

export interface CatalogProduct {
  productId: string
  name: string
  brand: string
  /** Always two levels, `"Men > Jackets"`. */
  category: string
  subCategory: string
  gender: string
  season: string
  style: string
  material: string
  careInstructions: string
  shortDescription: string
  longDescription: string
  primaryColor: string
  ageGroup: string
  tags: string[]
  rating: number
  ratingCount: number
  /** Relative (`/images/prod-0001_....jpg`) for 199 of 200 products. */
  primaryImageUrl: string
  /** All fake example.com URLs — discarded on import. */
  additionalImageUrls: string[]
  createdAt: string
  updatedAt: string
  variants: CatalogVariant[]
  hasDiscount: boolean
  /** Present only on PROD-0082, whose image was never generated. */
  imageGenerationError?: string
}

/** Options and flags parsed from `medusa exec`'s trailing argv. */
export interface ImportOptions {
  dryRun: boolean
  limit?: number
  chunkSize: number
  only?: Set<string>
  hideDemoData: boolean
  verbose: boolean
}
