/**
 * Daily-spend cap for Lex. Reads cumulative `ai_jobs.cost_cents` for today
 * with purpose='lex_chat' and rejects if over the firm's configured cap.
 *
 * Default cap: $20/day/firm (configurable via firm_config.lex_daily_cap_cents).
 * Belt-and-suspenders after the $20K Anthropic mystery — if Lex ever loops,
 * the proxy 429s before it can drain the wallet.
 */

import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

const DEFAULT_CAP_CENTS = 2000; // $20.00/day

export interface BudgetResult {
  allowed: boolean;
  spentCents: number;
  capCents: number;
}

export async function checkLexBudget(
  admin: Admin,
  firmId: string,
): Promise<BudgetResult> {
  const { data: capRow } = await admin
    .from("firm_config")
    .select("value")
    .eq("firm_id", firmId)
    .eq("key", "lex_daily_cap_cents")
    .maybeSingle();
  const capCents =
    typeof (capRow?.value as { value?: number } | null)?.value === "number"
      ? ((capRow!.value as { value: number }).value as number)
      : DEFAULT_CAP_CENTS;

  // Sum today's lex_chat spend (UTC day).
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data: rows } = await admin
    .from("ai_jobs")
    .select("cost_cents")
    .eq("firm_id", firmId)
    .eq("purpose", "lex_chat")
    .gte("created_at", startOfDay.toISOString());

  const spentCents = (rows ?? []).reduce(
    (sum, r) =>
      sum + (typeof r.cost_cents === "number" ? r.cost_cents : Number(r.cost_cents) || 0),
    0,
  );

  return {
    allowed: spentCents < capCents,
    spentCents,
    capCents,
  };
}
