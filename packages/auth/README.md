# @amby/auth

User authentication, Telegram auth, and API key management for the Amby platform.

## Responsibilities

- Configure Better Auth with Drizzle adapter and PostgreSQL
- Provide `AuthService` and `TelegramIdentityService` Effect services
- Support email + password authentication
- Support API key authentication via `@better-auth/api-key` plugin
- Own the first-party Telegram Better Auth plugin:
  - Login Widget sign-in/link/unlink
  - Mini App sign-in/validate
  - Telegram OIDC via Better Auth generic OAuth
  - Bot-first Telegram identity provisioning shared with `@amby/channels`

## Non-responsibilities

- No integration OAuth flows (handled by `@amby/plugins/integrations`)
- No user profile management or business logic
- No app-layer route mounting

## Key modules

| Path | Description |
|------|-------------|
| `src/create-auth.ts` | Better Auth factory with Telegram and generic OAuth composition |
| `src/auth-service.ts` | `AuthService`, `TelegramIdentityService`, and live Effect layers |
| `src/client.ts` | Browser auth client helpers and Telegram client plugin |
| `src/telegram/` | Telegram verification, OIDC, plugin endpoints, and shared identity service |

## Public surface

```ts
import { AuthLive, AuthService, TelegramIdentityService } from "@amby/auth"
import { createAmbyAuthClient, telegramClient } from "@amby/auth/client"
```

## Dependency rules

- **Depends on:** `@amby/db`, `@amby/env`
- **Depended on by:** API runtimes, channels, browser surfaces

## Links

- [Architecture](../../docs/ARCHITECTURE.md)
- [Telegram exec plan](../../docs/exec-plans/2026-03-27-telegram-better-auth.md)
