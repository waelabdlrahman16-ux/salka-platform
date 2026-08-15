/**
 * Shows an uploaded menu-item photo cropped exactly the way the live app
 * actually crops it, in the two shapes it ever appears in: the wide 4:3
 * frame (menu grid, the item's own detail sheet) and the square 1:1 frame
 * (related-item thumbnails, the home featured-products shelf). Both use
 * object-cover, same as production -- this is not an approximation.
 *
 * Exists because a photo can pass every technical check (right file type,
 * under 5MB) and still crop badly: a light-colored background at the edge
 * gets read as empty space once cropped in tight, a subject too close to
 * the left/right edge gets cut off in the square frame. There was no way
 * to catch that before saving -- an admin found out only after the photo
 * was already live on the customer app. Showing both crops immediately
 * after picking a file means catching a bad photo takes one glance, not
 * a bug report.
 */
export default function ImageCropPreview({ url }: { url: string }) {
  return (
    <div className="flex items-start gap-3">
      <div>
        <div className="w-28 aspect-[4/3] rounded-lg overflow-hidden border border-line bg-shellup">
          <img src={url} alt="" className="w-full h-full object-cover" />
        </div>
        <p className="text-[10px] text-mist mt-1 text-center">القائمة والتفاصيل</p>
      </div>
      <div>
        <div className="w-16 aspect-square rounded-lg overflow-hidden border border-line bg-shellup">
          <img src={url} alt="" className="w-full h-full object-cover" />
        </div>
        <p className="text-[10px] text-mist mt-1 text-center">المصغّرات</p>
      </div>
    </div>
  )
}
