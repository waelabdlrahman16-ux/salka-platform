import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isValidEgyptPhone, PHONE_HINT } from '../lib/validation'

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const touched = phone.trim().length > 0

  function finish(save: boolean) {
    if (save) {
      if (name.trim()) localStorage.setItem('salka_name', name.trim())
      if (isValidEgyptPhone(phone)) localStorage.setItem('salka_phone', phone.trim())
    }
    localStorage.setItem('salka_onboarded', '1')
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 bg-night grid place-items-center p-4">
      <div className="card w-full max-w-sm p-6 text-center">
        <div className="text-4xl mb-3">👋</div>
        <h1 className="text-xl font-bold mb-1">أهلاً بيك في سالكة</h1>
        <p className="text-mist text-sm mb-5">
          قولنا اسمك ورقمك، عشان ما تكتبهملش في كل مرة تطلب فيها
        </p>

        <div className="text-right space-y-3 mb-5">
          <div>
            <label className="label">الاسم</label>
            <input className="field" value={name} onChange={e => setName(e.target.value)} placeholder="اسمك بالكامل" />
          </div>
          <div>
            <label className="label">رقم الموبايل</label>
            <input className={`field ${touched && !isValidEgyptPhone(phone) ? '!border-red-400' : ''}`}
              dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" maxLength={13} />
            {touched && !isValidEgyptPhone(phone) && <p className="text-xs text-red-600 mt-1">{PHONE_HINT}</p>}
          </div>
        </div>

        <button className="btn-sea w-full !py-3 mb-2" disabled={!name.trim() || !isValidEgyptPhone(phone)}
          onClick={() => finish(true)}>
          ابدأ
        </button>
        <button className="text-sm text-mist hover:text-foam" onClick={() => finish(false)}>
          تخطي دلوقتي
        </button>

        <p className="text-xs text-mist mt-5">
          باستخدامك للتطبيق إنت موافق على <Link to="/terms" className="text-sea underline" onClick={() => finish(false)}>الشروط والأحكام</Link>
        </p>
      </div>
    </div>
  )
}
