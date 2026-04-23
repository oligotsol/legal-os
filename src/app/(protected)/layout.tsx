import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  // Check if user has a role that requires MFA enrollment
  const { data: memberships } = await supabase
    .from("firm_users")
    .select("role")
    .eq("user_id", user.id);

  const requiresMfa = memberships?.some((m) =>
    MFA_REQUIRED_ROLES.includes(m.role as UserRole)
  );

  if (requiresMfa) {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    // User needs MFA but hasn't enrolled any factors yet
    if (aal && aal.nextLevel === "aal1") {
      redirect("/mfa");
    }
  }

  return <>{children}</>;
}
