export default function DangerZoneCard({
  deleting, deleteBlockedReason, onDelete
}: {
  deleting: boolean
  deleteBlockedReason: string
  onDelete: () => void
}) {
  return (
    <div className="card p-4 mb-3 border-red-400/30">
      <p className="font-semibold text-sm mb-2 text-red-600">حذف الصنف نهائيًا</p>
      <p className="text-xs text-mist mb-3">
        ده حذف نهائي مش رجعة فيه، لو الصنف اتطلب قبل كده، مينفعش يتمسح خالص عشان طلبات العملاء القديمة تفضل موجودة. استخدم "غير متاح" بدل كده في الحالة دي.
      </p>
      {deleteBlockedReason && (
        <p className="text-xs text-sandink bg-sand/10 rounded-lg p-2.5 mb-3">{deleteBlockedReason}</p>
      )}
      <button className="w-full py-2.5 rounded-xl text-sm font-semibold border-2 border-red-400/40 text-red-600 bg-red-500/5 disabled:opacity-50"
        disabled={deleting} onClick={onDelete}>
        {deleting ? 'جاري الحذف…' : '🗑️ حذف الصنف نهائيًا'}
      </button>
    </div>
  )
}
