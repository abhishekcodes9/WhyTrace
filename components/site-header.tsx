"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Search, SlidersHorizontal, X } from "lucide-react";
import { SettingsDrawer } from "./settings-drawer";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "HOME" },
  { href: "/investigate", label: "INVESTIGATE" },
  { href: "/board", label: "EVIDENCE BOARD" },
  { href: "/files", label: "CASE FILES" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/investigate") return pathname.startsWith("/investigate") || pathname.startsWith("/report");
  return pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-outline-variant bg-surface-container-low/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-page-margin">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="WHYTRACE home">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-primary/50 bg-surface-container-high text-primary transition-colors group-hover:border-primary">
              <Search className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="font-display text-headline-sm tracking-wide text-on-surface">WHYTRACE</span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "border-b-2 py-1 font-label text-label-md uppercase tracking-[0.12em] transition-colors duration-150",
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-on-surface-variant hover:text-on-surface",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded border border-outline-variant bg-surface-container text-on-surface-variant transition-colors hover:border-primary/60 hover:text-primary"
              aria-label="Open diagnostics and settings"
              title="Diagnostics & settings"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => setMobileOpen((value) => !value)}
              className="flex h-10 w-10 items-center justify-center rounded border border-outline-variant bg-surface-container text-on-surface-variant hover:text-primary md:hidden"
              aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <div className="border-t border-outline-variant bg-surface-container px-4 py-3 md:hidden">
            <nav aria-label="Mobile primary" className="flex flex-col gap-1">
              {NAV.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded px-2 py-2.5 font-label text-label-md uppercase tracking-wider",
                      active ? "bg-surface-container-high text-primary" : "text-on-surface-variant hover:text-on-surface",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        ) : null}
      </header>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
