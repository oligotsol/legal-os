"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function MfaSetup() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function enroll() {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator App",
      });

      if (error) {
        setError(error.message);
        return;
      }

      setQrCode(data.totp.qr_code);
      setFactorId(data.id);
    }

    enroll();
  }, [supabase.auth.mfa]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;

    setPending(true);
    setError(null);

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

  if (!qrCode) {
    return (
      <div className="text-center text-sm text-muted-foreground">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : (
          "Loading..."
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      <div className="flex justify-center">
        {/* QR code is a data URI from Supabase */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrCode} alt="TOTP QR code" className="h-48 w-48" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="totp-code">Verification code</Label>
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
        {pending ? "Verifying..." : "Verify and enable"}
      </Button>
    </form>
  );
}
