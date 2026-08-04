import { createClient } from '@supabase/supabase-js'

// The publishable (anon) key is designed to be public — it ships in the browser
// bundle either way. Data is protected by row-level security policies, not by
// hiding this key. See supabase/auth.sql.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://pqpnwxyevrsipklzmwex.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_rI0HsZAc1WSRXAFce0BXBA_3Fiuz3Cj'

export const supabase = createClient(url, key)

