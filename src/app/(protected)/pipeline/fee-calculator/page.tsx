import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { FeeCalculatorForm } from "./fee-calculator-form";
import type { Service, ServiceBundle, DiscountTier } from "@/types/database";

interface FeeCalculatorPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function FeeCalculatorPage({
  searchParams,
}: FeeCalculatorPageProps) {
  const params = await searchParams;
  const matterId = params.matter_id ?? null;

  const supabase = await createClient();

  // Fetch catalog data (RLS-scoped to the user's firm)
  const [servicesRes, bundlesRes, tiersRes] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("status", "active")
      .order("category")
      .order("name"),
    supabase.from("service_bundles").select("*").order("name"),
    supabase.from("discount_tiers").select("*").order("engagement_threshold"),
  ]);

  const services = (servicesRes.data ?? []) as Service[];
  const bundles = (bundlesRes.data ?? []) as ServiceBundle[];
  const discountTiers = (tiersRes.data ?? []) as DiscountTier[];

  // Optionally fetch matter + contact info
  let matterInfo: {
    id: string;
    contactName: string | null;
    matterType: string | null;
    contactId: string | null;
  } | null = null;

  if (matterId) {
    const { data: matter } = await supabase
      .from("matters")
      .select("id, matter_type, contact_id")
      .eq("id", matterId)
      .single();

    if (matter) {
      let contactName: string | null = null;
      if (matter.contact_id) {
        const { data: contact } = await supabase
          .from("contacts")
          .select("full_name")
          .eq("id", matter.contact_id)
          .single();
        contactName = contact?.full_name ?? null;
      }

      matterInfo = {
        id: matter.id,
        contactName,
        matterType: matter.matter_type,
        contactId: matter.contact_id,
      };
    }
  }

  const description = matterInfo
    ? `Build a quote for ${matterInfo.contactName ?? "this matter"}`
    : "Build a quote by selecting services";

  return (
    <>
      <PageHeader title="Fee Calculator" description={description} />
      <FeeCalculatorForm
        services={services}
        bundles={bundles}
        discountTiers={discountTiers}
        matterInfo={matterInfo}
      />
    </>
  );
}
