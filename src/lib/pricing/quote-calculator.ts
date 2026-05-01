import type {
  Service,
  ServiceBundle,
  DiscountTier,
  QuoteCalculation,
  QuoteLineItem,
} from "@/types/database";

export interface QuoteRequest {
  selected_service_ids: string[];
  use_bundle_id?: string;
  apply_floor_pricing?: boolean;
}

/**
 * Calculates a fee quote given selected services (or a bundle), applying
 * tiered engagement discounts per Garrison's rules:
 *
 * - Always quote standard price first (anchor high)
 * - If client pushes back, offer floor pricing
 * - Tiered discounts: highest qualifying tier only, no stacking
 * - Floor prices do not stack with tier discounts — apply whichever yields higher realized fee
 * - Total never drops below floor
 */
export function calculateQuote(
  request: QuoteRequest,
  services: Service[],
  bundles: ServiceBundle[],
  discountTiers: DiscountTier[]
): QuoteCalculation {
  // If using a bundle, use bundle pricing directly
  if (request.use_bundle_id) {
    const bundle = bundles.find((b) => b.id === request.use_bundle_id);
    if (!bundle) throw new Error(`Bundle ${request.use_bundle_id} not found`);

    // Build line items from the bundle's included services
    const lineItems: QuoteLineItem[] = bundle.service_ids
      .map((sid) => services.find((s) => s.id === sid))
      .filter((s): s is Service => s != null)
      .map((s) => ({
        service_id: s.id,
        service_name: s.name,
        quantity: 1,
        unit_price: s.standard_price,
        subtotal: s.standard_price,
      }));

    const standaloneTotal = lineItems.reduce((sum, li) => sum + li.subtotal, 0);
    const bundleDiscount = standaloneTotal - bundle.bundle_price;
    const subtotal = request.apply_floor_pricing
      ? bundle.floor_price
      : bundle.bundle_price;

    // Apply tiered discount on top of bundle price
    const tierDiscount = findTierDiscount(subtotal, discountTiers);
    const totalQuotedFee = Math.max(subtotal - tierDiscount, bundle.floor_price);

    return {
      line_items: lineItems,
      subtotal,
      bundle_discount: Math.max(bundleDiscount, 0),
      engagement_tier_discount: tierDiscount,
      total_quoted_fee: totalQuotedFee,
      floor_total: bundle.floor_price,
      negotiation_headroom: bundle.bundle_price - bundle.floor_price,
    };
  }

  // Individual service selection
  const lineItems: QuoteLineItem[] = [];
  let subtotal = 0;
  let floorTotal = 0;

  for (const serviceId of request.selected_service_ids) {
    const service = services.find((s) => s.id === serviceId);
    if (!service) throw new Error(`Service ${serviceId} not found`);

    const unitPrice = request.apply_floor_pricing
      ? service.floor_price
      : service.standard_price;

    lineItems.push({
      service_id: service.id,
      service_name: service.name,
      quantity: 1,
      unit_price: unitPrice,
      subtotal: unitPrice,
    });

    subtotal += unitPrice;
    floorTotal += service.floor_price;
  }

  // Standard total for headroom calculation (always based on standard pricing)
  const standardTotal = request.apply_floor_pricing
    ? lineItems.reduce((sum, li) => {
        const svc = services.find((s) => s.id === li.service_id)!;
        return sum + svc.standard_price;
      }, 0)
    : subtotal;

  // Apply highest qualifying tier discount
  const tierDiscount = findTierDiscount(subtotal, discountTiers);
  const totalQuotedFee = Math.max(subtotal - tierDiscount, floorTotal);

  return {
    line_items: lineItems,
    subtotal,
    bundle_discount: 0,
    engagement_tier_discount: tierDiscount,
    total_quoted_fee: totalQuotedFee,
    floor_total: floorTotal,
    negotiation_headroom: standardTotal - floorTotal,
  };
}

/**
 * Find the highest qualifying tier discount for a given subtotal.
 * Returns 0 if no tier qualifies.
 */
function findTierDiscount(
  subtotal: number,
  tiers: DiscountTier[]
): number {
  const qualifying = tiers
    .filter((t) => t.active && subtotal >= t.engagement_threshold)
    .sort((a, b) => b.engagement_threshold - a.engagement_threshold);

  return qualifying.length > 0 ? qualifying[0].discount_amount : 0;
}
