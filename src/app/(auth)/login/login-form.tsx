"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginWithMagicLink, loginWithPassword } from "./actions";

type Mode = "password" | "magic-link";

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("password");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);

    const result =
      mode === "magic-link"
        ? await loginWithMagicLink(formData)
        : await loginWithPassword(formData);

    if (result?.error) {
      setError(result.error);
      setPending(false);
    } else if (mode === "magic-link") {
      setSent(true);
      setPending(false);
    }
    // password login redirects server-side on success
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

      {mode === "password" && (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending
          ? mode === "magic-link"
            ? "Sending link..."
            : "Signing in..."
          : mode === "magic-link"
            ? "Send magic link"
            : "Sign in"}
      </Button>

      <button
        type="button"
        className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setMode(mode === "password" ? "magic-link" : "password")}
      >
        {mode === "password"
          ? "Use magic link instead"
          : "Use password instead"}
      </button>
    </form>
  );
}
