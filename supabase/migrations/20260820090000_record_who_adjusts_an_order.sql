-- Record WHO changed an order's money, and when.
--
-- WHY. Adjusting an order's price is the only money action on the platform that
-- leaves no trace of the person who did it. Its siblings all have one:
--
--   orders.refunded_by / refunded_at     set from auth.uid()
--   orders.archived_by / archived_at     set from auth.uid()
--   driver_settlements.settled_by        added 18 August
--   wallet_transactions.actor            added 18 August
--   order price adjustment               nothing
--
-- An adjustment DOES leave a row: admin_adjust_order writes a line into
-- order_items with is_adjustment = true, carrying the amount and the reason.
-- But order_items records only `created_by`, which is the ROLE -- the literal
-- text 'admin' or 'supervisor' -- and has no timestamp at all. So the table can
-- say "a supervisor added 300 EGP for 'extra items'" and cannot say which
-- supervisor, or when.
--
-- That gap has a cost that already landed. On 19 August seven orders were found
-- overcharged because a price change did not carry the promo discount with it.
-- The defect was provable from the numbers; WHAT changed those prices was not,
-- because nothing recorded it. The fix shipped without ever knowing who or what
-- triggered the damage.
--
-- WHAT THIS ADDS. Two columns on the adjustment line, not on the order. The
-- line is the right home: one row per adjustment means the FULL history is
-- kept, where a column on orders would only ever remember the most recent one.
--
-- WHY NULLABLE, AND WHY NO BACKFILL. Rows that predate this migration genuinely
-- have no author and no timestamp, and inventing one is worse than admitting
-- none. `created_at` is therefore added WITHOUT a default and given its default
-- afterwards -- adding it with a default in one step would stamp every historic
-- row with the migration's own clock and quietly assert that all 400-odd
-- existing lines were written this morning.
--
-- WHY NO FOREIGN KEY. orders.refunded_by has none either, and deliberately: an
-- audit record has to outlive the staff account it names. With `on delete set
-- null` on a departing employee's account, the record of what they changed
-- would erase itself, which is precisely backwards for an audit trail.
--
-- EXPOSURE. order_items is SELECT-able by `authenticated` only, and already
-- exposes `created_by` ('admin' / 'supervisor'). This adds an opaque uuid
-- alongside it -- no name, no email, and unreadable to anyone who cannot
-- already read the role. Not a new disclosure of substance, but noted rather
-- than glossed over.
--
-- ROLLBACK:
--   alter table order_items drop column if exists created_by_uid;
--   alter table order_items drop column if exists created_at;
--   then restore private.admin_adjust_order from 20260819210000.

alter table order_items add column if not exists created_by_uid uuid;

-- Two steps on purpose. See "WHY NULLABLE, AND WHY NO BACKFILL" above.
alter table order_items add column if not exists created_at timestamptz;
alter table order_items alter column created_at set default now();

comment on column order_items.created_by_uid is
  'Who wrote this line, for adjustment lines. NULL on rows predating 20260820090000, and on ordinary basket lines written by the customer.';
comment on column order_items.created_at is
  'When this line was written. NULL on rows predating 20260820090000 -- deliberately not backfilled rather than stamped with a false time.';

-- Index the audit lookup: "show me every price change this person made".
-- Partial, because only adjustment lines ever carry an author.
create index if not exists order_items_adjustment_author_idx
  on order_items (created_by_uid, created_at desc)
  where is_adjustment;

-- ---------------------------------------------------------------------------
-- admin_adjust_order now names the person.
-- ---------------------------------------------------------------------------
-- Identical to 20260819210000 apart from the two new columns on the INSERT.
-- auth.uid() is populated here: the public wrapper takes p_auth_user_id from
-- the edge function and sets it as the request claim before delegating, so the
-- real caller is available even though this runs as security definer.
--
-- Bodies are authored in full, explicitly. Never patch a function body with
-- replace() -- see 20260813172545, two hours of dead checkout.
CREATE OR REPLACE FUNCTION private.admin_adjust_order(p_order_id integer, p_amount numeric, p_reason text, p_charge_service_fee boolean DEFAULT false)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_actor text; v_o orders%rowtype;
  v_pct numeric; v_new_subtotal numeric; v_new_fee numeric; v_waived numeric := null;
  v_new_total numeric; v_has_lines boolean; v_line_id int;
begin
  if is_admin() then v_actor := 'admin';
  elsif is_supervisor() then v_actor := 'supervisor';
  else raise exception 'admin_only';
  end if;

  if p_amount is null or p_amount = 0 then raise exception 'invalid_amount'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;

  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_o.status = 'Cancelled' then raise exception 'order_cancelled'; end if;

  -- PRODUCT lines, not adjustment lines. An order whose only order_items row is
  -- a previous adjustment still has no products to sum.
  select exists (
    select 1 from order_items
     where order_id = p_order_id and not coalesce(is_adjustment, false)
  ) into v_has_lines;

  -- created_by keeps the role; created_by_uid names the person. Both, not one:
  -- the role is what the screen shows, the uuid is what an audit needs.
  insert into order_items (order_id, menu_item_id, name, qty, unit_price, total,
                           is_adjustment, created_by, created_by_uid)
  values (p_order_id, null, trim(p_reason), 1, p_amount, p_amount, true, v_actor, auth.uid())
  returning id into v_line_id;

  if v_has_lines then
    -- Derived, never assigned: the header cannot disagree with the lines.
    select coalesce(sum(total), 0) into v_new_subtotal
      from order_items where order_id = p_order_id;
  else
    -- Nothing to derive from; apply to what is stored.
    v_new_subtotal := coalesce(v_o.subtotal, 0) + p_amount;
  end if;

  if v_new_subtotal < 0 then raise exception 'negative_subtotal'; end if;

  select coalesce((select value::numeric from settings where key = 'service_fee_percent'), 0)
    into v_pct;

  if p_charge_service_fee then
    v_new_fee := round(v_new_subtotal * v_pct / 100.0);
  else
    v_new_fee := v_o.service_fee;
    v_waived  := round(v_new_subtotal * v_pct / 100.0) - coalesce(v_o.service_fee, 0);
    if v_waived <= 0 then v_waived := null; end if;
    update order_items set service_fee_waived = v_waived where id = v_line_id;
  end if;

  update orders
     set subtotal = v_new_subtotal, service_fee = v_new_fee
   where id = p_order_id;

  -- The total, and the promo that comes off it, are not this function's to
  -- compute. See 20260819210000: the discount used to vanish here.
  perform private.reprice_order(p_order_id);
  select total into v_new_total from orders where id = p_order_id;
  if v_new_total < 0 then raise exception 'negative_total'; end if;

  return json_build_object(
    'order_id',           p_order_id,
    'derived_from_lines', v_has_lines,
    'old_subtotal',       v_o.subtotal,    'new_subtotal',    v_new_subtotal,
    'old_service_fee',    v_o.service_fee, 'new_service_fee', v_new_fee,
    'service_fee_waived', v_waived,
    'delivery_fee',       v_o.delivery_fee,
    'old_total',          v_o.total,       'new_total',       v_new_total,
    'actor',              v_actor,
    'actor_uid',          auth.uid()
  );
end $function$;
