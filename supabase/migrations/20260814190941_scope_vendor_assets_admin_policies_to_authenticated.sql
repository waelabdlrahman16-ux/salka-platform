-- Last three stragglers from the same finding as migration 20260814184323:
-- the vendor-assets storage bucket's admin write/update/delete policies were
-- left at roles={public} calling is_admin(), unlike every other storage
-- policy on this table (banners_img_admin_*, catalog *, rx_*), which are all
-- already correctly scoped to authenticated.
alter policy "admin deletes vendor-assets" on storage.objects to authenticated;
alter policy "admin updates vendor-assets" on storage.objects to authenticated;
alter policy "admin writes vendor-assets" on storage.objects to authenticated;
