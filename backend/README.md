# Backend: NeuroFox AI

Vanilla Node.js HTTP backend with a layered architecture: **Routes → Service → Repository**.

No frameworks: built on `node:http`, raw PostgreSQL queries via `pg`, and environment-driven configuration.

## Modules

| Module | Description |
|--------|-------------|
| `auth/` | Email OTP authentication (request → verify → session) |
| `account/` | User account management, balance, profile |
| `payments/` | Tariff catalog, payment creation, webhook processing, balance crediting |
| `generations/` | AI generation dispatch, status polling, reconciliation, result materialization |
| `chat/` | AI chat completion with model selection and fallback |
| `referral/` | Referral program: attribution, tiered earnings, balance ledger |
| `withdrawal/` | Referral earnings withdrawal with admin moderation |
| `promo/` | Promotional code creation and redemption |
| `mailing/` | Admin bulk email campaigns with audience management |
| `assets/` | Binary asset upload, storage (S3 / local FS), signed URL delivery |
| `mail/` | Email adapter: OTP delivery + mailing (console / API / SMTP) |
| `notifications/` | Owner notifications via Telegram Bot API |
| `db/` | Connection pool, migration runner, 16 incremental SQL migrations |
| `config/` | Environment variable parsing with validation |
| `http/` | Shared HTTP response utilities |

## API Endpoints

All API routes are registered in `server.mjs` and delegated to module-specific route handlers.

| Prefix | Module |
|--------|--------|
| `/api/auth/*` | Authentication (OTP request, verify, session, logout) |
| `/api/account/*` | Account info, balance, admin operations |
| `/api/payments/*` | Tariff catalog, payment creation, webhook, history |
| `/api/generations/*` | Generation dispatch, status, history, webhooks |
| `/api/chat/*` | Chat completion |
| `/api/referral/*` | Referral summary, link, invited users |
| `/api/withdrawal/*` | Withdrawal create, status, history, admin moderation |
| `/api/promo/*` | Promo code application |
| `/api/mailing/*` | Admin mailing, unsubscribe |
| `/api/assets/*` | Asset upload, download, content-range streaming |
| `/health` | Health check |

## Background Jobs

The server runs background loops (configurable via `BACKGROUND_JOBS_ENABLED`):

- **Generation reconciliation**: polls external AI provider for pending task results
- **Generation history cleanup**: retention-based cleanup of old generation records
- **Chat retention cleanup**: removes expired chat sessions
- **Mailing execution**: processes pending bulk email campaigns

## Database

PostgreSQL with 16 incremental migrations in `db/migrations/`. Schema covers:

- Users, sessions, balances
- Payments, tariffs, webhook events
- Generation jobs, uploaded assets
- Chat sessions and messages
- Promo codes, referrals, referral earnings
- Withdrawal requests, admin actions
- Mailing executions, recipients, consent
