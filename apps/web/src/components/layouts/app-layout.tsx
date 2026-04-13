import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";

import { ModeToggle } from "#/components/mode-toggle";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "#/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";

const HEADER_HEIGHT = "3.5rem";

function SidebarTriggerWithTooltip() {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarTrigger className="size-9" />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
        <span>Toggle sidebar</span>
        <kbd className="rounded border border-background/20 bg-background/10 px-1.5 py-0.5 font-sans text-[10px] font-medium">
          {isMac ? "⌘" : "Ctrl"} B
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider
      className="flex-col"
      style={{ "--header-height": HEADER_HEIGHT } as CSSProperties}
    >
      <header className="sticky top-0 z-30 flex h-(--header-height) w-full items-center border-b bg-primary/95 px-4 text-primary-foreground backdrop-blur-lg">
        <nav className="flex w-full flex-nowrap items-center gap-x-3">
          <div className="flex-1">
            <SidebarTriggerWithTooltip />
          </div>
          <div className="flex flex-1 flex-nowrap justify-center">
            <Link to="/" className="text-center">
              <img src="/logo192.png" alt="Logo" className="h-8 w-auto" />
            </Link>
          </div>
          <div className="flex flex-1 flex-nowrap flex-row-reverse gap-x-2">
            <Avatar>
              <AvatarFallback>?</AvatarFallback>
            </Avatar>
            <ModeToggle />
          </div>
        </nav>
      </header>
      <div className="flex flex-1">
        <Sidebar
          variant="sidebar"
          collapsible="icon"
          className="top-(--header-height) h-[calc(100svh-var(--header-height))]"
        >
          <SidebarHeader></SidebarHeader>
          <SidebarContent></SidebarContent>
          <SidebarFooter />
          <SidebarRail />
        </Sidebar>
        <SidebarInset>{children}</SidebarInset>
      </div>
    </SidebarProvider>
  );
}
