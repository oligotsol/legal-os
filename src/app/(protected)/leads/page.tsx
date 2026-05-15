import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { LeadList } from "./lead-list";
import { CsvImportDialog } from "./csv-import-dialog";
import { ComposeBlastSheet } from "./compose-blast-sheet";
import { DEFAULT_LEADS_PAGE_SIZE, fetchLeadsList } from "./queries";

export const dynamic = "force-dynamic";

interface LeadsPageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const statusFilter = params.status ?? undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const supabase = await createClient();
  const { leads, total, pageSize } = await fetchLeadsList(supabase, {
    status: statusFilter,
    page,
    pageSize: DEFAULT_LEADS_PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  function pageHref(p: number): string {
    const qs = new URLSearchParams();
    if (statusFilter) qs.set("status", statusFilter);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `/leads?${s}` : "/leads";
  }

  return (
    <>
      <PageHeader
        title="Leads"
        description={
          total === 0
            ? "0 leads"
            : `Showing ${from}–${to} of ${total} lead${total === 1 ? "" : "s"}`
        }
        actions={
          <div className="flex items-center gap-2">
            <ComposeBlastSheet />
            <CsvImportDialog />
            <Link href="/leads/create">
              <Button size="sm">New Lead</Button>
            </Link>
          </div>
        }
      />
      <div className="space-y-4 p-6">
        <LeadList leads={leads} />
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <p className="text-muted-foreground tabular-nums">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="inline-flex items-center rounded-md border bg-card px-3 py-1.5 font-medium hover:bg-muted"
                >
                  ← Prev
                </Link>
              ) : (
                <span className="inline-flex items-center rounded-md border px-3 py-1.5 font-medium text-muted-foreground/50">
                  ← Prev
                </span>
              )}
              {page < totalPages ? (
                <Link
                  href={pageHref(page + 1)}
                  className="inline-flex items-center rounded-md border bg-card px-3 py-1.5 font-medium hover:bg-muted"
                >
                  Next →
                </Link>
              ) : (
                <span className="inline-flex items-center rounded-md border px-3 py-1.5 font-medium text-muted-foreground/50">
                  Next →
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
