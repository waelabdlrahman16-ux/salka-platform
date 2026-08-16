#!/usr/bin/env node
// Regenerate supabase/baseline/ from production.
//
// WHY THIS EXISTS. The baseline is the photograph of what production
// permissions are supposed to look like, and it is the only thing that can tell
// you a grant changed when nobody meant it to. It was captured by hand, so it
// drifted: by 2026-08-16 it was 57 migrations, 31 policies and 8 tables behind
// the database it claimed to describe.
//
// That is not a discipline problem, it is a tooling problem. A snapshot that
// takes an afternoon of copying JSON around gets skipped, and a skipped
// snapshot is why an unauthenticated order-creation hole sat open for three
// days without anything noticing (audit findings 02 and 03).
//
// So: one command, no copying.
//
//   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:6543/postgres'
//   node scripts/capture-baseline.mjs
//
// Get the URL from Supabase → Project Settings → Database → Connection string →
// URI (session pooler is fine). It contains the database password, so set it in
// your shell for the one command and do not commit it anywhere.
//
// Everything here is read-only: SELECTs against system catalogues. It cannot
// modify the database, and it never reads table rows -- no customer records, no
// order data, no secrets. Review `git diff supabase/baseline/` before
// committing, which is the entire point of the exercise.
//
// database.types.ts is NOT produced here -- it comes from the Supabase CLI:
//
//   supabase gen types typescript --project-id pqpnwxyevrsipklzmwex > supabase/baseline/database.types.ts

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'baseline')
const PROJECT_REF = 'pqpnwxyevrsipklzmwex'

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL is not set. See the comment at the top of this file.')
  process.exit(1)
}

// The seven predicates that back row-level security. If any of them loses
// `authenticated` EXECUTE, every vendor and driver screen that reads orders,
// assignments or restaurants goes dark -- RLS evaluates policies as the CALLING
// role, so this is not something SECURITY DEFINER rescues. The capture asserts
// on them rather than merely recording them, because a baseline that quietly
// snapshots a broken state is worse than no baseline.
const PROTECTED = [
  'is_admin', 'my_driver_id', 'is_catalog_manager', 'is_supervisor',
  'my_restaurant_id', 'supervisor_may_touch_order', 'my_customer_id',
]

const Q = {
  publicTables: `
    select json_agg(t order by t->>'table') from (
      select json_build_object(
        'table', c.relname,
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity,
        'policy_count', (select count(*) from pg_policy p where p.polrelid = c.oid),
        'columns', (
          select json_agg(json_build_object(
            'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull, 'default', pg_get_expr(ad.adbin, ad.adrelid)
          ) order by a.attnum)
          from pg_attribute a
          left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
        'constraints', (
          select json_agg(json_build_object(
            'name', con.conname,
            'type', case con.contype when 'p' then 'PRIMARY KEY' when 'f' then 'FOREIGN KEY'
                                     when 'u' then 'UNIQUE' when 'c' then 'CHECK' else con.contype::text end,
            'definition', pg_get_constraintdef(con.oid)
          ) order by con.conname)
          from pg_constraint con where con.conrelid = c.oid)
      ) as t
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    ) s`,

  routines: `
    select json_agg(r order by r->>'schema', r->>'signature') from (
      select json_build_object(
        'schema', n.nspname,
        'name', p.proname,
        'signature', p.oid::regprocedure::text,
        'returns', pg_get_function_result(p.oid),
        'language', l.lanname,
        'security_definer', p.prosecdef,
        'volatility', case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
        'config', p.proconfig,
        'execute', json_build_object(
          'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
          'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
          'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE')),
        'definition', p.prosrc
      ) as r
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
      where n.nspname in ('public', 'private')
    ) s`,

  policies: `
    select json_agg(x order by x->>'schema', x->>'table', x->>'policy') from (
      select json_build_object(
        'schema', n.nspname, 'table', c.relname, 'policy', pol.polname,
        'command', case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                                   when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
        'permissive', pol.polpermissive,
        'roles', (select coalesce(array_agg(rolname order by rolname), array['PUBLIC'])
                    from pg_roles where oid = any(pol.polroles)),
        'using', pg_get_expr(pol.polqual, pol.polrelid),
        'with_check', pg_get_expr(pol.polwithcheck, pol.polrelid)
      ) as x
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
    ) s`,

  triggers: `
    select json_agg(x order by x->>'table', x->>'trigger') from (
      select json_build_object(
        'schema', n.nspname, 'table', c.relname, 'trigger', t.tgname,
        'function', p.oid::regprocedure::text,
        'definition', pg_get_triggerdef(t.oid),
        'enabled', t.tgenabled = 'O'
      ) as x
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal
    ) s`,

  indexes: `
    select json_agg(x order by x->>'table', x->>'index') from (
      select json_build_object('schema', schemaname, 'table', tablename,
                               'index', indexname, 'definition', indexdef) as x
      from pg_indexes where schemaname in ('public', 'private')
    ) s`,

  grants: `
    select json_build_object(
      'tables', (
        select json_agg(x order by x->>'table', x->>'grantee') from (
          select json_build_object('schema', table_schema, 'table', table_name, 'grantee', grantee,
                   'privileges', array_agg(privilege_type order by privilege_type)) as x
          from information_schema.role_table_grants
          where table_schema in ('public','private') and grantee in ('anon','authenticated','service_role')
          group by table_schema, table_name, grantee) s),
      'schemas', (
        select json_agg(x order by x->>'schema', x->>'grantee') from (
          select json_build_object('schema', n.nspname, 'grantee', r.rolname,
                   'usage', has_schema_privilege(r.rolname, n.nspname, 'USAGE'),
                   'create', has_schema_privilege(r.rolname, n.nspname, 'CREATE')) as x
          from pg_namespace n
          cross join (select unnest(array['anon','authenticated','service_role']) as rolname) r
          where n.nspname in ('public','private')) s)
    )`,

  migrationHistory: `
    select json_agg(json_build_object('version', version, 'name', name) order by version)
    from supabase_migrations.schema_migrations`,

  counts: `
    select json_build_object(
      'tables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relkind='r'),
      'views', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relkind='v'),
      'functions_public', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                             where n.nspname='public'),
      'functions_private', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                              where n.nspname='private'),
      'functions_security_definer', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                       where n.nspname in ('public','private') and p.prosecdef),
      'policies', (select count(*) from pg_policy),
      'triggers', (select count(*) from pg_trigger where not tgisinternal),
      'indexes', (select count(*) from pg_indexes where schemaname='public'),
      'migrations', (select count(*) from supabase_migrations.schema_migrations))`,

  protectedPredicates: `
    select json_agg(json_build_object(
      'function', p.proname,
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])`,
}

const client = new pg.Client({ connectionString: url })
await client.connect()

const one = async (sql, params) => (await client.query(sql, params)).rows[0]
const val = obj => Object.values(obj)[0]

const write = (name, data) => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n')
  const bytes = JSON.stringify(data).length
  console.log(`  ${name.padEnd(26)} ${String(Math.round(bytes / 1024)).padStart(5)} KB`)
}

console.log(`Capturing baseline from ${PROJECT_REF}\n`)

// Assert before writing. A capture that records a broken permission model as if
// it were the intended one turns the safety net into a rubber stamp.
const predicates = val(await one(Q.protectedPredicates, [PROTECTED]))
const broken = (predicates ?? []).filter(p => !p.authenticated_execute)
const missing = PROTECTED.filter(n => !(predicates ?? []).some(p => p.function === n))
if (broken.length || missing.length) {
  console.error('\nREFUSING TO CAPTURE. Protected RLS predicates are not intact:')
  broken.forEach(p => console.error(`  ${p.function}: authenticated has LOST execute`))
  missing.forEach(n => console.error(`  ${n}: function not found`))
  console.error('\nVendor and driver screens depend on these. Fix production first.')
  await client.end()
  process.exit(1)
}
console.log(`  ${PROTECTED.length} protected predicates intact\n`)

write('public-tables.json',    val(await one(Q.publicTables)))
write('routines.json',         val(await one(Q.routines)))
write('policies.json',         val(await one(Q.policies)))
write('triggers.json',         val(await one(Q.triggers)))
write('indexes.json',          val(await one(Q.indexes)))
write('grants.json',           val(await one(Q.grants)))
write('migration-history.json',val(await one(Q.migrationHistory)))

const counts = val(await one(Q.counts))
const pgVersion = val(await one(`select current_setting('server_version')`))
write('manifest.json', {
  project_ref: PROJECT_REF,
  schemas: ['public', 'private'],
  captured_at: new Date().toISOString(),
  captured_by: 'scripts/capture-baseline.mjs',
  postgres_version: pgVersion,
  snapshot_only: true,
  includes_data_rows: false,
  counts,
  protected_predicates_intact: PROTECTED,
})

await client.end()
console.log(`
Done. Now:
  1. supabase gen types typescript --project-id ${PROJECT_REF} > supabase/baseline/database.types.ts
  2. git diff supabase/baseline/   <-- READ THIS. It is the whole point.
     Look for privilege changes you did not make.
  3. Commit.
`)
