import Link from "next/link";

import { Logo } from "@/components/Logo";

const PRODUCT_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/workspace/history", label: "History" },
  { href: "/upgrade", label: "Pricing & Plans" },
];

const SUPPORT_LINKS = [
  { href: "/workspace/settings", label: "Settings" },
  { href: "/workspace/contact", label: "Contact Us" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-core-outline-variant/25 bg-core-surface-container-lowest">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-xs space-y-2">
            <Logo size={26} />
            <p className="text-sm text-core-on-surface-variant">
              AI video summaries with key points and exportable notes.
            </p>
          </div>

          <div className="flex flex-wrap gap-12">
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-core-on-surface-variant">
                Product
              </h3>
              <ul className="space-y-2">
                {PRODUCT_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-core-on-surface hover:text-core-primary hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-core-on-surface-variant">
                Support
              </h3>
              <ul className="space-y-2">
                {SUPPORT_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-core-on-surface hover:text-core-primary hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-core-outline-variant/25 pt-6 text-sm text-core-on-surface-variant">
          © {year} FrameNote. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
