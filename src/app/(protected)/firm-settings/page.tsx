import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FirmSettingsForm } from "./firm-settings-form";

const ADMIN_ROLES = new Set(["owner", "attorney"]);

interface FirmIdentity {
  legal_name: string;
  address: string;
  phone: string;
  fax: string;
  email: string;
  website: string;
}

interface Branding {
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  font_family: string;
}

const DEFAULT_IDENTITY: FirmIdentity = {
  legal_name: "",
  address: "",
  phone: "",
  fax: "",
  email: "",
  website: "",
};

const DEFAULT_BRANDING: Branding = {
  logo_url: null,
  primary_color: "#1a1a1a",
  secondary_color: "#6b7280",
  font_family: "Georgia, serif",
};

export default async function FirmSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id, role")
    .eq("user_id", user.id)
    .single();
  if (!membership) redirect("/login");
  if (!ADMIN_ROLES.has(membership.role)) {
    return (
      <div className="px-6 py-10">
        <h1 className="text-2xl font-semibold">Firm Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only owners and attorneys can edit firm settings.
        </p>
      </div>
    );
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("firm_config")
    .select("key, value")
    .eq("firm_id", membership.firm_id)
    .in("key", ["firm_identity", "branding"]);

  const byKey = new Map<string, unknown>();
  for (const r of rows ?? []) byKey.set(r.key, r.value);

  const identity = (byKey.get("firm_identity") as FirmIdentity | undefined) ?? DEFAULT_IDENTITY;
  const branding = (byKey.get("branding") as Branding | undefined) ?? DEFAULT_BRANDING;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Firm Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Identity and branding used on engagement letters and outbound documents.
        </p>
      </header>
      <FirmSettingsForm identity={identity} branding={branding} />
    </div>
  );
}
