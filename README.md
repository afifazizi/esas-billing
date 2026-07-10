# ESAS Billing

Enterprise Storage Analytics System (ESAS) Billing is a modern rebuild of the legacy ESAS portal for Isilon/storage usage reporting, customer billing visibility, import tracking, and customer-scoped report access.

## Stack

- Backend: Node.js 22, Express 5, Prisma 5, SQLite for local development
- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, Recharts
- Auth: JWT access/refresh tokens with bcrypt password hashing
- Exports: PDFKit PDF generation and XLSX workbook export

## Repository layout

```text
backend/        Express API, Prisma schema, importer, export/report logic
frontend/       Next.js dashboard and customer portal
legacy-source/  Local-only legacy PHP/MySQL reference clone, ignored by Git
```

## Current system capabilities

- Admin/internal dashboard with year-aware analytics
- Customer, cluster, folder, price-tier, user, audit, import-run, and unmatched-path management
- Isilon CSV upload wizard with preview/confirm flow
- Report detail pages with summary charts and customer-facing PDF/Excel exports
- Customer Portal via `customer_viewer` role:
  - customer-bound read-only login
  - backend-enforced customer scoping
  - `/dashboard/my-usage` usage/file-count comparison
  - denial of upload, delete, reprice, import, unmatched, audit, user-management, and cross-customer access

## Local setup

### Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma db push --skip-generate
npm run start
```

Backend runs on:

```text
http://localhost:5050/api
```

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run build
npm run start -- -p 3000
```

Frontend runs on:

```text
http://localhost:3000
```

For LAN/WAN staging, leave `NEXT_PUBLIC_API_URL` unset so the frontend constructs the API base URL from the browser hostname and port `5050`.

## Database safety

The local SQLite database and backups are intentionally ignored by Git. Do not commit:

- `backend/prisma/dev.db`
- `*.db`
- `*.bak`
- SQL dumps
- upload files
- `.env` files

Before any schema change against a live/dev data set:

1. Back up `backend/prisma/dev.db`.
2. Use additive migrations or `prisma db push` only when safe.
3. Never run destructive reset commands without explicit operator approval.
4. Verify row counts and login after migration.

## Verification

Backend syntax/schema:

```bash
cd backend
node --check src/index.js
npx prisma validate
```

Frontend production build:

```bash
cd frontend
npm run build
```

Health checks when services are running:

```bash
curl http://localhost:5050/api/health
curl -Is http://localhost:3000/login
```

## Security notes

- Real `.env` files are ignored.
- GitHub/API tokens must never be committed.
- Customer isolation is enforced server-side; the frontend only mirrors access rules for UX.
- Customer viewers must have `custId` and are read-only.
