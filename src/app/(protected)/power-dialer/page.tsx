import { PageHeader } from "@/components/shell/page-header";
import { createClient } from "@/lib/supabase/server";
import { DialerQueue } from "./dialer-queue";
import {
  fetchDialerFirmConfig,
  fetchDialerQueue,
  fetchDialerSourceBreakdown,
} from "./queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ source?: string; list?: string }>;
}

export default async function PowerDialerPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const supabase = await createClient();

  const filter = {
    source: sp.source && sp.source !== "all" ? sp.source : undefined,
    listName: sp.list && sp.list !== "all" ? sp.list : undefined,
  };

  const [queue, config, sources] = await Promise.all([
    fetchDialerQueue(supabase, filter),
    fetchDialerFirmConfig(supabase),
    fetchDialerSourceBreakdown(supabase),
  ]);

  const activeFilterKey =
    filter.source && filter.listName
      ? `${filter.source}::${filter.listName}`
      : filter.source
        ? `${filter.source}::_`
        : "all";

  return (
    <>
      <PageHeader
        title="Power Dialer"
        description={`${queue.length} ready to dial · Connected opens lead · No-answer cadence runs automatically`}
      />
      <div className="space-y-4 p-6">
        {/*
          `key={activeFilterKey}` forces the DialerQueue to remount when
          the filter changes. Without this, the in-component useReducer
          state (which holds `queue` after mount) ignores new server-passed
          props, so filtering "did nothing".
        */}
        <DialerQueue
          key={activeFilterKey}
          queue={queue}
          config={config}
          sources={sources}
          activeFilterKey={activeFilterKey}
        />
      </div>
    </>
  );
}
