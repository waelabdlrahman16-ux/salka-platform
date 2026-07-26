// Egyptian mobile numbers: 11 digits, starting with 010, 011, 012, or 015.
// Accepts a leading +20/0020 too, normalizing before the check.
export function isValidEgyptPhone(raw: string): boolean {
  const digits = raw.trim().replace(/[\s-]/g, '')
  const local = digits.startsWith('+20') ? '0' + digits.slice(3)
    : digits.startsWith('0020') ? '0' + digits.slice(4)
    : digits
  return /^01[0125]\d{8}$/.test(local)
}

export const PHONE_HINT = 'رقم مصري صحيح، مثال: 010xxxxxxxx'
