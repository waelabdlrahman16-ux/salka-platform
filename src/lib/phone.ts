// One rule for turning a stored customer phone into something tappable.
//
// Customer phones are NOT stored in a single format. `place_order` and
// `submit_custom_order` write whatever the customer typed, so `customer_phone`
// holds both `01126272616` and `1126272616` -- as of 21 Aug 2026, 229 of 264
// orders had no leading zero. The database is consistent about *matching*
// (`normalize_phone()` keeps the last 10 digits) but never about storage.
//
// That is why Driver.tsx's `phone.replace(/^0/, '20')` produced `wa.me/1126…`
// -- an invalid number -- on the majority of orders: the regex only fires when
// a leading zero happens to be there. Anything that dials or messages a
// customer imports from here instead of doing its own string surgery.
//
// Both helpers work from the last 10 digits, so every stored form -- bare,
// leading zero, `20…`, `+20…`, or spaced -- lands on the same number.

/** The last 10 digits: `+20 112 627 2616`, `01126272616` -> `1126272616`. */
const core = (phone: string) => phone.replace(/[^0-9]/g, '').slice(-10)

/** Local Egyptian form with its leading zero -- what a human reads and dials. */
export const dialLocal = (phone: string) => `0${core(phone)}`

/** `tel:` target in international form, so it dials from abroad too. */
export const telUrl = (phone: string) => `tel:+20${core(phone)}`

/** WhatsApp wants E.164 digits with no `+` and no leading zero. */
export const whatsappUrl = (phone: string) => `https://wa.me/20${core(phone)}`
