"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { useSidebar } from "@/components/SidebarContext";
import { getUsageSummary } from "@/lib/api";
import { UsageSummaryResponse } from "@/types/job";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

const PRIMARY_ITEMS = [
  { href: "/", label: "Dashboard", icon: "grid_view" },
  { href: "/workspace/history", label: "History", icon: "history" },
];

const ORG_ITEMS = [
  { href: "/upgrade", label: "Pricing & Plans", icon: "credit_card" },
  { href: "/workspace/settings", label: "Settings", icon: "settings" },
  { href: "/workspace/contact", label: "Contact Us", icon: "support_agent" },
];

/** Quota meter pinned above the "New Note" button, mirroring the pricing-page design. */
function UsageCard({ collapsed }: { collapsed: boolean }) {
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getUsageSummary()
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch(() => {
        // Non-fatal: the rail still renders without a quota meter.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!usage) return null;

  const hours = usage.transcription_hours;
  const percent = Math.min(100, Math.max(0, hours.percent));

  if (collapsed) {
    return (
      <div
        title={`Transcription: ${percent}% of ${hours.limit ?? "unlimited"} ${hours.unit} used`}
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-core-surface-container text-core-on-surface-variant"
      >
        <Icon name="bolt" className="!text-[18px]" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-core-outline-variant/25 bg-core-surface-container px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-jetbrains-mono text-[10px] font-bold uppercase tracking-wider text-core-on-surface-variant">
          Transcription
        </span>
        <span className="font-jetbrains-mono text-[10px] font-bold text-core-primary">{percent}%</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-core-outline-variant/40">
        <div
          className="h-full rounded-full bg-core-primary-container transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-core-on-surface-variant">
        Synthesized {usage.videos_processed} {usage.videos_processed === 1 ? "video" : "videos"} this billing
        period.
      </p>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  badge,
  active,
  collapsed,
  onClick,
}: {
  href: string;
  label: string;
  icon: string;
  badge?: string;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      data-tour={href === "/workspace/history" ? "history" : undefined}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex items-center overflow-hidden rounded-xl px-3 py-2.5 text-sm transition-colors duration-[350ms] ${
        collapsed ? "justify-center" : "justify-between"
      } ${
        active
          ? "bg-core-primary font-semibold text-core-on-primary shadow-sm"
          : "text-core-on-surface-variant hover:bg-core-surface-container-high hover:text-core-on-surface"
      }`}
    >
      <span className="flex items-center overflow-hidden">
        <Icon name={icon} className="shrink-0 !text-[20px]" />
        <span
          className={`overflow-hidden whitespace-nowrap transition-all duration-[350ms] ease-in-out ${
            collapsed ? "ml-0 max-w-0 opacity-0" : "ml-3 max-w-[160px] opacity-100"
          }`}
        >
          {label}
        </span>
      </span>
      {badge && !collapsed ? (
        <span className="shrink-0 rounded bg-core-surface-container px-1.5 py-0.5 text-[11px] font-semibold text-core-on-surface-variant">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [mobileOpen]);

  return (
    <>
      <div className="sticky top-0 z-[60] flex h-16 items-center justify-between border-b border-core-outline-variant/25 bg-core-surface-container-low px-4 lg:hidden">
        <Link href="/" aria-label="FrameNote dashboard">
          <Logo size={26} />
        </Link>
        <button
          type="button"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-core-on-surface hover:bg-core-surface-container-high"
        >
          <Icon name={mobileOpen ? "close" : "menu"} className="!text-[24px]" />
        </button>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 top-16 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <nav
            aria-label="Main navigation"
            className="relative flex h-full w-64 flex-col overflow-y-auto border-r border-core-outline-variant/25 bg-core-surface-container-low p-3 shadow-xl"
          >
            <div className="space-y-1">
              {PRIMARY_ITEMS.map((item) => (
                <NavLink
                  key={item.href}
                  {...item}
                  collapsed={false}
                  active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
            </div>
            <div className="mx-2 my-4 h-px bg-core-outline-variant/25" />
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-widest text-core-on-surface-variant/60">
              Organization
            </p>
            <div className="space-y-1">
              {ORG_ITEMS.map((item) => (
                <NavLink
                  key={item.href}
                  {...item}
                  collapsed={false}
                  active={pathname.startsWith(item.href)}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
            </div>
          </nav>
        </div>
      ) : null}

    <aside
      className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-core-outline-variant/25 bg-core-surface-container-low pt-5 transition-[width] duration-[350ms] ease-in-out lg:flex ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      <div className="mb-6 flex items-center overflow-hidden px-4">
        <Link
          href="/"
          className={`transition-[max-width] duration-[350ms] ease-in-out ${
            collapsed ? "max-w-[26px] overflow-hidden" : "max-w-[220px] overflow-visible"
          }`}
        >
          <Logo size={26} />
        </Link>
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        className={`absolute -right-3 top-6 flex h-6 w-6 items-center justify-center rounded-full border border-core-outline-variant/30 bg-core-surface text-core-on-surface-variant shadow-sm transition hover:bg-core-surface-container-high`}
      >
        <Icon name={collapsed ? "chevron_right" : "chevron_left"} className="!text-[16px]" />
      </button>

      <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {PRIMARY_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            {...item}
            collapsed={collapsed}
            active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)}
          />
        ))}

        <div className="mx-2 my-4 h-px bg-core-outline-variant/25" />
        <p
          className={`overflow-hidden whitespace-nowrap px-3 text-xs font-semibold uppercase tracking-widest text-core-on-surface-variant/60 transition-all duration-[350ms] ease-in-out ${
            collapsed ? "max-h-0 pb-0 opacity-0" : "max-h-5 pb-1 opacity-100"
          }`}
        >
          Organization
        </p>

        {ORG_ITEMS.map((item) => (
          <NavLink
            key={item.label}
            {...item}
            collapsed={collapsed}
            active={item.href !== "#" && pathname.startsWith(item.href)}
          />
        ))}
      </nav>

      <div className="p-3">
        <UsageCard collapsed={collapsed} />
      </div>
    </aside>
    </>
  );
}
