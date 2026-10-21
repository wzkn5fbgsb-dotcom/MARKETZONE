-- =====================================================================
-- MARKETZONE · 0900 · Cuotas de uso de IA (las llama solo la Edge Function)
-- =====================================================================
create or replace function public.ai_usage_hit(p_user uuid, p_feature text, p_daily_limit integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user <> 'postgres' then
    perform public.mz_fail('forbidden', 'Solo el servidor puede registrar uso de IA.');
  end if;
  insert into public.ai_usage as u (user_id, day, feature, requests) values (p_user, current_date, p_feature, 1)
  on conflict (user_id, day, feature) do update set requests = u.requests + 1
  returning requests into v_count;
  return jsonb_build_object('allowed', v_count <= p_daily_limit, 'used', v_count, 'limit', p_daily_limit);
end $$;
revoke execute on function public.ai_usage_hit(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_usage_hit(uuid, text, integer) to service_role;
