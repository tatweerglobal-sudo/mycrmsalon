# My CRM Salon

Independent beauty-centre **SaaS foundation** for non-medical beauty salons only.

> **Status: development scaffold, not production ready.** Authentication, tenant-specific data access, database schema, appointments, payments and subscriptions have not yet been implemented.

## Isolation rules

- Different private GitHub repository from Somoud Recruitment CRM.
- Separate Neon project/database is required. Use only `SALON_DATABASE_URL` and `SALON_TEST_DATABASE_URL`.
- Never copy user records, credentials, cookies, tokens, migrations, or live deployment config from Somoud.
- Never connect to or modify `crmtatweer.de` or the recruitment system.
- Work on `feature/beauty-saas-foundation` until reviewed; no automatic deployment.

## Reused and adapted from Somoud's GitHub code

- Next.js 14, TypeScript, Tailwind, responsive RTL base styling/config.
- Reusable navigation component and date-range filter UI.
- Arabic search normalization and international E.164 phone normalization.
- Password hashing helper (stronger 12-character minimum) and PostgreSQL connection/transaction utility, **disconnected until a dedicated Neon database is configured**.
- WhatsApp URL utility rewritten around validated E.164 numbers for multi-country use.

## Deliberately excluded

- Recruitment/candidates/jobs/interviews endpoints, screens and models.
- Old RBAC, session middleware and authentication routes (tied to recruiter/employee schema).
- Existing migrations, Neon URLs, tokens, extensions, Google Drive/Calendar OAuth, backups, deployment scripts and customer data.
- Existing reporting/dashboard API (recruitment-specific).
- Old date-range SQL implementation because it assumes a fixed UTC offset for Egypt.

## Local development

Use Node.js 20+.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

The first install generates a new lockfile; commit it after review. Do not add real secrets to Git.

## Planned next development stage

1. Create a separate Neon database and verify credentials cannot access recruitment data.
2. Design salons/tenants, branches, staff, services, customers and appointments schema.
3. Implement authenticated tenant isolation with RLS and automated cross-tenant tests.
4. Implement bookings, pricing and payments before accepting any real customer data.
