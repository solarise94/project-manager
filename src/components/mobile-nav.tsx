"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Ticket, User, Users, Handshake, Contact } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";

const baseNavItems = [
  { href: "/dashboard", label: "看板", icon: LayoutDashboard },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/tickets", label: "工单", icon: Ticket },
  { href: "/profile", label: "我的", icon: User },
];

export function MobileNav() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const navItems = [...baseNavItems];
  if (session?.user?.role !== "REPRESENTATIVE") {
    navItems.splice(3, 0, { href: "/customers", label: "客户", icon: Contact });
  }
  if (session?.user?.role === "ADMIN") {
    navItems.splice(navItems.length - 1, 0, { href: "/admin/users", label: "用户", icon: Users });
    navItems.splice(navItems.length - 1, 0, { href: "/admin/representatives", label: "代表", icon: Handshake });
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur md:hidden">
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
