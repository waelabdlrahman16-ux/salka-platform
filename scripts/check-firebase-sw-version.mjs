// Fails the build when public/firebase-messaging-sw.js pins a different Firebase
// SDK version from the one the app bundles.
//
// This is not hygiene. The two halves share one IndexedDB per origin and
// disagree about its schema version when they differ, so getToken() throws
//
//   VersionError: The requested version (1) is less than the existing version (2)
//
// and push silently never registers. That shipped: bundle on firebase 12.17.0,
// worker pinned to compat 10.14.1. Nothing in typecheck, lint or the production
// build noticed, because both files were individually valid.
//
// A comment saying "keep these in sync" was already in the worker before this
// happened. Comments are not a mechanism.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const declared = (pkg.dependencies?.firebase ?? '').replace(/^[\^~>=<\s]+/, '')

if (!declared) {
  console.error('[firebase-sw] `firebase` is not in package.json dependencies.')
  process.exit(1)
}

const swPath = join(root, 'public', 'firebase-messaging-sw.js')
const sw = readFileSync(swPath, 'utf8')

const found = [...sw.matchAll(/gstatic\.com\/firebasejs\/([0-9]+\.[0-9]+\.[0-9]+)\//g)]
  .map(m => m[1])

if (found.length === 0) {
  console.error('[firebase-sw] No gstatic firebasejs importScripts found in public/firebase-messaging-sw.js.')
  process.exit(1)
}

const wrong = [...new Set(found)].filter(v => v !== declared)

if (wrong.length > 0) {
  console.error(
    `\n[firebase-sw] VERSION MISMATCH -- push would break silently.\n` +
    `  package.json firebase:            ${declared}\n` +
    `  firebase-messaging-sw.js imports: ${[...new Set(found)].join(', ')}\n\n` +
    `  Both halves share one IndexedDB on the origin. Different major versions\n` +
    `  disagree on its schema version and getToken() throws VersionError, so no\n` +
    `  push token is ever registered.\n\n` +
    `  Fix: set every gstatic import in public/firebase-messaging-sw.js to ${declared}.\n`
  )
  process.exit(1)
}

console.log(`[firebase-sw] ok -- worker and bundle both on firebase ${declared}`)
