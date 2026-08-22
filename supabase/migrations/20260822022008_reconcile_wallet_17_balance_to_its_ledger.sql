-- Wallet 17 was owed 48 EGP it could not see.
--
-- Two compensation credits for order #58 on 2026-07-29 -- 25.00 at 13:33 and
-- 23.00 at 13:35, both reading 'تعويض تقييم منخفض طلب #58' -- are in
-- wallet_transactions, and the balance says 0.00. The customer has three orders,
-- none of them used wallet balance, and the total wallet spend across them is 0.
-- So the money was granted and never spent: the LEDGER is right and the BALANCE
-- is wrong, not the other way round.
--
-- Confirmed by Wael on 2026-08-22: both credits were intended, so 48 is owed.
--
-- NO NEW LEDGER ROW. The ledger already sums to exactly 48 and already explains
-- why. Adding a correcting credit would make it sum to 96 and reintroduce the
-- very divergence this is closing. The audit trail for the correction is this
-- migration -- in git, and in schema_migrations.
--
-- Scoped to the one wallet, and only while it still shows the exact divergence
-- described above. If anything moved between writing this and running it, the
-- WHERE clause matches nothing and the migration is a no-op rather than a
-- surprise write against a balance somebody else already fixed.
--
-- This cannot recur through credit_wallet, which locks the wallet row, refuses
-- an identical credit inside two minutes, and writes the balance and the ledger
-- row in one transaction. The 2026-07-29 rows predate the actor column being
-- populated, so who made them is not recoverable.
update customer_wallets w
   set balance = 48.00
 where w.id = 17
   and w.balance = 0.00
   and (select coalesce(sum(t.amount), 0) from wallet_transactions t where t.wallet_id = w.id) = 48.00;
