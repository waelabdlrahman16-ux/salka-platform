-- request_customer_account_recovery(p_phone, p_auth_user_id) lets the caller
-- override identity checks by passing an arbitrary p_auth_user_id, which the
-- private function trusts via set_config('request.jwt.claim.sub', ...) to
-- simulate auth.uid(). This is the same pattern ~20 other RPCs use, always
-- called from an edge function that pins p_auth_user_id to the caller's own
-- server-verified JWT claim -- never client input directly. But this
-- function was also granted EXECUTE to plain `authenticated`, and the
-- frontend always goes through the customer-accounts edge function, never
-- calls it directly. That meant any authenticated customer could bypass the
-- edge function's identity pinning and call this RPC directly with a forged
-- p_auth_user_id, filing an account-recovery request that falsely appears
-- to come from a different customer. Revoking `authenticated` forces all
-- calls through the edge function's real identity check; service_role
-- (what the edge function actually uses) is untouched.

revoke execute on function public.request_customer_account_recovery(text, uuid) from authenticated;
