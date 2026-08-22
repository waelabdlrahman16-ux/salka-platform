-- Two ad-hoc backup tables from earlier fixes, both superseded.
--
-- They are the only reason the security advisor reports rls_enabled_no_policy
-- on this project, and a reader auditing that list has to re-derive, twice,
-- that these are junk rather than a hole. Removing them removes the question.
--
-- Checked before dropping, because a backup is exactly the thing you regret:
--
--   _mcd_menu_backup_20260806  -- 76 ماكدونالدز menu rows snapshotted before a
--     catalogue edit. The live menu now carries 92 items for that restaurant,
--     so the snapshot is behind, not a fallback.
--
--   _notify_fn_backup_20260821 -- 15 notification function definitions taken at
--     19:13 on 21 Aug, before the notification rewrite. All 15 still exist and
--     all 15 have been rewritten since, so every row is a superseded copy. The
--     definitions of that era are captured in supabase/baseline/routines.json,
--     and the current ones are in the migrations that replaced them; nothing
--     here exists only in this table.
--
-- Neither is referenced by any function, view, policy or trigger.

drop table if exists public._mcd_menu_backup_20260806;
drop table if exists public._notify_fn_backup_20260821;
