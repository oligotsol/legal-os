"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "./actions";

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);

    const result = await login(formData);

    if (result?.error) {
      setError(result.error);
      setPending(false);
    } else {
      setSent(true);
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border p-6 text-center">
        <p className="font-medium">Check your email</p>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a magic link to your email address. Click the link to sign in.
        </p>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          autoComplete="email"
          autoFocus
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending link..." : "Send magic link"}
      </Button>
    </form>
  );
}
