"use client";

import { useSession } from "next-auth/react";
import { FlaskConical, Menu } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Sidebar } from "./sidebar";
import { NotificationCenter } from "./notification-center";

export function Header() {
  const { data: session } = useSession();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b bg-background/95 backdrop-blur px-4 md:px-8">
      <Sheet>
        <SheetTrigger className="md:hidden">
          <Button variant="ghost" size="icon" className="shrink-0">
            <Menu className="h-5 w-5" />
            <span className="sr-only">打开菜单</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64">
          <Sidebar />
        </SheetContent>
      </Sheet>

      <div className="flex md:hidden items-center gap-2">
        <FlaskConical className="h-5 w-5 text-primary" />
        <span className="font-bold">SciManage</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {user && (
          <>
            <NotificationCenter />
            <div className="flex items-center gap-3 pl-2 border-l">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-medium leading-none">{user.name}</span>
                <span className="text-xs text-muted-foreground">{user.email}</span>
              </div>
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {user.name?.slice(0, 2)?.toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
