# GS ClientFlow — Architecture Optimization and Product Intelligence Platform

> Multi-Tenant Customer Relationship & Growth Automation System for Modern Small and Medium Enterprises.  
> Powered by Next.js 16, Tailwind CSS, Shadcn UI, Neon PostgreSQL + Drizzle ORM / Prisma, and Cloudflare Queues / Workers.

---

## Features & Architecture Overview

### 1. Multi-Tenant Database Optimization (Neon PostgreSQL + Drizzle)
- **Database Engine**: Serverless Neon PostgreSQL with connection pooling via Cloudflare Hyperdrive or Neon Pooled endpoint (`-pooler.neon.tech`).
- **Row-Level Security (RLS)**: Enforces database-level isolation using PostgreSQL RLS policies triggered by transaction-local tenant context (`app.current_tenant_id`).
- **Keyset Cursor Pagination**: Base64url encoded cursor tokens on `(createdAt, id)` avoiding expensive database `OFFSET` operations.
- **Anti-Overfetching**: Lean projection queries (`LIST_SELECT`, `CUSTOMER_LITE_SELECT`) to optimize egress and memory footprint.
- **Disaster Recovery**: Live tenant-scoped JSON snapshot backups (`GET /api/ops/backup`) and configurable data retention engines.
- **Neon Branching**: Isolated test database branching workflow for non-destructive migration testing.

### 2. Transactional Outbox & Event-Driven Automation
- **Atomic Event Publishing**: Every state mutation and outbox event insert commits inside a single database transaction.
- **10 Core System Events**:
  1. `customer.registered`
  2. `customer.updated`
  3. `customer.birthday.upcoming`
  4. `feedback.submitted`
  5. `offer.created`
  6. `offer.redeemed`
  7. `campaign.scheduled`
  8. `campaign.completed`
  9. `appointment.booked`
  10. `appointment.cancelled`
- **Queue Consumer Reliability**: Designed for Cloudflare Queues with claim leasing, exponential retry backoff ($3\,\text{s} \times 2^{\text{attempts}}$ capped at 5 minutes), dead-letter queue (DLQ) state persistence, and one-click manual retry.

### 3. Customer Intelligence & Segmentation
- **Segmentation Engine**: Dynamic condition rules (visit count, total spend, tags, sources, birthday window, inactive period) evaluated against live data.
- **Metrics Without Fabrication**: Genuine CLV calculations, repeat customer tagging ($\ge 2$ visits), and inactivity window alerts computed strictly from stored rows.
- **Engagement Timeline**: Chronological log of visits, messages, feedback ratings, offer redemptions, and workflow executions.
- **Attribution**: Acquisition source tracking with dual-sided referral code attribution.

### 4. Advanced Workflow Engine
- **Trigger Types**: Event-based, Date-based (scheduled scanner), and Manual triggers.
- **Audience & Delays**: Granular conditions, audience filters, time delays via `ScheduledAction`, and multi-channel opt-in consent verification.
- **Preconfigured Workflows**:
  - *Customer Onboarding*: Immediate welcome + delayed satisfaction follow-up.
  - *Birthday Special*: Dispatches celebratory discount 7 days in advance.
  - *Winback Inactive Customers*: Automated re-engagement for customers inactive $>45$ days.
  - *Appointment Reminders*: Dispatched 24 hours and 2 hours prior to start time.
  - *Post-Appointment Feedback*: Automated rating request following service completion.
  - *Offer Expiry Alert*: Notification 48 hours prior to coupon expiration.

### 5. Loyalty & Rewards Ledger
- **Append-Only Ledger**: Balances updated strictly through `RewardTransaction` records.
- **Idempotency Protection**: Unique database-level `idempotencyKey` prevents duplicate reward issuances.
- **Configurable Rules**: Points per visit, spend ratio, review submission, and referral bonus.

### 6. Appointment Management
- **Category Presets**: Tailored for *Salon & Spa, Dental Clinic, Medical Clinic, Retail, Professional Services, and Food & Beverage*.
- **Conflict Prevention**: Overlap detection prevents staff double-booking.
- **Lifecycle Tracking**: Booking confirmation, cancellation with reminder cancellation, and no-show tracking.

### 7. White-Label Infrastructure
- **Tenant Subdomains**: Multi-tenant slug routing (`<slug>.gsclientflow.app`).
- **Custom Domains**: Domain mapping with DNS TXT verification tokens.
- **Brand Identity**: Customizable primary colors, monogram logos, and custom registration form schemas.
- **Client Portal & Embeds**: Branded customer self-service portal and embeddable website widgets.

### 8. Analytics & Reporting
- **Performance Dashboards**: Customer acquisition, retention cohorts, visit volume, campaign delivery rates, coupon redemption conversion, and rating trends.
- **Exporting**: Tenant-isolated CSV downloads for all reporting modules.

### 9. Operational Governance & Security
- **Isolation Probes**: Verified via `/api/ops/security-tests` passing 8/8 cross-tenant security probes.
- **Bot Mitigation**: Cloudflare Turnstile server-side verification on all public-facing routes.
- **Plan Quotas & Rate Limiting**: Per-tenant token-bucket rate limits and usage metering.
- **Unified Scheduler**: Single periodic batch sweep covering all active tenants to prevent cron overload.

---

## Getting Started

### Prerequisites
- Node.js 20+ / Bun
- PostgreSQL (Neon) or SQLite (for local sandbox)

### Installation
```bash
# Clone the repository
git clone https://github.com/GS-ClientFlow/gs-clientflow.git
cd gs-clientflow

# Install dependencies
bun install
# or: npm install

# Initialize local database
bun run db:push
```

### Environment Configuration (`.env`)
```env
DATABASE_URL="file:./db/custom.db"
# Production Neon PostgreSQL:
# DATABASE_URL="postgres://user:password@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"

TURNSTILE_SECRET_KEY="optional-turnstile-secret-key"
```

### Development
```bash
bun run dev
# Open http://localhost:3000
```

---

## Continuous Implementation Report
For the complete technical compliance matrix and implementation details, refer to [IMPLEMENTATION_REPORT.md](file:///c:/Users/Code66/Downloads/GS-ClientFlow/IMPLEMENTATION_REPORT.md).
