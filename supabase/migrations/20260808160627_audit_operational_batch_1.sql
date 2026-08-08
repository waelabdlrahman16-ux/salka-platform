-- Operational audit batch 1.
-- Decisions confirmed by Wael on 2026-08-08:
--   * COD deposit threshold remains 3,000 EGP.
--   * الجلالة delivery fee is 350 EGP.

do $$
declare v_rows integer;
begin
  update public.settings
  set value = '3000'
  where key = 'cod_deposit_threshold_egp';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'cod_deposit_threshold_setting_not_found'; end if;

  update public.compounds
  set delivery_fee = 350
  where id = 104
    and name = 'الجلالة'
    and distance_km = 24;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'galala_compound_fixture_changed'; end if;
end $$;

create or replace function public.record_push_result(
  p_token text, p_ok boolean, p_status integer, p_err_code text, p_title text)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_profile uuid; v_platform text;
begin
  select profile_id, platform into v_profile, v_platform
    from push_tokens where token = p_token limit 1;

  insert into push_send_log (token_prefix, profile_id, platform, ok, status, err_code, title)
  values (left(p_token, 12) || '...', v_profile, v_platform, p_ok, p_status, p_err_code, p_title);

  if not p_ok and (p_err_code in ('UNREGISTERED','INVALID_ARGUMENT') or p_status = 404) then
    insert into dead_push_tokens (token, err_code) values (p_token, p_err_code)
      on conflict (token) do update set died_at = now(), err_code = excluded.err_code;

    -- Staff tokens are stored in push_tokens, while customer tokens are copied
    -- onto orders. Clear both sources so one permanently dead customer device
    -- is not retried at every later order milestone.
    delete from push_tokens where token = p_token;
    update orders set push_token = null where push_token = p_token;
  end if;
end;
$$;

revoke all on function public.record_push_result(text, boolean, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.record_push_result(text, boolean, integer, text, text)
  to service_role;
