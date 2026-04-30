"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Ticket, LogOut, FlaskConical, Users, User, Contact, Building2, ClipboardList, FileText, Receipt, ShoppingBag, HeartHandshake, Store } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const baseNavItems = [
  { href: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/tickets", label: "工单", icon: Ticket },
  { href: "/crm", label: "CRM", icon: HeartHandshake },
];

function useNavItems() {
  const { data: session } = useSession();
  const items = [...baseNavItems];
  if (session?.user?.role !== "REPRESENTATIVE") {
    items.push({ href: "/customers", label: "客户管理", icon: Contact });
    items.push({ href: "/external-orders", label: "外部订单", icon: ShoppingBag });
  }
  if (session?.user?.role === "ADMIN") {
    items.push({ href: "/admin/users", label: "用户管理", icon: Users });
    items.push({ href: "/admin/organizations", label: "单位主数据", icon: Building2 });
    items.push({ href: "/admin/organization-reviews", label: "单位复核", icon: ClipboardList });
    items.push({ href: "/admin/billing-profiles", label: "开票主体", icon: Receipt });
    items.push({ href: "/admin/procurement-channels", label: "采购渠道", icon: Store });
    items.push({ href: "/admin/dev-logs", label: "开发日志", icon: FileText });
  }
  return items;
}

export function Sidebar() {
  const pathname = usePathname();
  const navItems = useNavItems();

  return (
    <aside className="hidden md:flex w-64 flex-col border-r bg-muted/30 h-screen sticky top-0">
      <div className="flex h-16 items-center gap-2 px-6 border-b">
        <FlaskConical className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold tracking-tight">SciManage</span>
      </div>
      <nav className="flex-1 px-4 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4 space-y-1">
        <Link
          href="/profile"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            pathname.startsWith("/profile")
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <User className="h-4 w-4" />
          我的
        </Link>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </Button>
      </div>
    </aside>
  );
}
