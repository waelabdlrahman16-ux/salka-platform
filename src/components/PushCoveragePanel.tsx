import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { adminReport } from '../lib/adminReports'

type CoverageRow = {
  role: string
  total: number
  registered: number
  missing: number
  stale: number
}

type PersonRow = {
  profile_id: string
  role: string
  name: string
  restaurant_id: number | null
  restaurant_name: string | null
  driver_id: number | null
  driver_name: string | null
  token_count: number
  platforms: string[]
  last_registered_at: string | null
  status: 'missing' | 'stale' | 'registered'
}

type PushCoverage = {
  generated_at: string
  coverage: CoverageRow[]
  people: PersonRow[]
  send_stats: {
    attempts_24h: number
    accepted_24h: number
    failed_24h: number
    attempts_30d: number
    accepted_30d: number
    failed_30d: number
    latest_attempt_at: string | null
  }
  dead_tokens_30d: number
}

type ProbeResult = {
  checked: number
  results: { profile_id: string; platform: string | null; alive: boolean; status: number; errCode: string }[]
}

const ROLE_AR: Record<string, string> = {
  admin: 'الإدارة',
  supervisor: 'المشرف',
  catalog: 'مسؤول الكتالوج',
  vendor: 'المطاعم والمتاجر',
  driver: 'المندوبون',
}

function dateLabel(value: string | null) {
  if (!value) return 'لم يُسجّل'
  return new Date(value).toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })
}

export default function PushCoveragePanel() {
  const [report, setReport] = useState<PushCoverage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [probeError, setProbeError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await adminReport<PushCoverage>('pushHealth')
    if (result.ok) setReport(result.data)
    else setError(result.error || 'تعذر تحميل حالة التنبيهات')
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const missing = useMemo(() => report?.people.filter(p => p.status !== 'registered') ?? [], [report])
  const registered = useMemo(() => report?.people.filter(p => p.status === 'registered') ?? [], [report])
  const stats = report?.send_stats
  const acceptance = stats?.attempts_30d
    ? Math.round((stats.accepted_30d / stats.attempts_30d) * 1000) / 10
    : null

  async function validateTokens() {
    setProbing(true)
    setProbeError('')
    const result = await adminReport<ProbeResult>('validatePush')
    if (result.ok) setProbe(result.data)
    else setProbeError(result.error || 'تعذر فحص التوكنات')
    setProbing(false)
  }

  if (loading && !report) return <div className="card p-6 text-center text-mist">جاري فحص تسجيل التنبيهات…</div>
  if (error && !report) return (
    <div className="card p-6 text-center">
      <p className="text-red-700 font-semibold">{error}</p>
      <button className="btn-sea mt-3" onClick={load}>حاول تاني</button>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-lg">تغطية تنبيهات فريق التشغيل</h2>
          <p className="text-xs text-mist mt-1">التسجيل هنا يعني إن عندنا عنوان جهاز نقدر نبعت له؛ قبول فايربيز لا يضمن إن الجهاز أظهر التنبيه أو شغّل صوت.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button className="btn-ghost !py-2 text-xs" disabled={probing} onClick={validateTokens}>
            {probing ? 'بنفحص فايربيز…' : 'فحص فعلي بدون إرسال'}
          </button>
          <button className="btn-ghost !py-2 text-xs" disabled={loading} onClick={load}>
            {loading ? 'بنفحص…' : 'تحديث'}
          </button>
        </div>
      </div>

      {probe && (
        <div className={`card p-3 text-sm font-semibold ${probe.results.some(r => !r.alive) ? 'border-red-400/50 text-red-700' : 'border-emerald-400/40 text-emerald-700'}`}>
          فحصنا {probe.checked} جهاز من غير ما نبعت أي تنبيه: {probe.results.filter(r => r.alive).length} سليم
          {probe.results.some(r => !r.alive) && ` · ${probe.results.filter(r => !r.alive).length} محتاج إعادة تسجيل`}
        </div>
      )}
      {probeError && <div className="card p-3 text-sm text-red-700 font-semibold">{probeError}</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {(report?.coverage ?? []).map(c => (
          <div key={c.role} className={`card p-3 ${c.missing + c.stale > 0 ? 'border-red-400/50' : 'border-emerald-400/40'}`}>
            <p className="text-xs text-mist">{ROLE_AR[c.role] ?? c.role}</p>
            <p className="text-xl font-bold mt-1">{c.registered}/{c.total}</p>
            <p className={`text-xs mt-1 ${c.missing + c.stale > 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>
              {c.missing > 0 ? `${c.missing} بدون تنبيهات` : c.stale > 0 ? `${c.stale} تسجيل قديم` : <>كلهم مسجلين<Icon name="check" size="xs" className="inline-block align-[-0.15em] ms-1" /></>}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="card p-3"><p className="text-xs text-mist">محاولات 30 يوم</p><p className="text-lg font-bold">{stats?.attempts_30d ?? 0}</p></div>
        <div className="card p-3"><p className="text-xs text-mist">قبلتها فايربيز</p><p className="text-lg font-bold text-emerald-700">{acceptance == null ? '—' : `${acceptance}%`}</p></div>
        <div className="card p-3"><p className="text-xs text-mist">فشلت آخر 24 ساعة</p><p className="text-lg font-bold text-red-700">{stats?.failed_24h ?? 0}</p></div>
        <div className="card p-3"><p className="text-xs text-mist">توكنات منتهية 30 يوم</p><p className="text-lg font-bold">{report?.dead_tokens_30d ?? 0}</p></div>
      </div>

      <section>
        <h3 className="font-bold mb-2">محتاجين تفعيل ({missing.length})</h3>
        {missing.length === 0 ? <div className="card p-4 text-emerald-700 font-semibold">كل حسابات التشغيل مسجلة للتنبيهات<Icon name="check" size="xs" className="inline-block align-[-0.15em] ms-1" /></div> : (
          <div className="space-y-2">
            {missing.map(p => (
              <div key={p.profile_id} className="card p-3.5 border-red-400/40 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{p.restaurant_name || p.driver_name || p.name}</p>
                  <p className="text-xs text-mist">{ROLE_AR[p.role] ?? p.role}</p>
                </div>
                <div className="text-left shrink-0">
                  <span className="text-xs font-semibold text-red-700 bg-red-500/10 rounded-full px-2.5 py-1">
                    {p.status === 'missing' ? 'غير مسجل' : 'التسجيل قديم'}
                  </span>
                  <p className="text-[10px] text-mist mt-1">{dateLabel(p.last_registered_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="card p-4">
        <summary className="font-semibold cursor-pointer">المسجلون ({registered.length})</summary>
        <div className="space-y-2 mt-3">
          {registered.map(p => (
            <div key={p.profile_id} className="flex items-center justify-between gap-3 border-b border-line last:border-0 pb-2 last:pb-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{p.restaurant_name || p.driver_name || p.name}</p>
                <p className="text-xs text-mist">{ROLE_AR[p.role] ?? p.role}</p>
              </div>
              <p className="text-xs text-mist text-left shrink-0">{p.platforms.join(' + ') || '—'}<br />{dateLabel(p.last_registered_at)}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
