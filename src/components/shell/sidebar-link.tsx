"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SidebarLinkProps {
  href: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  count?: number;
}

export function SidebarLink({
  href,
  label,
  icon: Icon,
  collapsed,
  count,
}: SidebarLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={`
        group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium
        transition-all duration-200 ease-out
        ${
          isActive
            ? "bg-gradient-to-r from-sidebar-primary/10 to-sidebar-primary/0 text-sidebar-primary"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
        }
        ${collapsed ? "justify-center px-2" : ""}
      `}
    >
      {/* Active indicator pill — animates in width on activation. */}
      <span
        aria-hidden
        className={`
          absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary
          transition-all duration-300 ease-out
          ${isActive ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0"}
        `}
      />
      <Icon
        className={`
          h-[18px] w-[18px] shrink-0 transition-transform duration-200
          ${isActive ? "" : "group-hover:scale-110"}
        `}
      />
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {count !== undefined && count > 0 && (
            <Badge
              variant="secondary"
              className={`
                ml-auto h-5 min-w-5 justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums
                transition-colors
                ${isActive ? "bg-sidebar-primary/15 text-sidebar-primary" : ""}
              `}
            >
              {count}
            </Badge>
          )}
        </>
      )}
    </Link>
  );
}
