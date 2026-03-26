# @amby/web

Marketing website and landing pages for Amby.

## Responsibilities

- Serve the public marketing site and landing pages
- Host the vision statement and Telegram access pages
- Handle OAuth integration callbacks
- Provide shared marketing components and layout

## Non-responsibilities

- Backend API or bot logic (see `apps/api`)
- Agent orchestration or domain logic (see `packages/`)
- Authentication or session management beyond OAuth redirects

## Key modules

| Path | Purpose |
|------|---------|
| `app/page.tsx` | Home / marketing page |
| `app/vision/page.tsx` | Vision statement |
| `app/telegram-access/page.tsx` | Telegram access page |
| `app/integrations/callback/page.tsx` | OAuth callback handler |
| `components/marketing/` | Shared marketing components |
| `lib/` | Utilities (cn, posthog, telegram, app-url) |

## Running

```bash
bun run --filter @amby/web dev        # Next.js dev server on :3000
bun run --filter @amby/web build
bun run --filter @amby/web typecheck
bun run --filter @amby/web lint
```

## Dependencies

Next.js 16, React 19, Tailwind CSS 4, framer-motion, lucide-react, PostHog, `@amby/connectors`.

## Links

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
