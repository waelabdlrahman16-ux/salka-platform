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

Filenames and ledger versions were realigned for 23 migrations, and **all 38
ledger-only migrations have been reconstructed and checksum-verified**. Every
version in `schema_migrations` now has a file. What remains:

- **0 ledger versions with no local file.**
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

## What a reconstruction is faithful to

The ledger stores the statements as **executed**, which is not always identical
to the file as **authored**. `20260810163258` is the proof: the repository's copy
of it carries fifteen lines of leading commentary explaining why the RLS policies
were consolidated, and the ledger's copy begins at the first `drop policy`. A
leading comment block is not a statement, so it never reached the ledger.

The practical rule: where a file already exists, keep it -- it may carry
reasoning the ledger cannot. Reconstruct only what is missing. That is what was
done here; the repository's richer `20260810163258` was left untouched.

## Worth knowing about the first five reconstructed

`20260810021459`, `022022`, `022738` and `022819` build a vendor
"remind me when it opens" feature, and `20260810023256` reverts all of it the
same day — including a cron that had been firing every minute in production for
a feature no deployed client could reach. They are missing from the repository
because the branch was pulled, not because anything was lost.
