"use client";

import { useCallback, useEffect, useState } from "react";

export type TourStep = {
  /** CSS selector for the element to spotlight. Steps whose target is missing render centered. */
  target?: string;
  title: string;
  body: string;
};

const CARD_WIDTH = 320;
const GAP = 12;

type Spotlight = { top: number; left: number; width: number; height: number };

function measure(selector: string | undefined): Spotlight | null {
  if (!selector) return null;
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

export function ProductTour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Spotlight | null>(null);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  // Re-measure whenever the step changes or the page moves under us.
  useEffect(() => {
    if (!step) return;

    const element = step.target ? document.querySelector(step.target) : null;
    element?.scrollIntoView({ behavior: "smooth", block: "center" });

    function sync() {
      setSpot(measure(step.target));
    }

    // Let the smooth scroll settle before taking the first measurement.
    const timeoutId = window.setTimeout(sync, element ? 320 : 0);
    sync();

    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [step]);

  const next = useCallback(() => {
    setIndex((current) => (current < steps.length - 1 ? current + 1 : current));
  }, [steps.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [next, onClose]);

  if (!step) return null;

  // Prefer sitting below the highlight, flipping above when that would run off-screen.
  const cardStyle: React.CSSProperties = spot
    ? (() => {
        const below = spot.top + spot.height + GAP;
        const fitsBelow = below + 200 < window.innerHeight;
        const left = Math.min(
          Math.max(GAP, spot.left + spot.width / 2 - CARD_WIDTH / 2),
          window.innerWidth - CARD_WIDTH - GAP
        );
        return fitsBelow
          ? { top: below, left }
          : { top: Math.max(GAP, spot.top - GAP - 200), left };
      })()
    : {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" aria-label="Product tour">
      {spot ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl ring-2 ring-core-primary transition-all duration-300"
          style={{
            top: spot.top - 6,
            left: spot.left - 6,
            width: spot.width + 12,
            height: spot.height + 12,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.6)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-slate-900/60" />
      )}

      {/* Click-anywhere-to-dismiss, sitting under the card so the buttons stay clickable. */}
      <button type="button" aria-label="Close tour" className="absolute inset-0 cursor-default" onClick={onClose} />

      <div
        className="absolute w-80 rounded-2xl border border-core-primary/10 bg-core-surface p-5 shadow-2xl"
        style={cardStyle}
      >
        <p className="font-jetbrains-mono text-[11px] font-semibold uppercase tracking-wider text-core-on-surface-variant">
          Step {index + 1} of {steps.length}
        </p>
        <h3 className="mt-1 text-base font-bold text-core-on-surface">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-core-on-surface-variant">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-core-on-surface-variant transition hover:text-core-on-surface"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => setIndex((current) => Math.max(0, current - 1))}
                className="rounded-xl px-3 py-2 text-sm font-semibold text-core-on-surface transition hover:bg-core-surface-container-high"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => (isLast ? onClose() : next())}
              className="rounded-xl bg-core-primary px-4 py-2 text-sm font-semibold text-core-on-primary transition hover:opacity-90"
            >
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
