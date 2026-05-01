import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { LeadList } from "./lead-list";
import { fetchLeadsList } from "./queries";

interface LeadsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const params = await searchParams;
  const statusFilter = params.status ?? undefined;

  const supabase = await createClient();
  const leads = await fetchLeadsList(
    supabase,
    statusFilter ? { status: statusFilter } : undefined,
  );

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${leads.length} lead${leads.length !== 1 ? "s" : ""}`}
        actions={
          <Link href="/leads/create">
            <Button size="sm">New Lead</Button>
          </Link>
        }
      />
      <div className="p-6">
        <LeadList leads={leads} />
      </div>
    </>
  );
}
