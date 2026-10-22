-- =====================================================================
-- MARKETXONE · 0800 · Tarea programada de expiración (si pg_cron existe)
-- Libera reservas vencidas, vence ofertas y finaliza campañas cada minuto.
-- Si pg_cron no está disponible, la web llama a expire_stale() y las
-- funciones críticas liberan al instante las reservas vencidas que afectan.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('marketxone-expire', '* * * * *', 'select public.mz_expire_due()');
  end if;
exception when others then
  raise notice 'pg_cron no disponible: %', sqlerrm;
end $$;
