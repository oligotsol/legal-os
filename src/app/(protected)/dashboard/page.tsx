import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch firm memberships via RLS — user only sees firms they belong to
  const { data: memberships } = await supabase
    .from("firm_users")
    .select("role, firms(id, name, slug)")
    .eq("user_id", user!.id);

  const firm = memberships?.[0]?.firms;
  const role = memberships?.[0]?.role;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="text-center text-sm text-muted-foreground">
        <p>Signed in as {user?.email}</p>
        {firm && (
          <p className="mt-1">
            {typeof firm === "object" && "name" in firm ? firm.name : "Unknown firm"} &middot;{" "}
            {role}
          </p>
        )}
        {!firm && (
          <p className="mt-1">No firm membership found</p>
        )}
      </div>
      <SignOutButton />
    </div>
  );
}
