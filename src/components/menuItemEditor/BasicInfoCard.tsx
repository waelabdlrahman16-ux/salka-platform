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
  return (
    <div className="card p-4 mb-3">
      <p className="font-semibold text-sm mb-3">البيانات الأساسية</p>

      <div className="flex items-center gap-3 mb-4">
        {imageUrl
          ? <img src={imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-line" />
          : <div className="w-16 h-16 rounded-xl bg-shellup grid place-items-center text-mist text-xs">لا صورة</div>}
        <label className="text-sm text-sea cursor-pointer">
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
          {uploading ? 'جاري الرفع…' : (imageUrl ? '🖼️ تغيير الصورة' : '🖼️ إضافة صورة')}
        </label>
      </div>
      {imageError && <p className="text-xs text-sand mb-3">{imageError}</p>}

      <div className="space-y-3">
        <div>
          <label className="label">الاسم</label>
          <input className="field" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">الوصف</label>
          <textarea className="field" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="label">القسم</label>
          <input className="field" value={category} onChange={e => setCategory(e.target.value)} placeholder="مشويات، مشروبات..." />
        </div>
        <div>
          <label className="label">السعر</label>
          <input className="field" type="number" value={price} onChange={e => setPrice(e.target.value)} />
        </div>
        <button className={`w-full py-2.5 rounded-xl text-sm font-semibold border-2 ${available ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/5' : 'border-red-400/40 text-red-600 bg-red-500/5'}`}
          onClick={() => setAvailable(!available)}>
          {available ? '✓ متاح للطلب' : '✗ غير متاح (خلص)'}
        </button>
      </div>

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
