import { readFile } from 'node:fs/promises'

const migration = await readFile('supabase/migrations/20260821014958_quote_acceptance_state_machine.sql', 'utf8')
const quoteEdge = await readFile('supabase/functions/quote-operations/index.ts', 'utf8')
const vendorEdge = await readFile('supabase/functions/vendor-operations/index.ts', 'utf8')
const track = await readFile('src/pages/Track.tsx', 'utf8')

const requiredMigration = [
  [/now\(\) \+ interval '15 minutes'/, 'server-owned 15-minute expiry'],
  [/create table if not exists public\.order_quotes/, 'immutable quote table'],
  [/alter table public\.order_quotes enable row level security/, 'quote RLS'],
  [/create trigger guard_custom_order_quote_dispatch/, 'dispatch quote guard'],
  [/create trigger guard_custom_order_quote_fulfilment/, 'fulfilment quote guard'],
  [/create trigger initialize_order_quote_state/, 'new-order quote initializer'],
  [/orders_current_quote_matches_order_fk/, 'current quote ownership constraint'],
  [/quote\.superseded/, 'replacement audit event'],
  [/A price that has not changed is not a new commercial offer/, 'unchanged-offer reuse'],
  [/Do not raise here: an uncaught exception would roll back the state\/event/, 'immediate expiry persistence'],
  [/cron\.schedule\(/, 'expiry sweep schedule'],
  [/quote_admin_approval_ceiling_egp/, 'Admin quote ceiling setting'],
  [/quote_requires_admin_approval/, 'Admin quote ceiling database guard'],
]

for (const [pattern, name] of requiredMigration) {
  if (!pattern.test(migration)) throw new Error(`Missing ${name}`)
}

// Asserted one action at a time rather than as one contiguous string. The
// original pattern matched the four actions in the order they were first
// written, so shipping staffView, preview and renew -- all deliberate, all live
// -- broke a check that was meant to catch actions going MISSING, not being
// added. Each name is now checked on its own, and the list grows when the
// contract legitimately does.
for (const action of ['view', 'staffView', 'preview', 'issue', 'accept', 'reject', 'renew']) {
  if (!new RegExp(`"${action}"`).test(quoteEdge)) {
    throw new Error(`Quote Edge Function is missing the ${action} action`)
  }
}
if (!/orderToken \|\| !UUID\.test\(orderToken\)/.test(quoteEdge)) {
  throw new Error('Customer quote actions must require the opaque order token')
}
if (!/quote_requires_admin_approval/.test(quoteEdge)) {
  throw new Error('Quote Edge Function must surface the Admin-approval guard')
}
if (/confirmPrice/.test(vendorEdge)) {
  throw new Error('Legacy vendor confirmPrice action must remain retired')
}
if (!/function QuoteCountdown/.test(track) || !/أوافق على السعر/.test(track)) {
  throw new Error('Customer quote timer/acceptance UI is missing')
}

console.log('quote-state draft invariants: ok')
