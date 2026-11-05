# Copilot Prompt: Production-Level Auth + Billing UI (Next.js)

Use the prompt below in GitHub Copilot Chat to generate a production-grade implementation.

## Prompt

You are a senior product engineer and frontend architect. Build a production-ready authentication and billing UI for a SaaS app in Next.js App Router with TypeScript and Tailwind CSS.

Project goals:
- Create a polished login page, logout flow/page, and upgrade payment page for Pro plan.
- Deliver real, shippable UI and UX quality, not a demo.
- Integrate with existing backend API endpoints when possible.

Tech and quality constraints:
- Next.js 15 App Router, React 19, TypeScript, Tailwind.
- Accessibility first: WCAG 2.1 AA basics, keyboard navigation, proper labels, visible focus, semantic landmarks, aria-live for async status.
- Responsive across mobile, tablet, desktop.
- Strong state handling: loading, success, error, empty, retry states.
- Production-safe patterns: no secrets in client, payment initiated server-side only.
- Keep code modular, readable, and maintainable.
- Add concise comments only where logic is non-obvious.
- Use clean architecture with reusable components.

Visual direction:
- Intentional, premium UI with a clear brand direction.
- Avoid generic boilerplate designs.
- Define CSS variables for color tokens, spacing rhythm, radius, and elevation.
- Typography should feel purposeful and modern.
- Include subtle motion for page entrance and section reveals, respecting reduced motion preferences.
- Avoid default purple-on-white look.

Feature requirements:

1) Login page:
- Email and password fields with validation and inline error messages.
- Remember me option.
- Forgot password link area (stub with TODO if backend endpoint not available).
- Social sign-in area as optional placeholders only if backend not ready.
- Form submit calls backend auth endpoint.
- On success, redirect to app dashboard.
- On failure, show actionable error messaging.
- Include security UX details: disabled submit during request, safe error text, no sensitive logs.

2) Logout flow/page:
- Support logout from user menu and direct route.
- Confirmation UI: "Are you sure you want to log out?"
- On confirm, call logout endpoint and clear client auth state.
- Show progress and final confirmation.
- Redirect to login page after successful logout.
- Handle network failure with retry option.

3) Upgrade to Pro payment page:
- Show current plan and benefits comparison (Free vs Pro).
- Prominent CTA to upgrade.
- On CTA, call backend endpoint that creates checkout session and redirect to Stripe-hosted checkout URL.
- Handle pending and failure states.
- Include success and cancel return handling via query params.
- Show billing FAQs section and trust indicators.
- Ensure no payment secrets on frontend.

App structure and routing:
- Add/organize routes for login, logout, and billing/upgrade.
- Add shared layout pieces: top nav with profile menu and plan badge.
- Add route protection strategy for authenticated pages.
- If middleware or server actions are used, explain why.

API integration expectations:
- Use a typed API client layer.
- Reuse existing billing checkout endpoint if present.
- Add robust error mapping for 400/401/403/500 responses.
- Add optimistic UX where appropriate, but keep consistency and correctness.

Developer experience:
- If new dependencies are needed, list and install them.
- Update env variable usage safely.
- Keep lint clean and TypeScript strict.
- Provide final diff summary and rationale for key decisions.

Testing and verification:
- Add at least basic tests for core auth and billing UI states.
- Include manual QA checklist:
  - login success/failure
  - logout success/failure
  - upgrade redirect
  - keyboard-only flow
  - mobile layout
  - reduced motion preference

Output format:
1. Brief implementation plan.
2. Code changes applied directly.
3. Commands run.
4. Final verification results.
5. Remaining TODOs if backend endpoints are missing.

If any required backend endpoint is missing:
- Implement graceful stubs and clearly mark TODOs.
- Do not block the UI from being testable locally.

## Optional follow-up prompt

After implementation, run a second pass that focuses only on visual polish and interaction design while preserving existing behavior and accessibility.
