import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Board = {
  today: number; yesterday: number; incoming: number; ready: number; on_way: number; delivered_today: number
  recent: { id: number; restaurant_name: string; status: string; kitchen_status: string; created_at: string }[]
}

export default function Observer() {
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState('')
  async function load() {
    const { data, error } = await supabase.rpc('observer_dashboard')
    if (error) { setError('مش قادرين نجيب لوحة المتابعة دلوقتي'); return }
    setError(''); setBoard(data as Board)
  }
  // A read-only dashboard: poll only while it is on screen, and refresh the
  // moment it comes back. See lib/usePollWhenVisible for why.
  useEffect(() => {
    load()
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const timer = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('online', tick)
    }
  }, [])
  const cards = board ? [
    ['طلبات اليوم', board.today], ['أمس', board.yesterday], ['وارد', board.incoming],
    ['جاهز لمندوب', board.ready], ['في الطريق', board.on_way], ['تم اليوم', board.delivered_today],
  ] : []
  return <div className="space-y-5">
    <div><p className="text-sea font-semibold">متابعة فقط</p><h1 className="text-3xl font-black mt-1">لوحة المراقبة</h1><p className="text-sm text-mist mt-2">آخر تحديث تلقائي كل 30 ثانية. لا يمكن تنفيذ أي إجراء من هذه الصفحة.</p></div>
    {error && <div className="card p-4 text-danger">{error}<button className="btn-ghost mr-3 !py-1" onClick={load}>إعادة المحاولة</button></div>}
    {!board ? <p className="text-mist text-center py-10">جاري التحميل…</p> : <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map(([label, value]) => <div className="card p-4" key={String(label)}><p className="text-sm text-mist">{label}</p><p className="text-3xl font-black mt-1">{value}</p></div>)}
      </div>
      <div className="card overflow-hidden"><div className="p-4 border-b border-line"><h2 className="font-bold">آخر الطلبات</h2><p className="text-xs text-mist mt-1">بدون أسماء عملاء أو أرقام أو مبالغ</p></div>
        <div className="divide-y divide-line">{board.recent.map(o => <div className="p-4 flex justify-between gap-4" key={o.id}><div><p className="font-semibold">طلب #{o.id}: {o.restaurant_name}</p><p className="text-sm text-mist mt-1">{o.status}{o.kitchen_status ? ' · ' + o.kitchen_status : ''}</p></div><time className="text-xs text-mist shrink-0">{new Date(o.created_at).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</time></div>)}
        {board.recent.length === 0 && <p className="p-5 text-sm text-mist">لا توجد طلبات بعد.</p>}</div>
      </div>
    </>}
  </div>
}
