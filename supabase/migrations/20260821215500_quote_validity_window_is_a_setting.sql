-- The quote decision window becomes a setting. The value stays 15 minutes.
--
-- WHY. Order #1000's quote was issued 20:48:05 and expired 21:03:05. The
-- reminder went out at 21:02:00 -- sixty-three seconds before it lapsed. The
-- customer never answered, the quote died, and because
-- guard_custom_order_quote_dispatch refuses an assignment for any
-- custom_request whose quote_state is not 'accepted', the order became
-- undispatchable. Every driver was refused, which read as "the assign button
-- is broken" rather than "the customer has not agreed the price".
--
-- Fifteen minutes to read a push and decide on a 1,761 EGP order is tight, and
-- sixty was considered. Wael decided to keep fifteen, so THIS MIGRATION CHANGES
-- NO BEHAVIOUR: the seeded value is 15 and the customer is still told 15. What
-- it changes is where that number lives -- one settings row instead of a
-- literal in a function body and a second literal in the Arabic copy. Raising
-- it later is now an edit in the admin portal, not a migration.
--
-- WHY A SETTING RATHER THAN A NEW LITERAL. p_expires_at is already a parameter
-- of issue_custom_order_quote and is already ignored -- the comment there says
-- "Policy is server-owned. The client still sends the intended value ... but it
-- cannot lengthen or shorten the offer." That reasoning is right and is kept:
-- the client still cannot choose. What changes is that the policy is now
-- tunable in one place by whoever owns pricing, instead of being a literal
-- buried in a function body, in the notification copy, and nowhere else.
--
-- The Arabic copy said "خلال 15 دقيقة" as a hardcoded string. It now reads the
-- same setting, so the number the customer is told and the number the server
-- enforces cannot drift apart -- which is exactly the failure that a literal in
-- two places eventually produces.

insert into settings (key, value, label, kind, required, min_value, max_value)
select 'quote_validity_minutes', '15',
       'مدة صلاحية عرض السعر (بالدقايق)', 'numeric', false, 5, 1440
where not exists (select 1 from settings where key = 'quote_validity_minutes');

-- The body is taken from pg_get_functiondef and transformed programmatically,
-- each substitution asserted -- it is NOT retyped. See 20260813172545 for why
-- that rule exists in this repository.
do $m$
declare def text; newdef text;
begin
  select pg_get_functiondef(p.oid) into strict def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'issue_custom_order_quote';

  newdef := replace(
    def,
    'now() + interval ''15 minutes''',
    'now() + make_interval(mins => private.setting_num(''quote_validity_minutes'', 15)::int)'
  );
  if newdef = def then raise exception 'substitution 1 (expiry) did not apply'; end if;
  def := newdef;

  newdef := replace(
    def,
    '''راجع السعر ووافق خلال 15 دقيقة عشان نبدأ طلبك''',
    '''راجع السعر ووافق خلال '' || private.setting_num(''quote_validity_minutes'', 15)::int::text || '' دقيقة عشان نبدأ طلبك'''
  );
  if newdef = def then raise exception 'substitution 2 (notification copy) did not apply'; end if;

  execute newdef;
end $m$;

-- Prove it took, rather than trusting that it did.
do $v$
declare src text;
begin
  select prosrc into strict src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'issue_custom_order_quote';
  if src like '%interval ''15 minutes''%' then
    raise exception 'the hardcoded 15-minute window is still in the function body';
  end if;
  if src not like '%quote_validity_minutes%' then
    raise exception 'the function does not read quote_validity_minutes';
  end if;
end $v$;
