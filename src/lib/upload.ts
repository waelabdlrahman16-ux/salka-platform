import { supabase } from './supabase'

const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

// Uploads an image to the public vendor-assets bucket and returns its public
// URL. `path` should be a stable, unique key per subject (e.g.
// `restaurants/12/logo`) — a fresh timestamp suffix busts CDN/browser caching
// so the new image shows up immediately instead of showing the old one.
export async function uploadVendorImage(file: File, path: string): Promise<{ url: string | null; error: string | null }> {
  if (!ALLOWED.includes(file.type)) {
    return { url: null, error: 'الصورة لازم تكون jpg أو png أو webp' }
  }
  if (file.size > MAX_BYTES) {
    return { url: null, error: 'حجم الصورة أكبر من 5 ميجا' }
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const key = `${path}-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage.from('vendor-assets').upload(key, file, {
    cacheControl: '3600',
    upsert: false
  })
  if (uploadError) return { url: null, error: 'فشل رفع الصورة: ' + uploadError.message }

  const { data } = supabase.storage.from('vendor-assets').getPublicUrl(key)
  return { url: data.publicUrl, error: null }
}
