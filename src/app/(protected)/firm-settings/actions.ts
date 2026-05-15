"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ADMIN_ROLES = new Set(["owner", "attorney"]);

interface ActorInfo {
  userId: string;
  firmId: string;
  role: string;
}

async function getAdminActor(): Promise<ActorInfo> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("firm_users")
    .select("firm_id, role")
    .eq("user_id", user.id)
    .single();
  if (!membership) throw new Error("User does not belong to a firm");
  if (!ADMIN_ROLES.has(membership.role)) {
    throw new Error(`Role "${membership.role}" cannot edit firm settings`);
  }
  return { userId: user.id, firmId: membership.firm_id, role: membership.role };
}

async function upsertFirmConfig(
  firmId: string,
  actorId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", key)
    .maybeSingle();

  const { error } = await admin
    .from("firm_config")
    .upsert(
      { firm_id: firmId, key, value },
      { onConflict: "firm_id,key" },
    );
  if (error) throw new Error(`Failed to upsert firm_config.${key}: ${error.message}`);

  await admin.rpc("insert_audit_log", {
    p_firm_id: firmId,
    p_actor_id: actorId,
    p_action: "firm_config.updated",
    p_entity_type: "firm_config",
    p_entity_id: null,
    p_before: existing ? { key, value: existing.value } : null,
    p_after: { key, value },
    p_metadata: null,
  });
}

// ---------------------------------------------------------------------------
// Update firm identity (legal_name, address, phone, fax, email, website)
// ---------------------------------------------------------------------------

export async function updateFirmIdentity(formData: FormData): Promise<void> {
  const { userId, firmId } = await getAdminActor();
  const value = {
    legal_name: (formData.get("legal_name") as string)?.trim() ?? "",
    address: (formData.get("address") as string)?.trim() ?? "",
    phone: (formData.get("phone") as string)?.trim() ?? "",
    fax: (formData.get("fax") as string)?.trim() ?? "",
    email: (formData.get("email") as string)?.trim() ?? "",
    website: (formData.get("website") as string)?.trim() ?? "",
  };
  for (const [k, v] of Object.entries(value)) {
    if (!v) throw new Error(`firm_identity.${k} is required`);
  }
  await upsertFirmConfig(firmId, userId, "firm_identity", value);
  revalidatePath("/firm-settings");
}

// ---------------------------------------------------------------------------
// Update branding (logo_url, primary_color, secondary_color, font_family)
// ---------------------------------------------------------------------------

export async function updateBranding(formData: FormData): Promise<void> {
  const { userId, firmId } = await getAdminActor();
  const value = {
    logo_url: ((formData.get("logo_url") as string) || "").trim() || null,
    primary_color: (formData.get("primary_color") as string)?.trim() ?? "#000000",
    secondary_color: (formData.get("secondary_color") as string)?.trim() ?? "#666666",
    font_family: (formData.get("font_family") as string)?.trim() ?? "Georgia, serif",
  };
  await upsertFirmConfig(firmId, userId, "branding", value);
  revalidatePath("/firm-settings");
}

// ---------------------------------------------------------------------------
// Upload logo to Supabase Storage and return the public URL
// ---------------------------------------------------------------------------

const LOGO_BUCKET = "firm-assets";

export async function uploadLogo(formData: FormData): Promise<string> {
  const { firmId } = await getAdminActor();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Missing file");
  if (file.size > 4 * 1024 * 1024) {
    throw new Error("Logo must be 4MB or smaller");
  }

  const admin = createAdminClient();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${firmId}/logo-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage
    .from(LOGO_BUCKET)
    .upload(path, buf, {
      contentType: file.type || "image/png",
      upsert: false,
    });
  if (uploadErr) throw new Error(`Logo upload failed: ${uploadErr.message}`);

  const { data: publicUrl } = admin.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return publicUrl.publicUrl;
}
