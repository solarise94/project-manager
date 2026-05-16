"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  UserRound,
  FishSymbol,
  ChevronDown,
  ChevronRight,
  UsersRound,
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

interface SubNavGroup {
  title: string;
  href: string;
  icon: React.ElementType;
  children: NavItem[];
}

function useNavGroups(): { groups: NavGroup[]; subGroups: SubNavGroup[]; standalone: NavItem[] } {
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

  // CRM collapsible sub-group
  const crmChildren: NavItem[] = [
    { href: "/crm/customers", label: "客户档案库", icon: UsersRound },
    { href: "/customers", label: "客户主数据", icon: UserRound },
  ];
  if (role !== "REPRESENTATIVE") {
    crmChildren.push({ href: "/crm/customer-pool", label: "客户公海池", icon: FishSymbol });
  }

  const crmSubGroup: SubNavGroup = {
    title: "CRM 管理",
    href: "/crm",
    icon: HeartHandshake,
    children: crmChildren,
  };

  const standalone: NavItem[] = [
    { href: "/crm/representatives", label: "代表运营", icon: Radio },
  ];

  if (canAccessFinance(role)) {
    standalone.push({ href: "/finance", label: "财务管理", icon: Banknote });
  }

  const groups: NavGroup[] = [core];

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

  return { groups, subGroups: [crmSubGroup], standalone };
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
  const { groups, subGroups, standalone } = useNavGroups();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    // Auto-expand if any child is active
    const initial: Record<string, boolean> = {};
    for (const sg of subGroups) {
      if (pathname.startsWith(sg.href) || sg.children.some((c) => pathname.startsWith(c.href))) {
        initial[sg.href] = true;
      }
    }
    return initial;
  });

  const toggle = (href: string) => {
    setExpanded((prev) => ({ ...prev, [href]: !prev[href] }));
  };

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
              const isActive = pathname.startsWith(item.href);
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

        {/* Ops module: collapsible sub-groups + standalone */}
        {(subGroups.length > 0 || standalone.length > 0) && (
          <div className="space-y-1">
            <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              运营模块
            </p>
            {subGroups.map((sg) => {
              const isActive = pathname === sg.href;
              const anyChildActive = sg.children.some((c) => pathname.startsWith(c.href));
              const isOpen = !!expanded[sg.href] || isActive || anyChildActive;
              const Icon = sg.icon;
              return (
                <div key={sg.href}>
                  <button
                    onClick={() => toggle(sg.href)}
                    className={cn(
                      "w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive || anyChildActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4" />
                      {sg.title}
                    </span>
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="space-y-0.5">
                      {sg.children.map((child) => (
                        <NavLink
                          key={child.href}
                          item={child}
                          isActive={pathname.startsWith(child.href)}
                          onClick={onNavClick}
                          indent
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {standalone.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                isActive={pathname.startsWith(item.href)}
                onClick={onNavClick}
              />
            ))}
          </div>
        )}
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
