import { useCustomerAuth } from '../lib/customerAuth'
import { useDismissable } from '../lib/useDismissable'
import VerifiedPhoneEditor from './VerifiedPhoneEditor'

export default function PhonePrompt() {
  const { logout } = useCustomerAuth()
  // null: deliberately unskippable -- an order cannot be delivered without a
  // phone number. It still gets the focus trap, so Tab cannot wander into the
  // page underneath, which is what made this feel like a hang.
  const overlayRef = useDismissable<HTMLDivElement>(null)
  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 bg-night grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="card w-full max-w-sm p-6 text-center">
        <div className="text-4xl mb-3">📱</div>
        <h1 className="text-xl font-bold mb-1">رقم موبايلك؟</h1>
        <p className="text-mist text-sm mb-5">محتاجينه عشان المندوب يقدر يوصلك ويكلمك</p>

        <VerifiedPhoneEditor />
        <button className="text-sm text-mist hover:text-foam mt-3" onClick={logout}>تسجيل خروج</button>
      </div>
    </div>
  )
}
