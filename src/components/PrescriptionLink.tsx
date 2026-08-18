import { useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Opens a prescription photo attached to a custom order.
 *
 * The `prescriptions` bucket is private -- deliberately, unlike the banners
 * one. These name a person and their medication, so there is no public URL to
 * link to and none is ever constructed. Instead a short-lived signed URL is
 * minted on demand, and only if the storage policy lets this caller read the
 * object at all: an admin, or the single vendor whose own order references it.
 *
 * Minted on click rather than on render, so a list of fifty orders does not
 * mint fifty URLs for photos nobody opens.
 */
export default function PrescriptionLink({ path }: { path: string | null | undefined }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!path) return null

  async function open() {
    setBusy(true); setError('')
    // 120 seconds: long enough to open, short enough that a URL copied out of
    // the address bar and pasted into a chat is dead by the time it arrives.
    const { data, error: err } = await supabase.storage
      .from('prescriptions').createSignedUrl(path!, 120)
    setBusy(false)
    if (err || !data?.signedUrl) { setError('مش قادرين نفتح الروشتة'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={open} disabled={busy}>
        {busy ? 'جاري الفتح…' : '📷 شوف الروشتة'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
