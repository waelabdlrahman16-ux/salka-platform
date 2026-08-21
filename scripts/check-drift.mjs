// What is in production that is not in this repository, and the reverse.
//
// WHY THIS EXISTS. On 2026-08-21 pricing a هنجبلك order was impossible in
// production for four days. The cause was not a bug in any file here: the
// repository had the confirmPrice action since 2026-08-18, and production was
// serving an edge function built before it. Nothing in CI, lint, typecheck or
// the test scripts can see that class of fault, because every file involved was
// individually correct. The only way to catch it is to ask production what it
// is actually running and compare.
//
// The same sweep immediately found more of it: an entire quote-approval system
// (order_quotes, orders.quote_state, two guard triggers, seven RPCs, the
// quote-operations function) live in production with no migration and no client
// code in this repository at all.
//
// TIMESTAMPS ARE NOT EVIDENCE. The first version of this compared a function's
// deployed updated_at against its last commit date and reported 24 of 26
// functions as stale. Almost all of that was noise: #137 ADDED those files to
// the repo on 2026-08-18, long after they were first deployed, so "the repo is
// newer" said nothing about content. customer-order-creation looked three hours
// stale by that measure and was byte-for-byte current. This script compares
// CONTENT, and reports nothing it has not actually diffed.
//
// USAGE
//   SUPABASE_ACCESS_TOKEN=sbp_...  node scripts/check-drift.mjs
//   (token from https://supabase.com/dashboard/account/tokens)
//   --json  machine-readable output
//
// Exit code is 1 when drift is found, so CI can gate on it.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'pqpnwxyevrsipklzmwex'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const API = 'https://api.supabase.com'
const asJson = process.argv.includes('--json')

if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is not set. Create one at')
  console.error('https://supabase.com/dashboard/account/tokens and re-run.')
  process.exit(2)
}

const api = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}
const sql = query => api(`/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST', body: JSON.stringify({ query }),
})

// Whitespace-only differences are not drift worth waking anyone for: a deploy
// through a different tool can reflow a file without changing behaviour.
const normalise = s => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()

const findings = { migrations: {}, functions: {}, rpcs: {} }
const say = line => { if (!asJson) console.log(line) }

// ---------------------------------------------------------------------------
// 1. Migrations, matched by NAME as well as version.
//
// Matching on version alone is misleading: applying a migration through the
// dashboard or the MCP server records it under a timestamp of that tool's
// choosing, so the same file appears as both "in prod only" and "in repo only".
// 30 of the 64 apparent mismatches in the first run were exactly that.
// ---------------------------------------------------------------------------
const applied = (await sql(
  'select version, name from supabase_migrations.schema_migrations order by version'
)).map(r => ({ version: r.version, name: r.name ?? '' }))

const files = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql'))
const repoMig = files.map(f => ({ version: f.slice(0, 14), name: f.slice(15, -4) }))

const appliedByName = new Map(applied.map(m => [m.name, m]))
const repoByName = new Map(repoMig.map(m => [m.name, m]))
const appliedVersions = new Set(applied.map(m => m.version))
const repoVersions = new Set(repoMig.map(m => m.version))

const prodOnly = applied.filter(m => !repoVersions.has(m.version) && !repoByName.has(m.name))
const repoOnly = repoMig.filter(m => !appliedVersions.has(m.version) && !appliedByName.has(m.name))
const renamed = applied.filter(m =>
  !repoVersions.has(m.version) && repoByName.has(m.name)
).map(m => ({ name: m.name, prod: m.version, repo: repoByName.get(m.name).version }))

findings.migrations = { prodOnly, repoOnly, renamed }

say(`\n=== MIGRATIONS ===`)
say(`applied in production: ${applied.length}    files in repo: ${repoMig.length}`)
say(`\n  APPLIED IN PRODUCTION, NO FILE HERE (${prodOnly.length})`)
prodOnly.forEach(m => say(`    ${m.version}  ${m.name}`))
say(`\n  IN THIS REPO, NEVER APPLIED (${repoOnly.length})`)
repoOnly.forEach(m => say(`    ${m.version}  ${m.name}`))
say(`\n  SAME NAME, DIFFERENT VERSION -- applied by another tool (${renamed.length})`)
renamed.forEach(m => say(`    prod ${m.prod}  repo ${m.repo}  ${m.name}`))

// ---------------------------------------------------------------------------
// 2. Edge functions, compared by CONTENT.
// ---------------------------------------------------------------------------
const deployed = await api(`/v1/projects/${PROJECT_REF}/functions`)
const repoFns = readdirSync('supabase/functions', { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name)

const deployedSlugs = new Set(deployed.map(f => f.slug))
const fnNotDeployed = repoFns.filter(f => !deployedSlugs.has(f))
const fnNotInRepo = deployed.map(f => f.slug).filter(s => !repoFns.includes(s))
const fnDiffers = []
const fnUnreadable = []

for (const slug of repoFns.filter(f => deployedSlugs.has(f))) {
  const localPath = join('supabase/functions', slug, 'index.ts')
  if (!existsSync(localPath)) continue
  let body
  try {
    body = await api(`/v1/projects/${PROJECT_REF}/functions/${slug}/body`)
  } catch (error) {
    fnUnreadable.push({ slug, reason: String(error.message).slice(0, 120) })
    continue
  }
  const live = (Array.isArray(body) ? body : body.files ?? [])
    .find(f => f.name.endsWith(`${slug}/index.ts`) || f.name === 'index.ts')
  if (!live) { fnUnreadable.push({ slug, reason: 'no index.ts in the deployed bundle' }); continue }
  if (normalise(live.content) !== normalise(readFileSync(localPath, 'utf8'))) fnDiffers.push(slug)
}

findings.functions = { notDeployed: fnNotDeployed, notInRepo: fnNotInRepo, differs: fnDiffers, unreadable: fnUnreadable }

say(`\n=== EDGE FUNCTIONS ===`)
say(`  DEPLOYED CONTENT DIFFERS FROM THIS REPO (${fnDiffers.length})`)
fnDiffers.forEach(s => say(`    ${s}`))
say(`\n  IN THIS REPO, NOT DEPLOYED (${fnNotDeployed.length})`)
fnNotDeployed.forEach(s => say(`    ${s}`))
say(`\n  DEPLOYED, NOT IN THIS REPO (${fnNotInRepo.length})`)
fnNotInRepo.forEach(s => say(`    ${s}`))
if (fnUnreadable.length) {
  say(`\n  COULD NOT BE COMPARED -- reported, never assumed clean (${fnUnreadable.length})`)
  fnUnreadable.forEach(f => say(`    ${f.slug}: ${f.reason}`))
}

// ---------------------------------------------------------------------------
// 3. Callable RPCs that nothing in this repository mentions.
//
// A public function service_role can execute is API surface. If no file here
// names it, either the client that calls it lives outside this repository, or
// it is dead surface nobody has removed. Both are worth knowing; neither is
// automatically a fault, so this section reports and does not fail the run on
// its own.
// ---------------------------------------------------------------------------
const rpcs = (await sql(`
  select distinct p.proname as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and has_function_privilege('service_role', p.oid, 'execute')
   order by 1`)).map(r => r.name)

const haystack = []
const walk = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(p) }
    else if (/\.(ts|tsx|js|mjs|sql)$/.test(entry.name)) haystack.push(readFileSync(p, 'utf8'))
  }
}
walk('src'); walk('supabase/functions')
const blob = haystack.join('\n')
const orphanRpcs = rpcs.filter(name => !blob.includes(name))
findings.rpcs = { total: rpcs.length, orphans: orphanRpcs }

say(`\n=== CALLABLE RPCs NOT MENTIONED ANYWHERE IN THIS REPO (${orphanRpcs.length} of ${rpcs.length}) ===`)
orphanRpcs.forEach(n => say(`    ${n}`))

// ---------------------------------------------------------------------------
const blocking = prodOnly.length + repoOnly.length + fnDiffers.length + fnNotInRepo.length + fnUnreadable.length
if (asJson) console.log(JSON.stringify(findings, null, 2))
else {
  say(`\n=== SUMMARY ===`)
  say(`  migrations in production with no file here : ${prodOnly.length}`)
  say(`  migrations here never applied             : ${repoOnly.length}`)
  say(`  edge functions whose content differs      : ${fnDiffers.length}`)
  say(`  edge functions deployed but not here      : ${fnNotInRepo.length}`)
  say(`  edge functions that could not be compared : ${fnUnreadable.length}`)
  say(`  RPCs no file here mentions                : ${orphanRpcs.length}  (reported, not counted as failure)`)
  say(blocking ? `\ndrift found` : `\nno drift`)
}
process.exit(blocking ? 1 : 0)
