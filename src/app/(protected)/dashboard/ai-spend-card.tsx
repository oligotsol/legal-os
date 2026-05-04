import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiSpendItem } from "./queries";

const PURPOSE_LABELS: Record<string, string> = {
  classify: "Classification",
  converse: "Conversation",
  draft: "Drafting",
  judgment: "Judgment",
};

const MONTHLY_BUDGET_CENTS = 20000; // $200/month alert threshold

export function AiSpendCard({
  items,
  totalCostCents,
}: {
  items: AiSpendItem[];
  totalCostCents: number;
}) {
  const totalDollars = totalCostCents / 100;
  const budgetDollars = MONTHLY_BUDGET_CENTS / 100;
  const isOverBudget = totalCostCents > MONTHLY_BUDGET_CENTS;
  const isNearBudget = totalCostCents > MONTHLY_BUDGET_CENTS * 0.8;

  const pct = Math.min(100, Math.round((totalCostCents / MONTHLY_BUDGET_CENTS) * 100));

  return (
    <Card className="relative overflow-hidden border-border/60 bg-card/80 backdrop-blur-sm transition-shadow hover:shadow-md hover:shadow-foreground/5">
      <CardHeader>
        <CardTitle>AI Spend (30 days)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex items-baseline gap-2">
          <span
            className={`bg-gradient-to-br bg-clip-text text-3xl font-semibold tabular-nums tracking-tight text-transparent ${
              isOverBudget
                ? "from-red-600 to-red-500"
                : isNearBudget
                  ? "from-amber-600 to-amber-400"
                  : "from-foreground to-foreground/70"
            }`}
          >
            ${totalDollars.toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">
            / ${budgetDollars.toFixed(0)} budget
          </span>
        </div>

        {/* Budget progress bar */}
        <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-muted/50">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              isOverBudget
                ? "bg-gradient-to-r from-red-500 to-red-600"
                : isNearBudget
                  ? "bg-gradient-to-r from-amber-400 to-amber-500"
                  : "bg-gradient-to-r from-primary/80 to-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {isOverBudget && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
            AI spend exceeds monthly budget threshold.
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI usage this period.</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => (
              <div
                key={item.purpose}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">
                  {PURPOSE_LABELS[item.purpose] ?? item.purpose}
                </span>
                <span className="tabular-nums">
                  ${(item.totalCostCents / 100).toFixed(2)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({item.jobCount})
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
