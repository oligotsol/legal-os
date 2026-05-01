"use client";

import { useRouter } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

interface SidebarToggleProps {
  collapsed: boolean;
}

export function SidebarToggle({ collapsed }: SidebarToggleProps) {
  const router = useRouter();

  function toggle() {
    document.cookie = `sidebar_collapsed=${!collapsed}; path=/; max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  }

  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <button
      onClick={toggle}
      className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
