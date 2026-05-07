"use client";

import {
  LayoutDashboard,
  UserPlus,
  ShieldCheck,
  Kanban,
  MessageSquare,
  FileSignature,
} from "lucide-react";
import { SidebarLink } from "./sidebar-link";
import { SidebarToggle } from "./sidebar-toggle";
import { SidebarUserMenu } from "./sidebar-user-menu";

interface SidebarProps {
  firmName: string;
  userEmail: string;
  userFullName: string | null;
  pendingApprovalCount: number;
  collapsed: boolean;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: UserPlus },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/engagements", label: "Engagements", icon: FileSignature },
] as const;

export function Sidebar({
  firmName,
  userEmail,
  userFullName,
  pendingApprovalCount,
  collapsed,
}: SidebarProps) {
  return (
    <aside
      className={`hidden h-screen flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex ${collapsed ? "w-16" : "w-64"}`}
    >
      {/* Logo / Firm name */}
      <div className={`flex h-14 items-center gap-2.5 border-b border-sidebar-border ${collapsed ? "justify-center px-2" : "px-4"}`}>
        {!collapsed && (
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
            {/* Live indicator — system connected */}
            <span
              aria-hidden
              title="System online"
              className="absolute -right-0.5 -bottom-0.5 flex h-2.5 w-2.5"
            >
              <span className="absolute inset-0 rounded-full bg-emerald-500 animate-soft-pulse" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-sidebar" />
            </span>
          </span>
        )}
        {!collapsed && (
          <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
            {firmName}
          </span>
        )}
        <div className={collapsed ? "" : "ml-auto"}>
          <SidebarToggle collapsed={collapsed} />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => (
          <SidebarLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            collapsed={collapsed}
            count={item.href === "/approvals" ? pendingApprovalCount : undefined}
          />
        ))}
      </nav>

      {/* User menu */}
      <div className="border-t border-sidebar-border px-3 py-3">
        <SidebarUserMenu
          email={userEmail}
          fullName={userFullName}
          collapsed={collapsed}
        />
      </div>
    </aside>
  );
}
