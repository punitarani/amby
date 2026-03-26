# @amby/auth

User authentication and API key management for the Amby platform.

## Responsibilities

- Configure Better Auth with Drizzle adapter and PostgreSQL
- Provide `AuthService` (Effect service tag) for auth operations
- Support email + password authentication
- Support API key authentication via `@better-auth/api-key` plugin

## Non-responsibilities

- No integration OAuth flows (handled by `@amby/plugins/integrations`)
- No user profile management or business logic
- No direct route/handler definitions

## Key modules

| Path | Description |
|------|-------------|
| `src/index.ts` | `AuthService` tag, `AuthServiceLive` layer, Better Auth configuration |

## Public surface

```ts
import { AuthService, AuthServiceLive } from "@amby/auth"
```

## Dependency rules

- **Depends on:** `@amby/db`, `@amby/env`
- **Depended on by:** app layers (API server, Workers)

## Links

- [Architecture](../../docs/ARCHITECTURE.md)
