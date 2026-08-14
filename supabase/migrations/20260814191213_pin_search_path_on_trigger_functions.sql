-- Supabase advisor: Function Search Path Mutable. These 6 functions had no
-- pinned search_path, unlike every other function in the codebase. Low
-- exploitability here specifically (none are SECURITY DEFINER, and anon/
-- authenticated cannot CREATE objects in public to shadow-inject), but pinning
-- it is the standard hardening and matches existing convention everywhere else.

alter function public.delivery_fee_for_distance(numeric) set search_path = public;
alter function public.set_base_price_on_insert_menu_items() set search_path = public;
alter function public.set_base_price_on_insert_child(integer, numeric, numeric) set search_path = public;
alter function public.set_base_price_on_insert_combos() set search_path = public;
alter function public.set_base_price_on_insert_sizes() set search_path = public;
alter function public.set_base_price_on_insert_addons() set search_path = public;
