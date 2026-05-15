import { PhoneCall, PhoneIncoming, FileCheck2, MessageCircle } from "lucide-react";
import type { DialerFunnel } from "./queries";

export function DialerFunnelCard({ funnel }: { funnel: DialerFunnel }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Dialer funnel</h2>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Calls → Connected → Matters
        </span>
      </div>
      <div className="space-y-4 p-4">
        {/* Today funnel — primary visual */}
        <div className="space-y-2">
          <div className="flex items-end justify-between gap-2 text-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Today
            </span>
            <div className="flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
              <span>
                Connect:{" "}
                <span className="font-semibold text-foreground">
                  {funnel.todayRates.connectRate ?? "—"}
                  {funnel.todayRates.connectRate !== null && "%"}
                </span>
              </span>
              <span>
                Convert:{" "}
                <span className="font-semibold text-foreground">
                  {funnel.todayRates.convertRate ?? "—"}
                  {funnel.todayRates.convertRate !== null && "%"}
                </span>
              </span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <FunnelTile
              icon={<PhoneCall className="h-3.5 w-3.5" />}
              label="Calls"
              value={funnel.today.callsPlaced}
              tone="primary"
            />
            <FunnelTile
              icon={<MessageCircle className="h-3.5 w-3.5" />}
              label="No-ans"
              value={funnel.today.noAnswers}
              tone="muted"
            />
            <FunnelTile
              icon={<PhoneIncoming className="h-3.5 w-3.5" />}
              label="Connected"
              value={funnel.today.connected}
              tone="success"
            />
            <FunnelTile
              icon={<FileCheck2 className="h-3.5 w-3.5" />}
              label="Matters"
              value={funnel.today.matters}
              tone="success"
            />
          </div>
        </div>

        {/* 7-day + 30-day rows — compact comparison */}
        <div className="space-y-1 border-t pt-3 text-xs">
          <WindowRow label="Last 7d" w={funnel.last7d} />
          <WindowRow label="Last 30d" w={funnel.last30d} />
        </div>
      </div>
    </div>
  );
}

function FunnelTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "primary" | "success" | "muted";
}) {
  const styles: Record<typeof tone, string> = {
    primary: "border-primary/30 bg-primary/[0.06] text-foreground",
    success:
      "border-emerald-300/60 bg-emerald-50/40 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200 dark:border-emerald-900/60",
    muted: "border-border bg-muted/30 text-foreground",
  };
  return (
    <div
      className={`flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 ${styles[tone]}`}
    >
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
    </div>
  );
}

function WindowRow({
  label,
  w,
}: {
  label: string;
  w: { callsPlaced: number; connected: number; matters: number; noAnswers: number };
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center justify-between gap-3 tabular-nums">
        <span>
          <span className="text-muted-foreground">Calls:</span>{" "}
          <span className="font-semibold">{w.callsPlaced}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Connected:</span>{" "}
          <span className="font-semibold">{w.connected}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Matters:</span>{" "}
          <span className="font-semibold">{w.matters}</span>
        </span>
      </div>
    </div>
  );
}
