import { useCustomerAuth } from '../lib/customerAuth'
import Icon from './Icon'
import { useDismissable } from '../lib/useDismissable'
import VerifiedPhoneEditor from './VerifiedPhoneEditor'

export default function PhonePrompt() {
  const { logout } = useCustomerAuth()
  // null: deliberately unskippable -- an order cannot be delivered without a
  // phone number. It still gets the focus trap, so Tab cannot wander into the
  // page underneath, which is what made this feel like a hang.
  const overlayRef = useDismissable<HTMLDivElement>(null)
  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 bg-night grid place-items-center p-4" role="dialog" aria-labelledby="phone-prompt-title" aria-modal="true">
      <div className="card w-full max-w-sm p-6 text-center">
        <Icon name="mobileScreen" className="w-10 h-10 mx-auto mb-3 text-mist" />
        <h1 id="phone-prompt-title" className="text-xl font-bold mb-1">رقم موبايلك؟</h1>
        <p className="text-mist text-sm mb-5">محتاجينه عشان المندوب يقدر يوصلك ويكلمك</p>

        <VerifiedPhoneEditor />
        <button className="text-sm text-mist hover:text-foam mt-3" onClick={logout}>تسجيل خروج</button>
      </div>
    </div>
  )
}
