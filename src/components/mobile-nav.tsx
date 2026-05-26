"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { LayoutDashboard, Package, FolderKanban, HeartHandshake, Banknote, Ticket, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import { canAccessOrders, canAccessFinance } from "@/lib/role-guards";

function useMobileNavItems() {
  const { data: session } = useSession();
  const role = session?.user?.role;

  const items: { href: string; label: string; icon: React.ElementType }[] = [
    { href: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
    { href: "/agent", label: "Agent", icon: MessageSquareText },
  ];

  if (canAccessOrders(role)) {
    items.push({ href: "/orders", label: "订单", icon: Package });
  }

  items.push(
    { href: "/projects", label: "项目", icon: FolderKanban },
    { href: "/tickets", label: "工单", icon: Ticket },
    { href: "/crm", label: "CRM", icon: HeartHandshake }
  );

  if (canAccessFinance(role)) {
    items.push({ href: "/finance", label: "财务", icon: Banknote });
  }

  return items;
}

export function MobileNav() {
  const pathname = usePathname();
  const navItems = useMobileNavItems();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors",
                isActive
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
