import {
  demoLandingContentSchema,
  type DemoLandingContent,
} from "./demo-landing-schema";
import {
  searchStockPhotos,
  stockPhotoLabelForCategory,
  stockPhotoQueryForCategory,
  type StockPhoto,
} from "./stock-photos";

export const DEMO_GALLERY_PHOTO_TARGET = 3;

export type DemoStockPhotos = {
  hero: StockPhoto | null;
  gallery: StockPhoto[];
};

export const EMPTY_DEMO_STOCK_PHOTOS: DemoStockPhotos = { hero: null, gallery: [] };

/**
 * Fills only the empty slots. A photo the reviewer already supplied is never
 * replaced, and an existing gallery is left exactly as it is.
 */
export function applyStockPhotos(
  content: DemoLandingContent,
  photos: DemoStockPhotos,
): DemoLandingContent {
  const heroIsEmpty = !content.heroImageUrl.trim();
  const galleryIsEmpty = content.galleryImages.length === 0;

  if ((!heroIsEmpty || !photos.hero) && (!galleryIsEmpty || photos.gallery.length === 0)) {
    return content;
  }

  return demoLandingContentSchema.parse({
    ...content,
    heroImageUrl: heroIsEmpty && photos.hero ? photos.hero.url : content.heroImageUrl,
    heroImageKind: heroIsEmpty && photos.hero ? "stock" : content.heroImageKind,
    heroImageCredit: heroIsEmpty && photos.hero ? photos.hero.credit : content.heroImageCredit,
    heroImageCreditUrl:
      heroIsEmpty && photos.hero ? photos.hero.creditUrl : content.heroImageCreditUrl,
    galleryImages:
      galleryIsEmpty && photos.gallery.length
        ? photos.gallery.slice(0, 6).map((photo) => ({
            url: photo.url,
            alt: photo.alt,
            kind: "stock" as const,
            credit: photo.credit,
            creditUrl: photo.creditUrl,
          }))
        : content.galleryImages,
    businessSnapshot: content.businessSnapshot ?? null,
  });
}

/**
 * Never throws. A missing key, a provider outage or a malformed answer all end
 * with no photos, which is exactly the demo the free generator produced before.
 */
export async function fetchDemoStockPhotos(category: string): Promise<DemoStockPhotos> {
  try {
    const photos = await searchStockPhotos({
      query: stockPhotoQueryForCategory(category),
      altLabel: stockPhotoLabelForCategory(category),
      perPage: DEMO_GALLERY_PHOTO_TARGET + 1,
    });

    const [hero, ...gallery] = photos;
    return {
      hero: hero ?? null,
      gallery: gallery.slice(0, DEMO_GALLERY_PHOTO_TARGET),
    };
  } catch {
    // Intentionally silent: illustrative photos are a bonus, never a dependency.
    return EMPTY_DEMO_STOCK_PHOTOS;
  }
}
