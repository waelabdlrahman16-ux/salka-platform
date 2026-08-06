// The one place Salka's own contact number lives.
//
// It used to be typed inline in Profile.tsx as a wa.me URL, which meant
// changing the number was a code search rather than an edit -- and a missed
// occurrence would have sent a customer with a problem to a phone nobody
// answers. Anything that needs to reach support imports from here.
//
// Stored as the local Egyptian form (leading 0) because that is what a human
// reads and dials; the wa.me form is derived, since WhatsApp wants E.164
// without the + or the leading zero.
export const SUPPORT_PHONE = '01505097297'

/** `20` + the number without its leading zero -- what wa.me expects. */
export const SUPPORT_WHATSAPP_URL =
  `https://wa.me/20${SUPPORT_PHONE.replace(/^0/, '')}`

/** `tel:` target, in international form so it dials from abroad too. */
export const SUPPORT_TEL_URL = `tel:+20${SUPPORT_PHONE.replace(/^0/, '')}`
