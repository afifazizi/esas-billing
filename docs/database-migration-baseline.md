# Prisma Migration Baseline and Fresh Database Bootstrap

The repository contains an additive lifecycle migration at:

`backend/prisma/migrations/20260714000000_add_report_period_lifecycle/migration.sql`

Do not rewrite that migration after it has been reviewed or applied. The historical ESAS database predates Prisma Migrate and may be populated without a `_prisma_migrations` ledger, so `prisma migrate deploy` can correctly fail with `P3005`.

## Baseline an existing populated production database

This procedure is only for the reviewed additive lifecycle migration. Never use `prisma migrate reset`, delete tables, reseed, or run an unreviewed `db push` against production.

1. Stop application writes and take a byte-for-byte database backup.
2. Record SHA-256 checksums for the source database and backup; they must match before continuing.
3. Record business-table row counts for users, customers, departments, folders, prices, reports, imports, unmatched directories, and audit logs.
4. Copy the production database to a disposable location.
5. On the copy, execute the lifecycle migration SQL inside one explicit transaction.
6. Verify `PRAGMA integrity_check` returns `ok`, the lifecycle tables and indexes exist, and every recorded business-table count is unchanged.
7. If `prisma migrate deploy` was attempted on the live database, verify the failed `P3005` attempt made no schema or ledger changes.
8. Apply the same reviewed additive SQL to the live database inside one explicit transaction.
9. Register the already-applied migration without replaying it:

   ```bash
   cd backend
   npx prisma migrate resolve --applied 20260714000000_add_report_period_lifecycle
   npx prisma generate
   npx prisma migrate status
   ```

10. Re-run integrity checks, migration-ledger inspection, and the exact row-count comparison. Resume writes only after all checks pass.

If the SQL would drop, rename, rewrite, or backfill an existing business table, stop and require a separate destructive-change review.

## Bootstrap a fresh local or disposable database

The current migration directory is not a complete from-empty history: the additive lifecycle migration assumes the pre-existing ESAS tables already exist. Therefore, do not claim that `prisma migrate deploy` can build a fresh database from this directory.

For local development, tests, or disposable verification only:

```bash
cd backend
# Point DATABASE_URL at a new disposable database, never the live database.
npx prisma generate
npx prisma db push --skip-generate
```

Then create only the minimum test fixtures required by the test harness. Do not run production seeds or import production data by default.

For a new managed production environment, create and review a separate complete from-empty baseline migration from `schema.prisma` in a dedicated migration-history release. Reconcile the additive lifecycle migration in that release before deployment so lifecycle tables are not created twice. Do not add a generated full-schema baseline to the current history until that reconciliation and a fresh-database parity test have been reviewed.

## Required parity verification for a future full baseline

A future from-empty baseline is acceptable only when an automated disposable-database check proves:

- `prisma migrate deploy` succeeds from an empty database;
- `prisma validate` succeeds;
- the resulting tables, columns, indexes, unique constraints, and foreign keys match `schema.prisma`;
- the lifecycle migration is represented exactly once;
- a second `prisma migrate deploy` is a no-op;
- no seed mutates existing credentials or business data.
