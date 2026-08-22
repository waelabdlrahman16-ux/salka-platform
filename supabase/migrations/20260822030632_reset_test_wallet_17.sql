-- Wallet 17 (the owner's test account) is being zeroed at his request. The 48
-- EGP on it came from test orders, not from a real customer.
--
-- The balance is zeroed with a matching ledger row rather than by deleting the
-- old ones: every other wallet in the system holds the invariant
-- balance = sum(wallet_transactions.amount), and reconciling wallet 17 against
-- that invariant is what turned the earlier drift up in the first place.
do $$
declare
  v_balance numeric;
begin
  select balance into v_balance from customer_wallets where id = 17 for update;
  if v_balance is null or v_balance = 0 then
    raise notice 'wallet 17 is already empty; nothing done';
    return;
  end if;

  insert into wallet_transactions (wallet_id, amount, reason)
  values (17, -v_balance, 'تصفير محفظة الاختبار');

  update customer_wallets set balance = 0 where id = 17;
end $$;
