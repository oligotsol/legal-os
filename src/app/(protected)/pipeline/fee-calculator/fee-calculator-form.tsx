"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { formatDollars } from "@/lib/format";
import { calculateQuote } from "@/lib/pricing/quote-calculator";
import type {
  Service,
  ServiceBundle,
  ServiceCategory,
  DiscountTier,
} from "@/types/database";
import { saveFeeQuote } from "./actions";

// ---------------------------------------------------------------------------
// Category display labels (no vertical-specific strings in core —
// these are display labels driven by the generic ServiceCategory type)
// ---------------------------------------------------------------------------
const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  estate_planning: "Estate Planning",
  business_transactional: "Business / Transactional",
  trademark: "Trademark",
};

const CATEGORY_ORDER: ServiceCategory[] = [
  "estate_planning",
  "business_transactional",
  "trademark",
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface MatterInfo {
  id: string;
  contactName: string | null;
  matterType: string | null;
  contactId: string | null;
}

interface FeeCalculatorFormProps {
  services: Service[];
  bundles: ServiceBundle[];
  discountTiers: DiscountTier[];
  matterInfo?: MatterInfo | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function FeeCalculatorForm({
  services,
  bundles,
  discountTiers,
  matterInfo,
}: FeeCalculatorFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // State
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [applyFloorPricing, setApplyFloorPricing] = useState(false);

  // Group services by category
  const servicesByCategory = useMemo(() => {
    const grouped = new Map<ServiceCategory, Service[]>();
    for (const svc of services) {
      const list = grouped.get(svc.category) ?? [];
      list.push(svc);
      grouped.set(svc.category, list);
    }
    return grouped;
  }, [services]);

  // Active bundles only
  const activeBundles = useMemo(
    () => bundles.filter((b) => b.active),
    [bundles]
  );

  // Compute quote reactively
  const quote = useMemo(() => {
    const ids = selectedBundleId
      ? bundles.find((b) => b.id === selectedBundleId)?.service_ids ?? []
      : Array.from(selectedServiceIds);

    if (ids.length === 0) return null;

    try {
      return calculateQuote(
        {
          selected_service_ids: ids,
          use_bundle_id: selectedBundleId ?? undefined,
          apply_floor_pricing: applyFloorPricing,
        },
        services,
        bundles,
        discountTiers
      );
    } catch {
      return null;
    }
  }, [
    selectedServiceIds,
    selectedBundleId,
    applyFloorPricing,
    services,
    bundles,
    discountTiers,
  ]);

  // Handlers
  function toggleService(serviceId: string) {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
    // Clear bundle when manually selecting services
    setSelectedBundleId(null);
  }

  function selectBundle(bundleId: string | null) {
    setSelectedBundleId(bundleId);
    if (bundleId) {
      // Clear individual selections when choosing a bundle
      setSelectedServiceIds(new Set());
    }
  }

  function handleSave() {
    if (!quote || !matterInfo) return;

    startTransition(async () => {
      const fd = new FormData();
      fd.set("matter_id", matterInfo.id);
      if (matterInfo.contactId) {
        fd.set("contact_id", matterInfo.contactId);
      }
      fd.set("line_items", JSON.stringify(quote.line_items));
      fd.set("subtotal", String(quote.subtotal));
      fd.set("bundle_discount", String(quote.bundle_discount));
      fd.set(
        "engagement_tier_discount",
        String(quote.engagement_tier_discount)
      );
      fd.set("total_quoted_fee", String(quote.total_quoted_fee));
      fd.set("floor_total", String(quote.floor_total));

      try {
        await saveFeeQuote(fd);
        router.push("/approvals");
      } catch (err) {
        // TODO: surface error toast
        console.error("Failed to save fee quote:", err);
      }
    });
  }

  const hasSelection = selectedBundleId || selectedServiceIds.size > 0;

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-6 lg:flex-row">
      {/* ------------------------------------------------------------------ */}
      {/* Left column: service selection                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex-1 space-y-8">
        {/* Service checkboxes grouped by category */}
        {CATEGORY_ORDER.map((cat) => {
          const catServices = servicesByCategory.get(cat);
          if (!catServices || catServices.length === 0) return null;

          return (
            <div key={cat}>
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {CATEGORY_LABELS[cat]}
              </h3>
              <div className="space-y-2">
                {catServices.map((svc) => {
                  const isChecked =
                    selectedServiceIds.has(svc.id) ||
                    (selectedBundleId != null &&
                      bundles
                        .find((b) => b.id === selectedBundleId)
                        ?.service_ids.includes(svc.id));
                  const isBundleLocked = selectedBundleId != null;

                  return (
                    <label
                      key={svc.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                        isChecked
                          ? "border-primary/40 bg-primary/5"
                          : "border-border hover:border-border/80 hover:bg-muted/50"
                      } ${isBundleLocked ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={!!isChecked}
                        disabled={isBundleLocked}
                        onChange={() => toggleService(svc.id)}
                        className="h-4 w-4 rounded border-border text-primary accent-primary"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{svc.name}</div>
                        {svc.description && (
                          <div className="text-xs text-muted-foreground">
                            {svc.description}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {formatDollars(svc.standard_price)}
                        </div>
                        {svc.floor_price < svc.standard_price && (
                          <div className="text-xs text-muted-foreground">
                            Floor: {formatDollars(svc.floor_price)}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Bundle selector */}
        {activeBundles.length > 0 && (
          <div>
            <Separator className="mb-6" />
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Bundles
            </h3>
            <div className="space-y-2">
              {/* "No bundle" option */}
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  selectedBundleId === null
                    ? "border-primary/40 bg-primary/5"
                    : "border-border hover:border-border/80 hover:bg-muted/50"
                }`}
              >
                <input
                  type="radio"
                  name="bundle"
                  checked={selectedBundleId === null}
                  onChange={() => selectBundle(null)}
                  className="h-4 w-4 border-border text-primary accent-primary"
                />
                <span className="text-sm font-medium">
                  No bundle (individual services)
                </span>
              </label>

              {activeBundles.map((bundle) => (
                <label
                  key={bundle.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    selectedBundleId === bundle.id
                      ? "border-primary/40 bg-primary/5"
                      : "border-border hover:border-border/80 hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="bundle"
                    checked={selectedBundleId === bundle.id}
                    onChange={() => selectBundle(bundle.id)}
                    className="h-4 w-4 border-border text-primary accent-primary"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{bundle.name}</span>
                      <Badge variant="secondary">
                        {bundle.service_ids.length} services
                      </Badge>
                    </div>
                    {bundle.description && (
                      <div className="text-xs text-muted-foreground">
                        {bundle.description}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      {formatDollars(bundle.bundle_price)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Floor: {formatDollars(bundle.floor_price)}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Floor pricing toggle */}
        <Separator />
        <div className="flex items-center gap-3">
          <Switch
            id="floor-pricing"
            checked={applyFloorPricing}
            onCheckedChange={setApplyFloorPricing}
          />
          <Label htmlFor="floor-pricing" className="cursor-pointer">
            Apply floor pricing
          </Label>
          <span className="text-xs text-muted-foreground">
            Use minimum acceptable fees (for negotiation)
          </span>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Right column: live quote summary                                    */}
      {/* ------------------------------------------------------------------ */}
      <div className="w-full lg:w-96 lg:shrink-0">
        <div className="sticky top-6 space-y-4">
          {/* Matter context */}
          {matterInfo && (
            <Card size="sm">
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  Quoting for
                </div>
                <div className="text-sm font-medium">
                  {matterInfo.contactName ?? "Unknown contact"}
                </div>
                {matterInfo.matterType && (
                  <Badge variant="outline" className="mt-1">
                    {matterInfo.matterType}
                  </Badge>
                )}
              </CardContent>
            </Card>
          )}

          {/* Quote summary card */}
          <Card>
            <CardHeader>
              <CardTitle>Quote Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!hasSelection ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Select services or a bundle to see the quote.
                </p>
              ) : quote ? (
                <>
                  {/* Line items */}
                  <div className="space-y-2">
                    {quote.line_items.map((li) => (
                      <div
                        key={li.service_id}
                        className="flex items-start justify-between text-sm"
                      >
                        <span className="mr-2">{li.service_name}</span>
                        <span className="shrink-0 font-medium tabular-nums">
                          {formatDollars(li.unit_price)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  {/* Subtotal */}
                  <div className="flex justify-between text-sm">
                    <span>Subtotal</span>
                    <span className="font-medium tabular-nums">
                      {formatDollars(quote.subtotal)}
                    </span>
                  </div>

                  {/* Bundle discount */}
                  {quote.bundle_discount > 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Bundle discount</span>
                      <span className="tabular-nums">
                        -{formatDollars(quote.bundle_discount)}
                      </span>
                    </div>
                  )}

                  {/* Tier discount */}
                  {quote.engagement_tier_discount > 0 && (
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Engagement tier discount</span>
                      <span className="tabular-nums">
                        -{formatDollars(quote.engagement_tier_discount)}
                      </span>
                    </div>
                  )}

                  <Separator />

                  {/* Total */}
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums text-emerald-600">
                      {formatDollars(quote.total_quoted_fee)}
                    </span>
                  </div>

                  {/* Floor & headroom info */}
                  <div className="space-y-1 rounded-lg bg-muted/50 px-3 py-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Floor total</span>
                      <span className="tabular-nums">
                        {formatDollars(quote.floor_total)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Negotiation headroom</span>
                      <span className="tabular-nums">
                        {formatDollars(quote.negotiation_headroom)}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Unable to calculate quote.
                </p>
              )}
            </CardContent>

            {/* Save button */}
            {matterInfo && quote && (
              <CardFooter>
                <Button
                  className="w-full"
                  disabled={isPending || !quote}
                  onClick={handleSave}
                >
                  {isPending ? "Saving..." : "Save Quote & Submit for Approval"}
                </Button>
              </CardFooter>
            )}
          </Card>

          {/* Hint when no matter is linked */}
          {!matterInfo && quote && (
            <p className="text-center text-xs text-muted-foreground">
              Link a matter (via ?matter_id=) to save this quote.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
