import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/sidebar";
import type { UserRole } from "@/types/database";

const MFA_REQUIRED_ROLES: UserRole[] = [
  "owner",
  "attorney",
  "paralegal",
  "assistant",
];

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: memberships } = await supabase
    .from("firm_users")
    .select("role, firms(id, name, slug)")
    .eq("user_id", user.id);

  // MFA enforcement disabled for local development / demo.
  // Re-enable once Supabase site URL is configured for production.
  // const requiresMfa = memberships?.some((m) =>
  //   MFA_REQUIRED_ROLES.includes(m.role as UserRole)
  // );
  // if (requiresMfa) {
  //   const { data: aal } =
  //     await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  //   if (aal && aal.nextLevel === "aal1") {
  //     redirect("/mfa");
  //   }
  // }

  const firm = memberships?.[0]?.firms;
  const firmName =
    firm && typeof firm === "object" && "name" in firm
      ? (firm.name as string)
      : "Legal OS";

  // Pending approval count for sidebar badge
  const { count: pendingApprovalCount } = await supabase
    .from("approval_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  // Read sidebar collapse preference from cookie
  const cookieStore = await cookies();
  const collapsed = cookieStore.get("sidebar_collapsed")?.value === "true";

  // Get user profile for display
  const { data: profile } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        firmName={firmName}
        userEmail={user.email ?? ""}
        userFullName={profile?.full_name ?? null}
        pendingApprovalCount={pendingApprovalCount ?? 0}
        collapsed={collapsed}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
