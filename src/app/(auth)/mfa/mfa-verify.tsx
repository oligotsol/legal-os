"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function MfaVerify() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    // Get the user's enrolled TOTP factor
    const { data: factors, error: factorsError } =
      await supabase.auth.mfa.listFactors();

    if (factorsError || !factors?.totp?.length) {
      setError("No authenticator found. Please contact support.");
      setPending(false);
      return;
    }

    const factorId = factors.totp[0].id;

    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });

    if (challengeError) {
      setError(challengeError.message);
      setPending(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });

    if (verifyError) {
      setError(verifyError.message);
      setPending(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="totp-code">Authenticator code</Label>
        <Input
          id="totp-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          autoFocus
          required
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={pending || code.length < 6}>
        {pending ? "Verifying..." : "Verify"}
      </Button>
    </form>
  );
}
