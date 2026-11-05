"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useState } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { AuthGuard } from "@/components/AuthGuard";
import { useSidebar } from "@/components/SidebarContext";
import { Accordion } from "@/components/ui/Accordion";
import { createCheckoutSession, getPricingCatalog } from "@/lib/api";
import { BillingCycle, ComparisonCell, PricingCatalogResponse, PricingPlan } from "@/types/job";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

function Banner({ tone, children }: { tone: "success" | "warning" | "error" | "info"; children: React.ReactNode }) {
  const tones = {
    success: "border-state-success/30 bg-state-success-soft text-state-on-success-soft",
    warning: "border-state-warning/40 bg-state-warning-soft text-state-on-warning-soft",
    error: "border-core-error/30 bg-state-danger-soft text-core-error",
    info: "border-core-primary/25 bg-core-primary-fixed/50 text-core-on-surface",
  } as const;
  return <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

function planPrice(plan: PricingPlan, cycle: BillingCycle) {
  if (plan.custom_price_label) {
    return { amount: plan.custom_price_label, suffix: null, note: plan.price_note };
  }
  const monthly = cycle === "annual" ? plan.price_annual_monthly : plan.price_monthly;
  const note =
    cycle === "annual" && plan.price_annual_total
      ? `Billed annually ($${plan.price_annual_total}/year)`
      : plan.price_note ?? null;
  return { amount: `$${monthly ?? 0}`, suffix: plan.price_monthly === 0 ? "/ FOREVER" : "/ MONTH", note };
}

function PlanCard({
  plan,
  cycle,
  onSelect,
  busy,
}: {
  plan: PricingPlan;
  cycle: BillingCycle;
  onSelect: (plan: PricingPlan) => void;
  busy: boolean;
}) {
  const { amount, suffix, note } = planPrice(plan, cycle);
  const featured = plan.most_popular;

  return (
    <div
      className={`relative flex flex-col rounded-xl2 border bg-core-surface-container-lowest p-6 transition-shadow ${
        featured
          ? "border-core-primary/40 shadow-[0_18px_42px_-24px_rgba(53,37,205,0.45)] lg:-mt-3 lg:mb-0"
          : "border-core-outline-variant/20 shadow-[0_4px_12px_-8px_rgba(15,23,42,0.18)]"
      }`}
    >
      {featured ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-core-primary-container px-3 py-1 font-jetbrains-mono text-[10px] font-bold uppercase tracking-wider text-core-on-primary">
          Most Popular
        </span>
      ) : null}

      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="font-display text-xl font-bold text-core-on-surface">{plan.name}</h3>
        <Icon name={plan.icon} className="!text-[20px] shrink-0 text-core-primary" />
      </div>

      <p className="mb-5 min-h-[60px] text-sm leading-relaxed text-core-on-surface-variant">{plan.tagline}</p>

      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-extrabold tracking-tight text-core-on-surface">{amount}</span>
        {suffix ? (
          <span className="font-jetbrains-mono text-[11px] font-semibold uppercase text-core-on-surface-variant">
            {suffix}
          </span>
        ) : null}
      </div>
      <p className="mb-5 min-h-[18px] text-xs text-core-on-surface-variant">{note}</p>

      <p className="mb-3 border-t border-core-outline-variant/20 pt-4 font-jetbrains-mono text-[10px] font-bold uppercase tracking-wider text-core-primary">
        {plan.features_heading}
      </p>

      <ul className="mb-6 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={`${feature.emphasis ?? ""}${feature.text}`} className="flex items-start gap-2 text-sm">
            <Icon name="check_circle" className="!text-[16px] mt-0.5 shrink-0 text-core-primary" />
            <span className="text-core-on-surface-variant">
              {feature.emphasis ? (
                <span className="font-semibold text-core-on-surface">{feature.emphasis} </span>
              ) : null}
              {feature.text}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto">
        {plan.cta_action === "current" ? (
          <span className="flex w-full items-center justify-center rounded-xl border border-core-outline-variant/30 bg-core-surface-container-low px-4 py-3 text-sm font-semibold text-core-on-surface-variant">
            {plan.cta_label}
          </span>
        ) : plan.cta_action === "contact" ? (
          <Link
            href="/workspace/contact"
            className="flex w-full items-center justify-center rounded-xl border border-core-outline-variant/30 bg-core-surface px-4 py-3 text-sm font-semibold text-core-on-surface transition hover:bg-core-surface-container-high"
          >
            {plan.cta_label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(plan)}
            disabled={busy}
            className={`flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              featured
                ? "bg-core-primary-container text-core-on-primary hover:bg-core-primary"
                : "border border-core-outline-variant/30 bg-core-surface text-core-on-surface hover:bg-core-surface-container-high"
            }`}
          >
            {busy ? "Opening checkout..." : plan.cta_label}
          </button>
        )}
      </div>
    </div>
  );
}

function Cell({ cell }: { cell: ComparisonCell }) {
  if (cell.kind === "check") {
    return <Icon name="check" className="!text-[18px] text-core-primary" />;
  }
  if (cell.kind === "none") {
    return <span className="text-core-on-surface-variant/50">&mdash;</span>;
  }
  return (
    <span
      className={`text-xs ${
        cell.highlight ? "font-semibold text-core-primary" : "text-core-on-surface-variant"
      }`}
    >
      {cell.value}
    </span>
  );
}

function UpgradeContent() {
  const { collapsed } = useSidebar();
  const searchParams = useSearchParams();
  const billingParam = searchParams.get("billing");

  const [catalog, setCatalog] = useState<PricingCatalogResponse | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>("annual");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPricingCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("We could not load the plan catalog. Please refresh the page.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSelect(plan: PricingPlan) {
    setBusyPlan(plan.id);
    setCheckoutError(null);
    try {
      const { checkout_url } = await createCheckoutSession(plan.tier, cycle);
      window.location.href = checkout_url;
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "We could not start checkout.");
      setBusyPlan(null);
    }
  }

  const plans = catalog?.plans ?? [];
  const trust = catalog?.trust;

  return (
    <div className="min-h-screen bg-core-background">
      <AppSidebar />

      <div className={`transition-[padding] duration-[350ms] ease-in-out ${collapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        <AppTopbar />

        <main className="mx-auto w-full max-w-[1280px] px-4 py-10 sm:px-6 lg:px-8">
          <section className="text-center">
            <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-core-primary-fixed px-3 py-1 font-jetbrains-mono text-[11px] font-bold uppercase tracking-wider text-core-primary">
              <Icon name="bolt" className="!text-[14px]" />
              Simple & Transparent Pricing
            </p>
            <h1 className="mx-auto max-w-3xl font-display text-4xl font-extrabold leading-tight tracking-tight text-core-on-surface sm:text-5xl">
              Turn Video Meetings into Actionable Intelligence
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-core-on-surface-variant">
              Start free, then upgrade only when you need longer recordings and detailed analysis.
            </p>

            <div className="mt-7 inline-flex rounded-full border border-core-outline-variant/30 bg-core-surface-container p-1">
              {(["monthly", "annual"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={cycle === option}
                  onClick={() => setCycle(option)}
                  className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                    cycle === option
                      ? "bg-core-surface text-core-on-surface shadow-sm"
                      : "text-core-on-surface-variant hover:text-core-on-surface"
                  }`}
                >
                  {option === "monthly" ? "Billed Monthly" : "Billed Annually"}
                  {option === "annual" ? (
                    <span className="rounded-full bg-core-primary-fixed px-2 py-0.5 font-jetbrains-mono text-[9px] font-bold uppercase text-core-primary">
                      Save {catalog?.annual_discount_percent ?? 20}%
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>

          <div className="mt-7 space-y-3" aria-live="polite">
            {billingParam === "success" ? (
              <Banner tone="success">
                Payment confirmed. Your plan will update shortly once the webhook is processed.
              </Banner>
            ) : null}
            {billingParam === "cancel" ? (
              <Banner tone="warning">Checkout was canceled. You have not been charged.</Banner>
            ) : null}
            {loadError ? <Banner tone="error">{loadError}</Banner> : null}
            {checkoutError ? <Banner tone="error">{checkoutError}</Banner> : null}
          </div>

          <section className="mx-auto mt-10 grid max-w-3xl gap-5 sm:grid-cols-2">
            {plans.length === 0 && !loadError
              ? Array.from({ length: 2 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-[520px] animate-pulse rounded-xl2 border border-core-outline-variant/20 bg-core-surface-container-lowest"
                  />
                ))
              : null}
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                cycle={cycle}
                onSelect={(selected) => void onSelect(selected)}
                busy={busyPlan === plan.id}
              />
            ))}
          </section>

          {trust ? (
            <section className="mt-10 rounded-xl2 border border-core-outline-variant/15 bg-core-surface-container-low p-6 sm:p-8">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
                <div>
                  <p className="mb-3 inline-flex items-center gap-1.5 font-jetbrains-mono text-[11px] font-bold uppercase tracking-wider text-core-primary">
                    <Icon name="shield_with_heart" className="!text-[14px]" />
                    {trust.eyebrow}
                  </p>
                  <h2 className="font-display text-2xl font-bold leading-snug text-core-on-surface">
                    {trust.headline}
                  </h2>
                  <p className="mt-2 text-sm text-core-on-surface-variant">{trust.detail}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {trust.badges.map((badge) => (
                    <div
                      key={badge.title}
                      className="rounded-xl border border-core-outline-variant/20 bg-core-surface-container-lowest p-3.5 text-center"
                    >
                      <Icon name={badge.icon} className="!text-[20px] text-core-primary" />
                      <p className="mt-1.5 font-jetbrains-mono text-[11px] font-bold text-core-on-surface">
                        {badge.title}
                      </p>
                      <p className="font-jetbrains-mono text-[10px] text-core-on-surface-variant">
                        {badge.subtitle}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-core-outline-variant/20 pt-5">
                <p className="text-sm text-core-on-surface-variant">{trust.social_proof}</p>
                <div className="flex flex-wrap items-center gap-4 font-jetbrains-mono text-[11px] text-core-on-surface-variant">
                  <span className="flex items-center gap-1">
                    <Icon name="star" className="!text-[14px] text-state-warning" />
                    {trust.rating}
                  </span>
                  <span className="flex items-center gap-1">
                    <Icon name="speed" className="!text-[14px] text-core-primary" />
                    {trust.speed}
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          {catalog ? (
            <section className="mt-12">
              <div className="mb-6 text-center">
                <p className="mb-3 inline-block rounded-full bg-core-surface-container-high px-3 py-1 font-jetbrains-mono text-[10px] font-bold uppercase tracking-wider text-core-on-surface-variant">
                  Detailed Breakdown
                </p>
                <h2 className="font-display text-2xl font-bold tracking-tight text-core-on-surface sm:text-3xl">
                  Compare all features side-by-side
                </h2>
                <p className="mx-auto mt-2 max-w-2xl text-sm text-core-on-surface-variant">
                  Everything you need to know about quotas, ingestion formats, AI models, and data security.
                </p>
              </div>

              <div className="overflow-x-auto rounded-xl2 border border-core-outline-variant/20 bg-core-surface-container-lowest">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-core-outline-variant/20">
                      <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wide text-core-on-surface-variant">
                        Capabilities
                      </th>
                      {catalog.comparison_columns.map((column) => (
                        <th
                          key={column}
                          className={`px-4 py-3.5 text-center text-xs font-semibold uppercase tracking-wide ${
                            column === "Solo Pro" ? "bg-core-primary-fixed/40 text-core-primary" : "text-core-on-surface-variant"
                          }`}
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.comparison.map((group) => (
                      <Fragment key={group.title}>
                        <tr className="bg-core-surface-container-low">
                          <td
                            colSpan={catalog.comparison_columns.length + 1}
                            className="px-5 py-2 font-jetbrains-mono text-[10px] font-bold uppercase tracking-wider text-core-primary"
                          >
                            {group.title}
                          </td>
                        </tr>
                        {group.rows.map((row) => (
                          <tr
                            key={`${group.title}-${row.label}`}
                            className="border-b border-core-outline-variant/10 last:border-b-0"
                          >
                            <td className="px-5 py-3 text-sm text-core-on-surface">{row.label}</td>
                            {row.cells.map((cell, cellIndex) => (
                              <td
                                key={cellIndex}
                                className={`px-4 py-3 text-center ${
                                  catalog.comparison_columns[cellIndex] === "Solo Pro"
                                    ? "bg-core-primary-fixed/20"
                                    : ""
                                }`}
                              >
                                <Cell cell={cell} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {catalog ? (
            <section className="mx-auto mt-12 max-w-3xl">
              <div className="mb-6 text-center">
                <p className="mb-3 inline-block font-jetbrains-mono text-[10px] font-bold uppercase tracking-wider text-core-primary">
                  Help & FAQ
                </p>
                <h2 className="font-display text-2xl font-bold tracking-tight text-core-on-surface sm:text-3xl">
                  Frequently asked questions
                </h2>
                <p className="mt-2 text-sm text-core-on-surface-variant">
                  Clear answers to common questions about FrameNote billing and usage.
                </p>
              </div>
              <Accordion items={catalog.faqs.map((faq) => ({ question: faq.question, answer: faq.answer }))} />
            </section>
          ) : null}

          <section className="relative mt-12 overflow-hidden rounded-xl2 bg-core-primary-container px-6 py-10 text-center sm:px-10">
            <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-12 h-56 w-56 rounded-full bg-white/10 blur-3xl" />

            <div className="relative">
              <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-jetbrains-mono text-[10px] font-bold uppercase tracking-wider text-white">
                <Icon name="hourglass_empty" className="!text-[14px]" />
                Start Small, Upgrade When Useful
              </p>
              <h2 className="mx-auto max-w-2xl font-display text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
                Ready to save hours on every video meeting?
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm text-white/80">
                Create a free account, process a short recording, and decide whether Solo Pro fits your needs.
              </p>

              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/"
                  className="rounded-xl bg-core-surface px-6 py-3 text-sm font-semibold text-core-primary transition hover:bg-core-surface/90"
                >
                  Get Started Free
                </Link>
                <Link
                  href="/workspace/contact"
                  className="rounded-xl border border-white/40 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Contact Us
                </Link>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-5 font-jetbrains-mono text-[11px] text-white/70">
                <span className="flex items-center gap-1.5">
                  <Icon name="credit_card_off" className="!text-[14px]" />
                  No credit card required
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="cancel" className="!text-[14px]" />
                  Cancel anytime
                </span>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default function UpgradePage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-core-background">
            <span
              className="h-8 w-8 animate-spin rounded-full border-2 border-core-primary border-t-transparent"
              aria-hidden="true"
            />
          </div>
        }
      >
        <UpgradeContent />
      </Suspense>
    </AuthGuard>
  );
}
