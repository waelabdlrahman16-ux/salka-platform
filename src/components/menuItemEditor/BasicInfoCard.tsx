import { useId } from 'react'
export default function BasicInfoCard({
  name, setName, description, setDescription, category, setCategory, price, setPrice,
  available, setAvailable, imageUrl, uploading, imageError, onUpload,
  hasWindow, setHasWindow, availFrom, setAvailFrom, availUntil, setAvailUntil
}: {
  name: string; setName: (v: string) => void
  description: string; setDescription: (v: string) => void
  category: string; setCategory: (v: string) => void
  price: string; setPrice: (v: string) => void
  available: boolean; setAvailable: (v: boolean) => void
  imageUrl: string | null; uploading: boolean; imageError: string; onUpload: (file: File) => void
  hasWindow: boolean; setHasWindow: (v: boolean) => void
  availFrom: string; setAvailFrom: (v: string) => void
  availUntil: string; setAvailUntil: (v: string) => void
}) {
  const fid = useId()
  return (
    /* Tightened deliberately. Six full-height fields stacked in a column pushed
       the save button off the bottom of a phone, so the shape of the item you
       were editing was never visible at once. The photo, the name and the price
       are one row; the description and section are one row under it. */
    <div className="card p-3 mb-3">
      <div className="flex items-start gap-2.5 mb-2.5">
        {imageUrl
          ? <img src={imageUrl} alt="" className="w-11 h-11 rounded-lg object-cover border border-line shrink-0" />
          : <div className="w-11 h-11 rounded-lg bg-shellup grid place-items-center text-mist text-[10px] shrink-0">لا صورة</div>}
        <div className="flex-1 min-w-0">
          <label className="label !mb-0.5" htmlFor={`${fid}-1`}>الاسم</label>
          <input id={`${fid}-1`} className="field !h-8 !py-1 text-sm" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="w-20 shrink-0">
          <label className="label !mb-0.5" htmlFor={`${fid}-4`}>السعر</label>
          <input id={`${fid}-4`} className="field !h-8 !py-1 text-sm text-center" type="number" value={price} onChange={e => setPrice(e.target.value)} />
        </div>
      </div>

      <label className="text-xs text-sea cursor-pointer block mb-2.5">
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''   // so the same photo can be picked again
            if (f) onUpload(f)
          }} />
        {uploading ? 'جاري الرفع…' : (imageUrl ? '🖼️ تغيير الصورة' : '🖼️ إضافة صورة')}
      </label>
      {imageError && <p className="text-xs text-sandink mb-2">{imageError}</p>}

      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <div>
          <label className="label !mb-0.5" htmlFor={`${fid}-3`}>القسم</label>
          <input id={`${fid}-3`} className="field !h-8 !py-1 text-sm" value={category} onChange={e => setCategory(e.target.value)} placeholder="مشويات…" />
        </div>
        <div>
          <label className="label !mb-0.5" htmlFor={`${fid}-2`}>الوصف (اختياري)</label>
          {/* textarea, not input: a browser strips newlines from an input value,
              so opening an item with a multi-line description and pressing حفظ
              would have written the flattened string back. */}
          <textarea id={`${fid}-2`} className="field !py-1 text-sm" rows={1} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
      </div>

      <button className={`w-full py-2 rounded-xl text-sm font-semibold border-2 ${available ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/5' : 'border-red-400/40 text-red-600 bg-red-500/5'}`}
        onClick={() => setAvailable(!available)}>
        {available ? '✓ متاح للطلب' : '✗ غير متاح (خلص)'}
      </button>

      <div className="border-t border-line mt-4 pt-3">
        <label className="flex items-center gap-2 text-sm font-semibold mb-2">
          <input type="checkbox" checked={hasWindow} onChange={e => setHasWindow(e.target.checked)} className="accent-sea" />
          متاح في وقت محدد بس (مثلاً فطار 9-11)
        </label>
        {hasWindow && (
          <div className="flex items-center gap-2">
            <input type="time" className="field !py-1.5" value={availFrom} onChange={e => setAvailFrom(e.target.value)} />
            <span className="text-mist text-sm">لحد</span>
            <input type="time" className="field !py-1.5" value={availUntil} onChange={e => setAvailUntil(e.target.value)} />
          </div>
        )}
      </div>
    </div>
  )
}
