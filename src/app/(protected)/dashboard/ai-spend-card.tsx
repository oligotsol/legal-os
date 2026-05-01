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

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Spend (30 days)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex items-baseline gap-2">
          <span
            className={`text-2xl font-semibold tabular-nums ${
              isOverBudget
                ? "text-red-600"
                : isNearBudget
                  ? "text-amber-600"
                  : ""
            }`}
          >
            ${totalDollars.toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">
            / ${budgetDollars.toFixed(0)} budget
          </span>
        </div>

        {isOverBudget && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
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
