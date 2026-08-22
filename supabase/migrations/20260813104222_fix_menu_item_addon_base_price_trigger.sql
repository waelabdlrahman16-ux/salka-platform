CREATE OR REPLACE FUNCTION public.set_base_price_on_insert_addons()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  v_menu_item_id integer;
BEGIN
  SELECT g.menu_item_id
    INTO v_menu_item_id
  FROM public.menu_item_addon_groups AS g
  WHERE g.id = NEW.group_id;

  IF v_menu_item_id IS NULL THEN
    RAISE EXCEPTION 'addon_group_not_found';
  END IF;

  SELECT *
    INTO r
  FROM public.set_base_price_on_insert_child(v_menu_item_id, NEW.price, NEW.base_price);

  NEW.base_price := r.out_base_price;
  NEW.price := r.out_price;
  RETURN NEW;
END;
$$;
