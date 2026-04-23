import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MfaSetup } from "./mfa-setup";
import { MfaVerify } from "./mfa-verify";

export default async function MfaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  // Already at aal2 — MFA is complete, go to dashboard
  if (aal?.currentLevel === "aal2") {
    redirect("/dashboard");
  }

  // Has factors enrolled but not verified this session → show verification
  const needsVerification = aal?.nextLevel === "aal2";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold">
            {needsVerification
              ? "Verify your identity"
              : "Set up two-factor authentication"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {needsVerification
              ? "Enter the code from your authenticator app."
              : "Your role requires two-factor authentication. Scan the QR code with your authenticator app."}
          </p>
        </div>
        {needsVerification ? <MfaVerify /> : <MfaSetup />}
      </div>
    </div>
  );
}
