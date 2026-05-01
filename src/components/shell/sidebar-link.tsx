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
        group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150
        ${
          isActive
            ? "bg-sidebar-accent text-sidebar-primary border-l-2 border-sidebar-primary -ml-px"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        }
        ${collapsed ? "justify-center px-2" : ""}
      `}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {count !== undefined && count > 0 && (
            <Badge
              variant="secondary"
              className="ml-auto h-5 min-w-5 justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums"
            >
              {count}
            </Badge>
          )}
        </>
      )}
    </Link>
  );
}
