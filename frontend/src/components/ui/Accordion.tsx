"use client";

import { ReactNode, useState } from "react";

export interface AccordionItem {
  question: string;
  answer: ReactNode;
}

/**
 * Single-open FAQ accordion shared by the Pricing and Contact pages.
 * `defaultOpenIndex` keeps the first answer expanded, matching the designs.
 */
export function Accordion({
  items,
  defaultOpenIndex = null,
  className = "",
}: {
  items: AccordionItem[];
  defaultOpenIndex?: number | null;
  className?: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(defaultOpenIndex);

  return (
    <div className={`space-y-2.5 ${className}`}>
      {items.map((item, index) => {
        const open = openIndex === index;
        return (
          <div
            key={item.question}
            className={`overflow-hidden rounded-xl border transition-colors ${
              open
                ? "border-core-primary/25 bg-core-surface-container-low"
                : "border-core-outline-variant/25 bg-core-surface-container-lowest hover:border-core-primary/20"
            }`}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenIndex(open ? null : index)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
            >
              <span className="text-sm font-semibold text-core-on-surface">{item.question}</span>
              <span
                aria-hidden="true"
                className={`material-symbols-outlined shrink-0 !text-[20px] text-core-on-surface-variant transition-transform duration-200 ${
                  open ? "rotate-180" : ""
                }`}
              >
                expand_more
              </span>
            </button>
            {open ? (
              <div className="animate-fade-in px-4 pb-4 text-sm leading-relaxed text-core-on-surface-variant">
                {item.answer}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
