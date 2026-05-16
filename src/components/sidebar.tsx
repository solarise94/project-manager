"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Ticket,
  LogOut,
  FlaskConical,
  Users,
  User,
  FileText,
  HeartHandshake,
  Banknote,
  Package,
  UserCog,
  MapPin,
  Link2,
  Radio,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { canAccessOrders, canAccessFinance } from "@/lib/role-guards";

type NavItem = { href: string; label: string; icon: React.ElementType };

interface NavGroup {
  title: string;
  items: NavItem[];
}

function useNavGroups(): NavGroup[] {
  const { data: session } = useSession();
  const role = session?.user?.role;

  const core: NavGroup = {
    title: "核心业务",
    items: [{ href: "/dashboard", label: "仪表盘", icon: LayoutDashboard }],
  };
  if (canAccessOrders(role)) {
    core.items.push({ href: "/orders", label: "订单管理", icon: Package });
  }
  core.items.push(
    { href: "/projects", label: "项目", icon: FolderKanban },
    { href: "/tickets", label: "工单", icon: Ticket }
  );

  const ops: NavGroup = {
    title: "运营模块",
    items: [
      { href: "/crm", label: "CRM 管理", icon: HeartHandshake },
      { href: "/crm/representatives", label: "代表运营", icon: Radio },
    ],
  };
  if (canAccessFinance(role)) {
    ops.items.push({ href: "/finance", label: "财务管理", icon: Banknote });
  }

  const groups: NavGroup[] = [core, ops];

  if (role === "ADMIN") {
    groups.push({
      title: "系统管理",
      items: [
        { href: "/admin/users", label: "用户管理", icon: Users },
        { href: "/admin/representatives", label: "代表账号管理", icon: UserCog },
        { href: "/admin/representative-regions", label: "地区管理", icon: MapPin },
        { href: "/admin/representative-organizations", label: "绑定审核", icon: Link2 },
        { href: "/admin/dev-logs", label: "开发日志", icon: FileText },
      ],
    });
  }

  return groups;
}

function NavLink({
  item,
  isActive,
  onClick,
  indent = false,
}: {
  item: NavItem;
  isActive: boolean;
  onClick?: () => void;
  indent?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        indent && "pl-9"
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}

export function Sidebar({ mobile, onNavClick }: { mobile?: boolean; onNavClick?: () => void }) {
  const pathname = usePathname();
  const groups = useNavGroups();

  return (
    <aside
      className={cn(
        "w-64 flex-col bg-muted/30 h-screen sticky top-0",
        mobile ? "flex h-full" : "hidden md:flex border-r"
      )}
    >
      <div className="flex h-16 items-center gap-2 px-6 border-b">
        <FlaskConical className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold tracking-tight">SciManage</span>
      </div>
      <nav className="flex-1 px-4 py-4 space-y-6 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {group.title}
            </p>
            {group.items.map((item) => {
              const isActive = item.href === "/crm" ? pathname === "/crm" : pathname.startsWith(item.href);
              return (
                <NavLink
                  key={item.href}
                  item={item}
                  isActive={isActive}
                  onClick={onNavClick}
                />
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t p-4 space-y-1">
        <Link
          href="/profile"
          onClick={onNavClick}
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
          onClick={() => {
            onNavClick?.();
            signOut({ callbackUrl: "/login" });
          }}
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </Button>
      </div>
    </aside>
  );
}
