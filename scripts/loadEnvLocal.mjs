// Read .env.local into process.env, for the ops scripts only.
//
// WHY THIS EXISTS. Getting SUPABASE_DB_URL into a shell turned out to be the
// hardest part of running these scripts, and every route had a trap:
//
//   export VAR='...'                  the generated password contained a quote,
//                                     which closed the string early and left the
//                                     shell waiting at a `quote>` prompt
//   read -r VAR  + paste              the connection string was wrapped across
//                                     two lines in the dashboard, so it stopped
//                                     at the newline and captured 22 characters
//   export VAR=$(pbpaste | tr ...)    the clipboard held the command itself,
//                                     because you have to copy the command in
//                                     order to run it
//
// None of those are user error. They are a shell being asked to carry a long
// secret containing arbitrary characters. A file sidesteps all three: paste it
// once into a text editor, where quoting and line wrapping mean nothing.
//
// .env.local is gitignored. Vite also reads a file of that name, but only
// exposes variables prefixed VITE_, so SUPABASE_DB_URL cannot leak into the
// browser bundle.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')

export function loadEnvLocal() {
  if (!existsSync(ENV_PATH)) return false
  let loaded = false
  for (const raw of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // Tolerate wrapping quotes if someone adds them out of habit -- but only a
    // matching pair, so a password that merely CONTAINS a quote survives.
    if (value.length > 1 && ((value.startsWith("'") && value.endsWith("'")) ||
                             (value.startsWith('"') && value.endsWith('"')))) {
      value = value.slice(1, -1)
    }
    // A real environment variable wins, so CI (which sets it from a secret) is
    // never overridden by a stray local file.
    //
    // Locally that precedence is a trap, and it caught the first person to use
    // this: a broken value left over from an earlier `export` in the same
    // terminal silently beat the file they had just carefully filled in, and
    // the script reported the stale value as though the file were wrong. So
    // say so, loudly, rather than letting them fight an invisible winner.
    if (process.env[key] !== undefined && process.env[key] !== value) {
      console.error(`Note: ${key} is already set in this shell, so .env.local is being ignored for it.`)
      console.error(`      shell value: ${String(process.env[key]).replace(/:[^:@/]*@/, ':***@').slice(0, 60)}`)
      console.error(`      To use the file instead:  unset ${key}\n`)
    }
    if (!process.env[key]) { process.env[key] = value; loaded = true }
  }
  return loaded
}

export const ENV_LOCAL_PATH = ENV_PATH
