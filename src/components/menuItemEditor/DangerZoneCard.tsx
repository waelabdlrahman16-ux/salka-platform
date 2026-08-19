import Icon from '../Icon'

export default function DangerZoneCard({
  deleting, deleteBlockedReason, onDelete
}: {
  deleting: boolean
  deleteBlockedReason: string
  onDelete: () => void
}) {
  return (
    <div className="card p-4 mb-3 border-dangerline/30">
      <p className="font-semibold text-sm mb-2 text-danger">حذف الصنف نهائيًا</p>
      <p className="text-xs text-mist mb-3">
        ده حذف نهائي مش رجعة فيه، لو الصنف اتطلب قبل كده، مينفعش يتمسح خالص عشان طلبات العملاء القديمة تفضل موجودة. استخدم "غير متاح" بدل كده في الحالة دي.
      </p>
      {deleteBlockedReason && (
        <p className="text-xs text-coral-700 bg-coral-100 rounded-lg p-2.5 mb-3">{deleteBlockedReason}</p>
      )}
      <button className="w-full py-2.5 rounded-xl text-sm font-semibold border-2 border-dangerline text-danger bg-dangerbg disabled:opacity-50"
        disabled={deleting} onClick={onDelete}>
        {deleting ? 'جاري الحذف…' : <><Icon name="trash" size="sm" className="inline-block align-[-0.15em] me-1" />حذف الصنف نهائيًا</>}
      </button>
    </div>
  )
}
