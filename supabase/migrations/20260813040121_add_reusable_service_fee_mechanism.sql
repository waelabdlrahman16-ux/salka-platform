
-- Per-restaurant toggle: 0 = no hidden service fee, 0.08 = 8%, etc. Reusable for any restaurant, any time.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS service_fee_pct numeric NOT NULL DEFAULT 0;

-- base_price = the true vendor price, never touched by the fee. price = what customers see.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS base_price numeric;
ALTER TABLE menu_item_sizes ADD COLUMN IF NOT EXISTS base_price numeric;
ALTER TABLE menu_item_addons ADD COLUMN IF NOT EXISTS base_price numeric;
ALTER TABLE menu_item_combos ADD COLUMN IF NOT EXISTS base_price numeric;

-- Backfill: today's live prices become the base (nothing changes visibly right now)
UPDATE menu_items SET base_price = price WHERE base_price IS NULL;
UPDATE menu_item_sizes SET base_price = price WHERE base_price IS NULL;
UPDATE menu_item_addons SET base_price = price WHERE base_price IS NULL;
UPDATE menu_item_combos SET base_price = price WHERE base_price IS NULL;

-- Recompute all 4 pricing tables for one restaurant from its current service_fee_pct
CREATE OR REPLACE FUNCTION apply_restaurant_service_fee(p_restaurant_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_pct numeric;
BEGIN
  SELECT service_fee_pct INTO v_pct FROM restaurants WHERE id = p_restaurant_id;
  IF v_pct IS NULL THEN v_pct := 0; END IF;

  UPDATE menu_items
    SET price = round(base_price * (1 + v_pct))
    WHERE restaurant_id = p_restaurant_id AND base_price IS NOT NULL;

  UPDATE menu_item_sizes
    SET price = round(base_price * (1 + v_pct))
    WHERE base_price IS NOT NULL AND menu_item_id IN (SELECT id FROM menu_items WHERE restaurant_id = p_restaurant_id);

  UPDATE menu_item_addons
    SET price = round(base_price * (1 + v_pct))
    WHERE base_price IS NOT NULL AND menu_item_id IN (SELECT id FROM menu_items WHERE restaurant_id = p_restaurant_id);

  UPDATE menu_item_combos
    SET price = round(base_price * (1 + v_pct))
    WHERE base_price IS NOT NULL AND menu_item_id IN (SELECT id FROM menu_items WHERE restaurant_id = p_restaurant_id);
END;
$$;

-- Auto-handle brand-new menu rows added later: capture their incoming price as base_price,
-- then immediately apply that restaurant's current fee (safe because INSERT rows are always fresh/unmarked-up)
CREATE OR REPLACE FUNCTION set_base_price_on_insert_menu_items()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pct numeric;
BEGIN
  IF NEW.base_price IS NULL THEN NEW.base_price := NEW.price; END IF;
  SELECT service_fee_pct INTO v_pct FROM restaurants WHERE id = NEW.restaurant_id;
  IF v_pct IS NOT NULL AND v_pct > 0 THEN NEW.price := round(NEW.base_price * (1 + v_pct)); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_menu_items_base_price ON menu_items;
CREATE TRIGGER trg_menu_items_base_price BEFORE INSERT ON menu_items
  FOR EACH ROW EXECUTE FUNCTION set_base_price_on_insert_menu_items();

CREATE OR REPLACE FUNCTION set_base_price_on_insert_child(tbl_menu_item_id integer, in_price numeric, in_base_price numeric, OUT out_base_price numeric, OUT out_price numeric)
LANGUAGE plpgsql AS $$
DECLARE v_restaurant_id integer; v_pct numeric;
BEGIN
  out_base_price := coalesce(in_base_price, in_price);
  SELECT restaurant_id INTO v_restaurant_id FROM menu_items WHERE id = tbl_menu_item_id;
  SELECT service_fee_pct INTO v_pct FROM restaurants WHERE id = v_restaurant_id;
  IF v_pct IS NOT NULL AND v_pct > 0 THEN
    out_price := round(out_base_price * (1 + v_pct));
  ELSE
    out_price := in_price;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION set_base_price_on_insert_sizes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM set_base_price_on_insert_child(NEW.menu_item_id, NEW.price, NEW.base_price);
  NEW.base_price := r.out_base_price;
  NEW.price := r.out_price;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_menu_item_sizes_base_price ON menu_item_sizes;
CREATE TRIGGER trg_menu_item_sizes_base_price BEFORE INSERT ON menu_item_sizes
  FOR EACH ROW EXECUTE FUNCTION set_base_price_on_insert_sizes();

CREATE OR REPLACE FUNCTION set_base_price_on_insert_addons()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM set_base_price_on_insert_child(NEW.menu_item_id, NEW.price, NEW.base_price);
  NEW.base_price := r.out_base_price;
  NEW.price := r.out_price;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_menu_item_addons_base_price ON menu_item_addons;
CREATE TRIGGER trg_menu_item_addons_base_price BEFORE INSERT ON menu_item_addons
  FOR EACH ROW EXECUTE FUNCTION set_base_price_on_insert_addons();

CREATE OR REPLACE FUNCTION set_base_price_on_insert_combos()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM set_base_price_on_insert_child(NEW.menu_item_id, NEW.price, NEW.base_price);
  NEW.base_price := r.out_base_price;
  NEW.price := r.out_price;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_menu_item_combos_base_price ON menu_item_combos;
CREATE TRIGGER trg_menu_item_combos_base_price BEFORE INSERT ON menu_item_combos
  FOR EACH ROW EXECUTE FUNCTION set_base_price_on_insert_combos();
