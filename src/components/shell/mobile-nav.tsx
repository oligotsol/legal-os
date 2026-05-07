"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  UserPlus,
  ShieldCheck,
  Kanban,
  MessageSquare,
  FileSignature,
  Menu,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SidebarLink } from "./sidebar-link";
import { SidebarUserMenu } from "./sidebar-user-menu";

interface MobileNavProps {
  firmName: string;
  userEmail: string;
  userFullName: string | null;
  pendingApprovalCount: number;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: UserPlus },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/engagements", label: "Engagements", icon: FileSignature },
] as const;

/**
 * Mobile-only top bar with a hamburger that slides the nav in from the left.
 * Hidden at md+ where the desktop sidebar takes over.
 */
export function MobileNav({
  firmName,
  userEmail,
  userFullName,
  pendingApprovalCount,
}: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Top bar — sticky, mobile only */}
      <div className="glass-header sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-border/60 px-3 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 -ml-1"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-sidebar-primary to-sidebar-primary/70 text-[10px] font-bold tracking-tight text-sidebar-primary-foreground shadow-sm"
          >
            {firmName
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase())
              .join("") || "·"}
          </span>
          <span className="truncate text-sm font-semibold tracking-tight">
            {firmName}
          </span>
        </div>
        {pendingApprovalCount > 0 && (
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground tabular-nums animate-soft-pulse">
            {pendingApprovalCount}
          </span>
        )}
      </div>

      {/* Drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="flex w-72 flex-col gap-0 bg-sidebar p-0"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>

          {/* Header: brand + close */}
          <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
            <span
              aria-hidden
              className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-sidebar-primary to-sidebar-primary/70 text-[11px] font-bold tracking-tight text-sidebar-primary-foreground shadow-sm"
            >
              {firmName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase())
                .join("") || "·"}
              <span
                aria-hidden
                className="absolute -right-0.5 -bottom-0.5 flex h-2.5 w-2.5"
              >
                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-soft-pulse" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-sidebar" />
              </span>
            </span>
            <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
              {firmName}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Nav — close drawer on link click */}
          <nav
            className="flex-1 space-y-1 px-3 py-4"
            onClick={() => setOpen(false)}
          >
            {NAV_ITEMS.map((item) => (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                collapsed={false}
                count={
                  item.href === "/approvals" ? pendingApprovalCount : undefined
                }
              />
            ))}
          </nav>

          {/* User menu */}
          <div className="border-t border-sidebar-border px-3 py-3">
            <SidebarUserMenu
              email={userEmail}
              fullName={userFullName}
              collapsed={false}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
