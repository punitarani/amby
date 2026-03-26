# Web Marketing Refactor Plan

## Purpose

Refactor the existing `apps/web` marketing site in place so the homepage and adjacent marketing surface clearly position Amby as a premium personal assistant computer that runs once in the cloud, stays on, and is reached from anywhere.

## User-visible outcome

- The homepage presents Amby with a premium dark cinematic design system instead of the current light editorial treatment.
- The narrative becomes simpler and sharper: capture, remember, act; runs once and reaches everywhere; permission-based and reviewable.
- Real product links and tracking continue to work.
- `/vision` feels aligned with the new homepage instead of looking like a separate visual language.

## Scope

- Refactor `apps/web/app/page.tsx` into a cleaner section-based homepage.
- Refine shared marketing shell, header, footer, typography, spacing, and global styling tokens in `apps/web`.
- Reuse and simplify shared marketing components where that improves clarity and code size.
- Align `/vision` with the new visual system and updated positioning.
- Remove dead or low-value marketing code made obsolete by the refactor.

## Non-goals

- No new parallel demo page or throwaway landing page.
- No fake testimonials, fake metrics, or fake dashboard UI.
- No changes to backend product behavior.
- No new waitlist flow unless existing plumbing already exists.

## Architecture impact

- Keep the current Next.js app-router structure in `apps/web`.
- Preserve the existing tracked-link and CTA analytics flow unless a simpler equivalent is clearly better.
- Prefer a smaller set of shared marketing primitives over page-local one-off abstractions.
- Keep dependencies within current `apps/web` boundaries; this is a presentation-layer refactor only.

## Milestones

1. Audit current `apps/web` implementation, visual system, and live rendered pages.
2. Define a tighter shared marketing design system for dark premium surfaces.
3. Rewrite the homepage in place around the target section structure.
4. Align `/vision` and shared shell components with the new system.
5. Validate responsiveness, links, tracking placements, typecheck, lint, and live browser rendering.

## Likely files to change

- `apps/web/app/page.tsx`
- `apps/web/app/vision/page.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/app/globals.css`
- `apps/web/components/marketing/marketing-header.tsx`
- `apps/web/components/marketing/footer.tsx`
- `apps/web/components/marketing/page-shell.tsx`
- `apps/web/components/marketing/action-link.tsx`
- `apps/web/components/marketing/constants.ts`
- `apps/web/components/marketing/section-label.tsx`
- `apps/web/components/marketing/dreamy-image-card.tsx`
- `apps/web/lib/posthog.ts` if analytics placements need expansion

## Commands

- `bun run --filter @amby/web dev`
- `bun run --filter @amby/web typecheck`
- `bun run --filter @amby/web lint`
- Browser inspection via Playwright MCP against `http://127.0.0.1:3000`

## Acceptance checks

- Homepage loads with a dark premium visual system and the required section flow:
  - navbar
  - hero
  - how it works
  - why Amby
  - trust
  - ambient work / use cases
  - surfaces / channels
  - final CTA
  - footer
- Hero uses the provided background video with readable overlay copy.
- Primary CTA opens the existing Telegram entrypoint.
- Secondary CTA routes to `/vision` or other real internal destination.
- Existing navigation and footer links still resolve correctly.
- `/vision` visually matches the new homepage system.
- `bun run --filter @amby/web typecheck` passes.
- `bun run --filter @amby/web lint` passes.
- Playwright inspection confirms the final result on desktop and mobile widths.
- Playwright inspection confirms the final result on desktop, tablet, and mobile widths.

## Progress log

- 2026-03-26: Read root `AGENTS.md`, `ARCHITECTURE.md`, `docs/ARCHITECTURE.md`, product docs, and the current `apps/web` implementation.
- 2026-03-26: Installed workspace dependencies because this worktree did not have them yet.
- 2026-03-26: Ran the existing web app locally and inspected `/` and `/vision` in Playwright.
- 2026-03-26: Replaced the global light marketing theme with a dark cinematic system in `app/globals.css`, `app/layout.tsx`, and shared marketing shell components.
- 2026-03-26: Moved the homepage implementation out of `app/page.tsx` into `components/marketing/marketing-home-page.tsx` and rebuilt the page around the target section structure.
- 2026-03-26: Rewrote `/vision` to match the new system and tightened `github` and `telegram-access` layout widths so the broader marketing surface stays coherent.
- 2026-03-26: Verified the final result with Playwright on desktop and mobile, plus `typecheck`, `lint`, and a production `build`.
- 2026-03-26: Final refinement pass pulled the hero composition higher on large screens and softened the background grid so the page tracks closer to the reference mood.
- 2026-03-26: Final review loop tightened the homepage to track the reference more closely: shorter hero copy, denser CTA treatment, a more explicit `Why Amby` explainer visual, cleaner trust wording, and a smaller final CTA block.
- 2026-03-26: Re-verified `/`, `/vision`, in-page anchor navigation, hero video playback, and responsive layouts with Playwright, then reran `lint`, `typecheck`, and `build` sequentially.

## Surprises / discoveries

- The existing site already contains accurate thesis fragments, but they are spread across too many sections and expressed in a visually soft, low-contrast system that undercuts the product ambition.
- Shared marketing primitives are lightweight and salvageable; the main complexity sits in `app/page.tsx`.
- `DreamyImageCard` and the current pale imagery push the design toward a calm editorial mood that conflicts with the requested cinematic dark direction.
- Global CSS changes required a dev-server restart before Playwright reflected the new visual system consistently.
- Framer Motion raised React dev warnings when `motion.article` wrapped mapped cards directly; using motion wrappers around plain `article` nodes resolved the warning cleanly.
- `@amby/web typecheck` and `@amby/web build` both touch `.next/types`; they should be run sequentially, not in parallel.

## Decision log

- Keep the in-place app-router structure and tracked-link flow.
- Favor simplifying the homepage into fewer, stronger sections rather than preserving every current subsection.
- Align `/vision` to the new design system so the marketing surface feels like one product story.
- Keep real CTA destinations focused on Telegram and `/vision`; do not promote GitHub as a homepage primary path.
- Keep the header compact and premium, but use in-page anchors that read like product-level nav (`Product`, `Methodology`, `Privacy`) plus `/vision`.

## Retrospective

- The refactor materially improves both the code shape and the product positioning. The homepage now reads as one coherent argument instead of a collection of nice-looking fragments, and the shared shell is strong enough for the remaining marketing routes to inherit from without forking styles again.
