"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { useTheme } from "@/components/ThemeContext";
import { getNotifications, markNotificationsRead, getUserProfile } from "@/lib/api";
import { NotificationListResponse, UserProfileResponse } from "@/types/job";

/** Compact relative stamp ("3m", "2h", "5d") for the notification feed. */
function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

export function AppTopbar() {
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();
  const [profile, setProfile] = useState<UserProfileResponse | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [notifications, setNotifications] = useState<NotificationListResponse | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getUserProfile()
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        // Non-fatal: topbar still renders without profile details.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll so a job finishing in the background surfaces without a page reload.
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const data = await getNotifications();
        if (!cancelled) setNotifications(data);
      } catch {
        // Non-fatal: the bell just stays empty.
      }
    }

    void refresh();
    const intervalId = window.setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function onBellToggle() {
    const opening = !bellOpen;
    setBellOpen(opening);
    if (opening && (notifications?.unread_count ?? 0) > 0) {
      try {
        setNotifications(await markNotificationsRead());
      } catch {
        // Non-fatal: the badge clears on the next successful poll.
      }
    }
  }

  function onSearchSubmit(event: FormEvent) {
    event.preventDefault();
    const term = searchTerm.trim();
    // An empty box opens the unfiltered library rather than searching for nothing.
    router.push(term ? `/workspace/history?q=${encodeURIComponent(term)}` : "/workspace/history");
  }

  const unreadCount = notifications?.unread_count ?? 0;
  const notificationItems = notifications?.items ?? [];
  const isPro = profile?.tier === "pro";
  const planLabel = isPro ? "Solo Pro" : "Free Starter";
  const displayName = profile?.full_name?.trim() || profile?.email?.split("@")[0] || "Loading…";

  return (
    <header className="relative z-30 flex items-center justify-between gap-4 border-b border-core-outline-variant/20 bg-core-surface/90 px-4 py-3.5 backdrop-blur sm:px-6">
      <form onSubmit={onSearchSubmit} role="search" className="w-full max-w-sm">
        <label className="flex w-full items-center gap-2 rounded-full border border-core-outline-variant/25 bg-core-surface-container-lowest px-3.5 py-2 text-core-on-surface-variant transition focus-within:border-core-primary/40">
          <Icon name="search" className="!text-[18px]" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search notes..."
            aria-label="Search notes"
            className="w-full border-none bg-transparent text-sm text-core-on-surface outline-none placeholder:text-core-on-surface-variant/60"
          />
        </label>
      </form>

      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1.5 rounded-full bg-state-success-soft px-3 py-1 text-xs font-semibold text-state-on-success-soft sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-state-success" />
          {planLabel}
        </span>

        {!isPro ? (
          <Link
            href="/upgrade"
            className="hidden rounded-full bg-core-primary px-4 py-1.5 text-xs font-semibold text-core-on-primary transition hover:bg-core-surface-tint sm:inline-flex"
          >
            Upgrade to Pro
          </Link>
        ) : (
          <Link
            href="/upgrade"
            className="hidden items-center gap-1.5 rounded-full bg-core-primary-fixed px-3 py-1 text-xs font-semibold text-core-primary transition hover:bg-core-primary-container hover:text-core-on-primary sm:inline-flex"
          >
            <Icon name="credit_card" className="!text-[14px]" />
            Manage plan
          </Link>
        )}

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="flex h-9 w-9 items-center justify-center rounded-full text-core-on-surface-variant transition hover:bg-core-surface-container-high"
        >
          <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} className="!text-[20px]" />
        </button>

        <div className="relative" ref={bellRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={bellOpen}
            aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
            onClick={() => void onBellToggle()}
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-core-on-surface-variant transition hover:bg-core-surface-container-high"
          >
            <Icon name="notifications" className="!text-[20px]" />
            {unreadCount > 0 ? (
              <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-core-error" />
            ) : null}
          </button>

          {bellOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-2 w-80 overflow-hidden rounded-xl border border-core-outline-variant/20 bg-core-surface shadow-xl"
            >
              <p className="border-b border-core-outline-variant/20 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-core-on-surface-variant">
                Notifications
              </p>
              {notificationItems.length ? (
                <ul className="max-h-80 overflow-y-auto">
                  {notificationItems.map((item) => (
                    <li key={`${item.job_id}-${item.occurred_at}`}>
                      <Link
                        href={`/workspace/insights?job=${item.job_id}`}
                        role="menuitem"
                        onClick={() => setBellOpen(false)}
                        className="flex gap-3 px-4 py-3 transition hover:bg-core-surface-container-high"
                      >
                        <Icon
                          name={item.kind === "completed" ? "check_circle" : "error"}
                          className={`!text-[18px] ${
                            item.kind === "completed" ? "text-core-primary" : "text-core-error"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-core-on-surface">
                            {item.title}
                          </span>
                          <span className="block truncate text-xs text-core-on-surface-variant">
                            {item.message}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-core-on-surface-variant">
                            {timeAgo(item.occurred_at)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-core-on-surface-variant">
                  No notifications yet. Finished videos will show up here.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <div className="mx-1 hidden h-6 w-px bg-core-outline-variant/40 sm:block" />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-2.5 rounded-full pl-1 transition hover:bg-core-surface-container-high"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-core-primary text-sm font-semibold text-core-on-primary">
              {(profile?.email ?? "?").charAt(0).toUpperCase()}
            </span>
            <span className="hidden flex-col items-start leading-tight lg:flex">
              <span className="text-sm font-semibold text-core-on-surface">{displayName}</span>
              <span className="text-xs text-core-on-surface-variant">{planLabel}</span>
            </span>
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-2 w-52 rounded-xl border border-core-outline-variant/20 bg-core-surface p-1.5 shadow-xl"
            >
              <p className="truncate px-3 py-2 text-xs text-core-on-surface-variant">{profile?.email ?? "Loading…"}</p>
              <Link
                href="/upgrade"
                role="menuitem"
                className="block rounded-lg px-3 py-2 text-sm text-core-on-surface hover:bg-core-surface-container-high"
                onClick={() => setMenuOpen(false)}
              >
                {isPro ? "Manage plan" : "Upgrade to Pro"}
              </Link>
              <Link
                href="/logout"
                role="menuitem"
                className="block rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger-soft"
                onClick={() => setMenuOpen(false)}
              >
                Log out
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
