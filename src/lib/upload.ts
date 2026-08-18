import { supabase } from './supabase'

const MAX_BYTES = 5 * 1024 * 1024 // 5MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

// Menu/vendor photos are display images, not documents -- nothing needs more
// than this to fill a card or a full-width cover on any screen we ship.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

// Downscales and re-encodes an image client-side before upload. Vendors on
// phones routinely produce 8-12MB photos straight from the camera; shipping
// those unmodified means every customer re-downloads that same multi-MB file
// on every menu load, which is punishing on Egyptian cellular. Re-encoding to
// JPEG caps the output regardless of input format (PNG screenshots included)
// since photographic content gains nothing from PNG's lossless encoding.
// Falls back to the original file if canvas decoding fails for any reason
// (corrupt image, unsupported format quirk) -- the original still passes the
// existing size/type validation, so upload isn't blocked by a compression bug.
export async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file

    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// Uploads an image to the public vendor-assets bucket and returns its public
// URL. `path` should be a stable, unique key per subject (e.g.
// `restaurants/12/logo`) -- a fresh timestamp suffix busts CDN/browser caching
// so the new image shows up immediately instead of showing the old one.
export async function uploadVendorImage(file: File, path: string): Promise<{ url: string | null; error: string | null }> {
  if (!ALLOWED.includes(file.type)) {
    return { url: null, error: 'الصورة لازم تكون jpg أو png أو webp' }
  }
  if (file.size > MAX_BYTES) {
    return { url: null, error: 'حجم الصورة أكبر من 5 ميجا' }
  }

  const uploadFile = await compressImage(file)
  const ext = uploadFile.type === 'image/png' ? 'png' : uploadFile.type === 'image/webp' ? 'webp' : 'jpg'
  const key = `${path}-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage.from('vendor-assets').upload(key, uploadFile, {
    cacheControl: '3600',
    upsert: false
  })
  if (uploadError) return { url: null, error: 'فشل رفع الصورة: ' + uploadError.message }

  const { data } = supabase.storage.from('vendor-assets').getPublicUrl(key)
  return { url: data.publicUrl, error: null }
}
