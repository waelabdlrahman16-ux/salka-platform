-- Snapshot the default kitchen onto every newly created order.
-- Existing orders retain their current restaurant workflow and do not need backfill.

alter table public.orders
  add column if not exists kitchen_id bigint references public.restaurant_kitchens(id) on delete set null,
  add column if not exists pickup_location_name text,
  add column if not exists pickup_location_address text;

create index if not exists orders_kitchen_id_idx on public.orders(kitchen_id);

-- Every creation path chooses the active default kitchen once, keeps its name
-- and address on the order, and uses that same kitchen's fee override.
do $$
declare
  r record;
  v_definition text;
  v_fee_lookup text := 'select distance_km into v_km from compounds where id = p_compound_id;' || chr(10) ||
                       '  v_fee := private.delivery_fee_for_restaurant(p_restaurant_id, p_compound_id);';
  v_kitchen_lookup text := 'select k.id, k.name, k.address into v_kitchen_id, v_pickup_name, v_pickup_address' || chr(10) ||
                           '    from public.restaurant_kitchens k' || chr(10) ||
                           '   where k.restaurant_id = p_restaurant_id and k.active and k.is_default' || chr(10) ||
                           '   limit 1;';
  v_patched integer := 0;
begin
  for r in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('place_order', 'request_pickup', 'submit_custom_order')
  loop
    v_definition := pg_get_functiondef(r.oid);

    if position('v_fee numeric; v_km numeric;' in v_definition) = 0
       or position(v_fee_lookup in v_definition) = 0
       or position('compound_id,' in v_definition) = 0
       or position('p_compound_id,' in v_definition) = 0 then
      raise exception 'Expected order fields were not found in private function %', r.oid;
    end if;

    v_definition := replace(v_definition, 'v_fee numeric; v_km numeric;',
      'v_fee numeric; v_km numeric; v_kitchen_id bigint; v_pickup_name text; v_pickup_address text;');
    v_definition := replace(v_definition, v_fee_lookup, v_fee_lookup || chr(10) || '  ' || v_kitchen_lookup);
    v_definition := replace(v_definition, 'compound_id,',
      'compound_id, kitchen_id, pickup_location_name, pickup_location_address,');
    v_definition := replace(v_definition, 'p_compound_id,',
      'p_compound_id, v_kitchen_id, v_pickup_name, v_pickup_address,');
    execute v_definition;
    v_patched := v_patched + 1;
  end loop;

  if v_patched <> 3 then
    raise exception 'Expected to patch 3 order-creation functions, patched %', v_patched;
  end if;
end $$;
