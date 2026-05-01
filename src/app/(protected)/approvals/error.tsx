"use client";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";

export default function ApprovalsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <PageHeader title="Approvals" />
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h3 className="text-sm font-medium text-foreground">
          Something went wrong
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {error.message || "Failed to load approvals."}
        </p>
        <Button variant="outline" size="sm" onClick={reset} className="mt-4">
          Try again
        </Button>
      </div>
    </>
  );
}
