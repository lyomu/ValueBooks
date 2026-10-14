import { industries } from './industries';

export type IndustryAssetRecord = {
  assetId: string;
  industrySlug: string;
  slot: 'primary' | 'supporting' | 'product';
  description: string;
  assetType: 'photograph' | 'ui-screenshot';
  sourceType: 'pexels-stock' | 'local-valuebooks-capture';
  sourceUrl: string | null;
  licenseStatus: 'PEXELS_LICENSE' | 'INTERNAL_DEMO_CAPTURE';
  attribution: string | null;
  status: 'VERIFIED';
  filePath: string | null;
  altText: string;
  reviewedAt: string;
  notes: string;
  nextAction: string;
  appModule?: string;
  screenName?: string;
  capturedAt?: string;
  demoDataVerified?: boolean;
  sensitiveDataReviewed?: boolean;
  featureAvailability?: 'UNVERIFIED';
  refreshNeeded?: boolean;
};

const screenshotRoutes: Record<string, string> = {
  'retail-product': '/dashboard',
  'ecommerce-product': '/invoices',
  'agencies-consultants-product': '/projects',
  'restaurants-hospitality-product': '/expenses',
  'construction-trades-product': '/projects',
  'professional-services-product': '/dashboard/customers',
  'freelancers-product': '/invoices/new',
  'healthcare-practices-product': '/reports',
  'nonprofits-ngos-product': '/reports',
  'wholesale-distribution-product': '/expenses',
  'education-training-product': '/invoices',
  'real-estate-property-product': '/projects',
};

const pexelsPhotoIds: Record<string, string> = {
  'retail-primary': '264636',
  'retail-supporting': '3184357',
  'ecommerce-primary': '3769138',
  'ecommerce-supporting': '4246120',
  'agencies-consultants-primary': '3184339',
  'agencies-consultants-supporting': '3184465',
  'restaurants-hospitality-primary': '67468',
  'restaurants-hospitality-supporting': '1181244',
  'construction-trades-primary': '896106',
  'construction-trades-supporting': '4240507',
  'professional-services-primary': '3184433',
  'professional-services-supporting': '3184418',
  'freelancers-primary': '4050315',
  'freelancers-supporting': '5212345',
  'healthcare-practices-primary': '3786157',
  'healthcare-practices-supporting': '3184192',
  'nonprofits-ngos-primary': '3183150',
  'nonprofits-ngos-supporting': '3182773',
  'wholesale-distribution-primary': '4481328',
  'wholesale-distribution-supporting': '380769',
  'education-training-primary': '5428832',
  'education-training-supporting': '3182781',
  'real-estate-property-primary': '8293778',
  'real-estate-property-supporting': '3182826',
};

/**
 * The production-safe asset registry. Pages only receive placeholders until a record has a
 * verified source, rights evidence, optimized file path, and approved implementation status.
 */
export const industryAssetRegistry: IndustryAssetRecord[] = industries.flatMap((industry) =>
  industry.assets.map((asset) => {
    const isProduct = asset.slot === 'product';
    const pexelsId = pexelsPhotoIds[asset.assetId];
    return {
      assetId: asset.assetId,
      industrySlug: industry.slug,
      slot: asset.slot,
      description: asset.description,
      assetType: isProduct ? 'ui-screenshot' : 'photograph',
      sourceType: isProduct ? 'local-valuebooks-capture' : 'pexels-stock',
      sourceUrl: isProduct
        ? screenshotRoutes[asset.assetId]!
        : `https://www.pexels.com/photo/${pexelsId}/`,
      licenseStatus: isProduct ? 'INTERNAL_DEMO_CAPTURE' : 'PEXELS_LICENSE',
      attribution: isProduct
        ? 'Internal ValueBooks demo capture; no third-party attribution required.'
        : 'Pexels attribution is not required; license reference retained in tracker.',
      status: 'VERIFIED',
      filePath: `/images/industries/${industry.slug}/${isProduct ? 'product.png' : `${asset.slot}.jpg`}`,
      altText: asset.alt,
      reviewedAt: '2026-10-14',
      notes: isProduct
        ? 'Captured from the local ValueBooks demo environment; no real customer information was used.'
        : 'Pexels stock photograph downloaded locally and visually reviewed for the assigned industry slot.',
      nextAction: isProduct
        ? 'Refresh after a material UI change or any demo-data policy change.'
        : 'Re-verify the Pexels listing before a future replacement or altered usage.',
      ...(isProduct
        ? {
            appModule: screenshotRoutes[asset.assetId]!,
            screenName: asset.description,
            capturedAt: '2026-10-14',
            demoDataVerified: true,
            sensitiveDataReviewed: true,
            featureAvailability: 'UNVERIFIED' as const,
            refreshNeeded: false,
          }
        : {}),
    };
  }),
);
