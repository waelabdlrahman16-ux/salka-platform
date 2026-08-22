# The migration ledger stores its own SQL

**Finding, 22 Aug 2026.** `supabase_migrations.schema_migrations` has a
`statements text[]` column holding the SQL of every migration as applied. A
migration that exists in the ledger but has no file in `supabase/migrations/`
can therefore be reconstructed **from the ledger itself** — byte for byte, no
Supabase CLI, no remote database password, no schema diff.

This corrects an assumption carried in `ORPHAN-MIGRATIONS-2026-08-10.md` and
repeated since: that reconciling the ledger needed a linked CLI. It does not.

## How

```sql
select version, name, array_to_string(statements, E';\n')
from supabase_migrations.schema_migrations
where version = '20260810021459';
```

Write that text to `supabase/migrations/<version>_<name>.sql`, then verify:

```sql
select md5(array_to_string(statements, E';\n'))
from supabase_migrations.schema_migrations where version = '...';
```

against `md5sum` of the file. The only expected variation is a trailing
newline: some ledger entries carry one and some do not, and a file ending in a
newline is correct either way.

## State as of 22 Aug 2026

Filenames and ledger versions were realigned for 23 migrations. What remains:

- **38 ledger versions with no local file.** All 38 have their SQL stored
  (89,566 characters total), so all 38 are reconstructable by the method above.
  Nine were done and checksum-verified; the rest were not.
- **7 local files with no ledger version.** These are NOT reconstructable and
  are a different problem:
  - `record_actor_on_money_movements` and
    `promo_functions_live_redemptions_and_release` are single files whose work
    the ledger recorded as two rows each. Matching them means splitting a file,
    which is a rewrite, not a rename.
  - `restore_customer_checkout_settings_read`, `isolated_audit_order_protection`,
    `admin_assisted_account_recovery`, `bulk_restaurant_price_management` and
    `restrict_delivery_override_to_admin` have no ledger row under any name.
    Whether they ever ran cannot be settled from the ledger; that one does need
    a schema comparison.

## Worth knowing about the first five reconstructed

`20260810021459`, `022022`, `022738` and `022819` build a vendor
"remind me when it opens" feature, and `20260810023256` reverts all of it the
same day — including a cron that had been firing every minute in production for
a feature no deployed client could reach. They are missing from the repository
because the branch was pulled, not because anything was lost.
