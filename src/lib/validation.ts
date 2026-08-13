// Egyptian mobile numbers: 11 digits, starting with 010, 011, 012, or 015.
// Accepts a leading +20/0020 too, normalizing before the check.
export function isValidEgyptPhone(raw: string): boolean {
  const digits = raw.trim().replace(/[\s-]/g, '')
  const local = digits.startsWith('+20') ? '0' + digits.slice(3)
    : digits.startsWith('0020') ? '0' + digits.slice(4)
    : digits
  return /^01[0125]\d{8}$/.test(local)
}

// Customer records are stored in a normalized ten-digit form (the local
// leading zero is removed). Never show that storage format to a person, and
// never prefill it into a form validated as a local Egyptian number.
export function displayEgyptPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (/^1[0125]\d{8}$/.test(digits)) return `0${digits}`
  if (/^01[0125]\d{8}$/.test(digits)) return digits
  return raw
}

export const PHONE_HINT = 'رقم مصري صحيح، مثال: 010xxxxxxxx'
