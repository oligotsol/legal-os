"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createLead } from "../actions";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

const SOURCES = [
  { value: "manual", label: "Manual Entry" },
  { value: "referral", label: "Referral" },
] as const;

export default function CreateLeadPage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const fullName = (formData.get("fullName") as string)?.trim();
    const email = (formData.get("email") as string)?.trim();
    const phone = (formData.get("phone") as string)?.trim();

    if (!fullName) {
      setError("Name is required");
      return;
    }
    if (!email && !phone) {
      setError("At least one of email or phone is required");
      return;
    }

    startTransition(async () => {
      try {
        const result = await createLead(formData);
        router.push(`/conversations?id=${result.conversationId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create lead");
      }
    });
  }

  return (
    <>
      <PageHeader
        title="New Lead"
        description="Manually add a lead from a phone call, walk-in, or referral"
      />
      <div className="mx-auto max-w-lg p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium">
              Full Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="fullName"
              name="fullName"
              placeholder="John Doe"
              required
              disabled={isPending}
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="john@example.com"
              disabled={isPending}
            />
          </div>

          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium">
              Phone
            </label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              placeholder="+15551234567"
              disabled={isPending}
            />
          </div>

          <div>
            <label htmlFor="state" className="mb-1.5 block text-sm font-medium">
              State
            </label>
            <select
              id="state"
              name="state"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isPending}
              defaultValue=""
            >
              <option value="">Select state...</option>
              {US_STATES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="source" className="mb-1.5 block text-sm font-medium">
              Source
            </label>
            <select
              id="source"
              name="source"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isPending}
              defaultValue="manual"
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="notes" className="mb-1.5 block text-sm font-medium">
              Notes
            </label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="Any relevant details from the call or walk-in..."
              rows={3}
              disabled={isPending}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create Lead"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => router.push("/leads")}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
