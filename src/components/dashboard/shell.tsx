"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Tenant } from "@/types/database";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  LayoutDashboard,
  Users,
  Settings,
  LogOut,
  Menu,
  FileText,
  Kanban,
  UsersRound,
  ChevronDown,
  ExternalLink,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/leads", label: "All Leads", icon: Users },
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface FormSummary {
  name: string;
  slug: string;
}

interface DashboardShellProps {
  user: User;
  tenant: Tenant;
  role: string;
  formConfigs?: FormSummary[];
  children: React.ReactNode;
}

export function DashboardShell({
  user,
  tenant,
  role,
  formConfigs = [],
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [formsExpanded, setFormsExpanded] = useState(false);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const hasManyForms = formConfigs.length > 1;

  const navContent = (
    <div className="flex flex-col h-full">
      <div className="p-4">
        <div className="flex items-center gap-2">
          <div
            className="h-8 w-8 rounded-md flex items-center justify-center text-white text-sm font-bold"
            style={{ backgroundColor: tenant.primary_color }}
          >
            {tenant.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{tenant.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{role}</p>
          </div>
        </div>
      </div>
      <Separator />
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        {hasManyForms ? (
          <div>
            <button
              onClick={() => setFormsExpanded(!formsExpanded)}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full"
            >
              <FileText className="h-4 w-4" />
              <span className="flex-1 text-left">Public Forms</span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${formsExpanded ? "rotate-180" : ""}`}
              />
            </button>
            {formsExpanded && (
              <div className="ml-4 pl-3 border-l space-y-0.5 mt-0.5">
                {formConfigs.map((form) => (
                  <a
                    key={form.slug}
                    href={`/form/${tenant.slug}/${form.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <span className="flex-1 truncate">{form.name}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                  </a>
                ))}
              </div>
            )}
          </div>
        ) : (
          <a
            href={`/form/${tenant.slug}${formConfigs[0] ? `/${formConfigs[0].slug}` : ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <FileText className="h-4 w-4" />
            View Public Form
          </a>
        )}
      </nav>
      <Separator />
      <div className="p-4">
        <p className="text-xs text-muted-foreground truncate mb-2">
          {user.email}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-card">
        {navContent}
      </aside>

      {/* Mobile header + sheet */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <div
              className="h-7 w-7 rounded-md flex items-center justify-center text-white text-xs font-bold"
              style={{ backgroundColor: tenant.primary_color }}
            >
              {tenant.name.charAt(0)}
            </div>
            <span className="text-sm font-semibold">{tenant.name}</span>
          </div>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              {navContent}
            </SheetContent>
          </Sheet>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
