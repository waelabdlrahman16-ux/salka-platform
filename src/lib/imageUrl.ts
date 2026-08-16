// Serve storage images at the size and shape they are actually displayed.
//
// WHY THIS EXISTS. Every photo on the customer's screen was served at whatever
// resolution the person who uploaded it happened to have. Measured on
// production 2026-08-16, the home screen pulled 5,161 KB -- including a single
// menu-item photo of 1,504 KB and three more over 290 KB -- and Lighthouse put
// Largest Contentful Paint at 13.6 seconds on a throttled mobile connection.
//
// That cost was always there; it was simply never paid, because the location
// modal blocked rendering and nobody reached the images behind it. Opening the
// storefront (finding 01) exposed it. Measured across the six heaviest images:
// 3,257 KB becomes 254 KB, a 92% cut.
//
// WHY BOTH WIDTH AND HEIGHT, ALWAYS.
//
// Passing width alone does NOT scale proportionally. Verified against a real
// 660x660 logo:
//
//   ?width=128                 -> 128x660   squashed, and object-cover then
//                                           renders a blank-looking sliver
//   ?width=128&height=128      -> 128x128   correct
//
// The first version of this file passed width only, and every restaurant logo
// on the home screen turned into an empty white box. Caught by looking at a
// screenshot -- the images reported complete=true and naturalWidth=128, so an
// automated "is it broken" check said they were fine. Always send both.
//
// WebP is free: browsers send `Accept: image/webp` on image requests and the
// endpoint honours it, so there is nothing to negotiate in code.

/**
 * Presets are named for the SHAPE of the box, not the thing inside it, because
 * the shape is what has to match. Dimensions are roughly 2x the CSS pixels the
 * element occupies on a 375px-wide phone, for retina.
 *
 * `resize` is left at its default (cover), which matches the `object-cover`
 * every one of these elements already uses -- so the server crops exactly the
 * way the browser would have.
 */
export const IMG = {
  /** aspect-[5/2] boxes: BannerRail tiles, FeedAdCard, RestaurantCard covers. */
  wide: { w: 750, h: 300 },
  /** aspect-[4/3] boxes: ProductCard. */
  photo: { w: 600, h: 450 },
  /** aspect-square boxes: FeaturedProductsRail, cart line items. */
  square: { w: 300, h: 300 },
  /** Small square chips: restaurant logos, add-on swatches, order-line thumbs. */
  icon: { w: 128, h: 128 },
} as const

export type ImgPreset = typeof IMG[keyof typeof IMG]

// Supabase serves the same bucket from the project domain and from the custom
// auth domain, and both appear in the wild because different admin screens
// built URLs at different times. Matching on the PATH rather than the host
// covers both without hardcoding either.
const OBJECT_PATH = '/storage/v1/object/public/'
const RENDER_PATH = '/storage/v1/render/image/public/'

/**
 * Rewrite a Supabase public-object URL so the CDN resizes it before sending.
 *
 * Anything that is not a Supabase public object -- a data: URI, a blob: preview
 * of a file mid-upload, an external logo, an empty string, null -- is returned
 * untouched. Getting this wrong 404s the image rather than merely serving it
 * large, so the guard is deliberately conservative: transform only what is
 * definitely transformable.
 */
export function sized(url: string | null | undefined, preset: ImgPreset, quality = 70): string {
  if (!url) return ''
  // Already transformed. Calling sized() twice would otherwise produce
  // .../render/image/public/render/image/public/... and 404.
  if (url.includes(RENDER_PATH)) return url
  if (!url.includes(OBJECT_PATH)) return url

  const transformed = url.replace(OBJECT_PATH, RENDER_PATH)
  // Preserve any query string already present -- a cache-buster on a re-uploaded
  // image is exactly the case where dropping it serves a stale photo forever.
  const join = transformed.includes('?') ? '&' : '?'
  return `${transformed}${join}width=${preset.w}&height=${preset.h}&quality=${quality}`
}
