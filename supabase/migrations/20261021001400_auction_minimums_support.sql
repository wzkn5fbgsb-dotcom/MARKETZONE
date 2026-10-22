-- =====================================================================
-- MARKETXONE · 1400 · Subastas: mínimos más simples
-- - Basta con 1 foto (antes 4).
-- - La descripción es opcional (antes mínimo 30 caracteres).
-- Se puede ejecutar más de una vez. No borra datos.
-- =====================================================================

alter table public.auctions drop constraint if exists auctions_description_check;
alter table public.auctions alter column description set default '';
alter table public.auctions add constraint auctions_description_check check (char_length(description) <= 3000);

create or replace function public.create_auction(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user();
  v_title text := nullif(trim(coalesce(p->>'title', '')), '');
  v_desc text := nullif(trim(coalesce(p->>'description', '')), '');
  v_condition text := p->>'condition';
  v_flaws text := nullif(trim(coalesce(p->>'flaws', '')), '');
  v_price integer := (p->>'start_price_cents')::int;
  v_duration integer := coalesce((p->>'duration_minutes')::int, 10);
  v_delay integer := coalesce((p->>'starts_in_minutes')::int, 0);
  v_images jsonb := coalesce(p->'images', '[]'::jsonb);
  v_meas jsonb := '[]'::jsonb;
  v_m jsonb;
  v_starts timestamptz;
  a public.auctions%rowtype;
  i integer := 0;
begin
  perform public.mz_rate_limit('auction_create:' || v_uid, 20, interval '1 day');
  if v_title is null or char_length(v_title) < 5 or char_length(v_title) > 120 then
    perform public.mz_fail('validation', 'Escribe un título de 5 a 120 caracteres.', '{"field":"title"}');
  end if;
  if not exists (select 1 from public.categories c where c.id = p->>'category_id' and c.is_active) then
    perform public.mz_fail('validation', 'Elige una categoría.', '{"field":"category_id"}');
  end if;
  if v_condition is null or v_condition not in ('new_with_tags', 'new_without_tags', 'used_excellent', 'used_good', 'used_flawed') then
    perform public.mz_fail('validation', 'Indica el estado del artículo.', '{"field":"condition"}');
  end if;
  if v_condition = 'used_flawed' and char_length(coalesce(v_flaws, '')) < 5 then
    perform public.mz_fail('validation', 'Describe los detalles o defectos (al menos 5 caracteres) y muéstralos en las fotos.', '{"field":"flaws"}');
  end if;
  if char_length(coalesce(v_desc, '')) > 3000 then
    perform public.mz_fail('validation', 'La descripción puede tener hasta 3000 caracteres.', '{"field":"description"}');
  end if;
  if jsonb_typeof(v_images) <> 'array' or jsonb_array_length(v_images) < 1 or jsonb_array_length(v_images) > 12 then
    perform public.mz_fail('validation', 'Sube de 1 a 12 fotos claras del artículo.', '{"field":"images"}');
  end if;
  if exists (select 1 from jsonb_array_elements(v_images) x where coalesce(x->>'url', '') !~ '^https://' or char_length(x->>'url') > 2000) then
    perform public.mz_fail('validation', 'Las fotos deben subirse al almacenamiento de MARKETXONE.', '{"field":"images"}');
  end if;
  if jsonb_typeof(p->'measurements') <> 'array' then
    perform public.mz_fail('validation', 'Agrega al menos 2 medidas.', '{"field":"measurements"}');
  end if;
  for v_m in select * from jsonb_array_elements(p->'measurements') loop
    if char_length(trim(coalesce(v_m->>'label', ''))) between 1 and 30
       and coalesce(v_m->>'value', '') ~ '^[0-9]{1,4}([.,][0-9]{1,2})?$'
       and coalesce(v_m->>'unit', '') in ('in', 'cm') then
      v_meas := v_meas || jsonb_build_array(jsonb_build_object('label', trim(v_m->>'label'),
                                                               'value', replace(v_m->>'value', ',', '.'), 'unit', v_m->>'unit'));
    end if;
  end loop;
  if jsonb_array_length(v_meas) < 2 or jsonb_array_length(v_meas) > 12 then
    perform public.mz_fail('validation', 'Agrega de 2 a 12 medidas con su número y unidad (por ejemplo: Largo 28 in).', '{"field":"measurements"}');
  end if;
  if coalesce((p->>'photos_confirmed')::boolean, false) is not true then
    perform public.mz_fail('validation', 'Confirma que las fotos son claras, reales y muestran los detalles.', '{"field":"photos_confirmed"}');
  end if;
  perform public.mz_auction_validate_price(v_price);
  if v_duration not in (5, 10, 15, 30, 60) then
    perform public.mz_fail('validation', 'Elige una duración válida.', '{"field":"duration_minutes"}');
  end if;
  if v_delay < 0 or v_delay > 10080 then
    perform public.mz_fail('validation', 'La subasta puede empezar ahora o en los próximos 7 días.', '{"field":"starts_in_minutes"}');
  end if;
  if (select count(*) from public.auctions where seller_id = v_uid and status in ('open', 'awaiting_seller')) >= 30 then
    perform public.mz_fail('too_many_auctions', 'Tienes 30 subastas abiertas. Espera a que terminen algunas.');
  end if;
  v_starts := now() + make_interval(mins => v_delay);
  insert into public.auctions (seller_id, store_id, title, brand, category_id, size, color, condition, flaws, measurements, description,
                               photos_confirmed, start_price_cents, duration_minutes, starts_at, ends_at)
  values (v_uid, public.mz_default_store(v_uid), v_title, left(nullif(trim(coalesce(p->>'brand', '')), ''), 60), p->>'category_id',
          left(nullif(trim(coalesce(p->>'size', '')), ''), 20), left(nullif(trim(coalesce(p->>'color', '')), ''), 40),
          v_condition, left(v_flaws, 1000), v_meas, coalesce(v_desc, ''), true, v_price, v_duration,
          v_starts, v_starts + make_interval(mins => v_duration))
  returning * into a;
  update public.auctions set root_id = a.id where id = a.id returning * into a;
  for v_m in select * from jsonb_array_elements(v_images) loop
    insert into public.auction_images (auction_id, url, storage_path, position)
    values (a.id, v_m->>'url', left(v_m->>'storage_path', 500), i);
    i := i + 1;
  end loop;
  return public.mz_auction_json(a);
end $$;

revoke all on function public.create_auction(jsonb) from public, anon, authenticated;
grant execute on function public.create_auction(jsonb) to authenticated;

-- =====================================================================
-- MARKETXONE · 1410 · Servicio al cliente con IA y equipo humano
-- - Cada persona tiene conversaciones de soporte. El asistente con IA
--   contesta con las políticas de la app, los datos de la propia persona
--   y la base de respuestas aprobadas por el equipo.
-- - Lo que la IA no puede resolver (o la persona pide hablar con alguien)
--   pasa a la bandeja del equipo. Al contestar, el equipo puede guardar la
--   respuesta en la base: así la IA aprende y la próxima vez contesta sola.
-- - Nunca se piden contraseñas ni números completos de tarjeta.
-- =====================================================================

create table if not exists public.support_tickets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'open' check (status in ('open', 'needs_human', 'answered', 'resolved')),
  subject       text check (subject is null or char_length(subject) <= 140),
  topic         text check (topic is null or char_length(topic) <= 30),
  escalated_reason text check (escalated_reason is null or char_length(escalated_reason) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on public.support_tickets (user_id, updated_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, updated_at desc);

create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  role        text not null check (role in ('user', 'ai', 'agent')),
  body        text not null check (char_length(body) between 1 and 4000),
  meta        jsonb not null default '{}'::jsonb,
  helpful     boolean,
  author_id   uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

create table if not exists public.support_kb (
  id          uuid primary key default gen_random_uuid(),
  question    text not null check (char_length(question) between 5 and 300),
  answer      text not null check (char_length(answer) between 5 and 3000),
  active      boolean not null default true,
  uses        integer not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_kb enable row level security;

-- Oculta números largos que parezcan tarjetas o cuentas (13 a 19 dígitos).
create or replace function public.mz_support_redact(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select regexp_replace(coalesce(p, ''), '(\d[ -]?){12,18}\d', '[número oculto]', 'g');
$$;

create or replace function public.mz_support_ticket_json(t public.support_tickets) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', t.id, 'status', t.status, 'subject', t.subject, 'topic', t.topic, 'escalated_reason', t.escalated_reason,
    'created_at', t.created_at, 'updated_at', t.updated_at,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.role, 'body', m.body, 'meta', m.meta,
        'helpful', m.helpful, 'created_at', m.created_at) order by m.created_at)
      from public.support_messages m where m.ticket_id = t.id), '[]'::jsonb));
$$;

create or replace function public.mz_support_own(p_ticket_id uuid) returns public.support_tickets
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user(); v_t public.support_tickets%rowtype;
begin
  select * into v_t from public.support_tickets where id = p_ticket_id for update;
  if not found or (v_t.user_id <> v_uid and not public.is_admin()) then
    perform public.mz_fail('not_found', 'No encontramos esta conversación.');
  end if;
  return v_t;
end $$;

-- Conversación activa (la crea si no hay).
create or replace function public.support_current() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user(); v_t public.support_tickets%rowtype;
begin
  select * into v_t from public.support_tickets where user_id = v_uid and status <> 'resolved' order by updated_at desc limit 1;
  if not found then
    insert into public.support_tickets (user_id) values (v_uid) returning * into v_t;
  end if;
  return public.mz_support_ticket_json(v_t);
end $$;

create or replace function public.support_new() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user(); v_t public.support_tickets%rowtype;
begin
  update public.support_tickets set status = 'resolved', updated_at = now()
   where user_id = v_uid and status in ('open', 'answered');
  insert into public.support_tickets (user_id) values (v_uid) returning * into v_t;
  return public.mz_support_ticket_json(v_t);
end $$;

create or replace function public.support_send(p_ticket_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user(); v_t public.support_tickets%rowtype; v_body text := trim(coalesce(p_body, ''));
begin
  v_t := public.mz_support_own(p_ticket_id);
  if v_t.user_id <> v_uid then perform public.mz_fail('forbidden', 'Solo la persona de la conversación puede escribir aquí.'); end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    perform public.mz_fail('validation', 'Escribe tu mensaje (hasta 2000 caracteres).', '{"field":"body"}');
  end if;
  perform public.mz_rate_limit('support:' || v_uid, 40, interval '10 minutes');
  v_body := public.mz_support_redact(v_body);
  insert into public.support_messages (ticket_id, role, body, author_id) values (v_t.id, 'user', v_body, v_uid);
  update public.support_tickets set subject = coalesce(subject, left(v_body, 140)),
    status = case when status = 'resolved' then 'open' else status end, updated_at = now() where id = v_t.id;
  return public.mz_support_ticket_json((select t from public.support_tickets t where t.id = v_t.id));
end $$;

-- Guarda la respuesta del asistente. Si la IA pide ayuda humana, pasa a la bandeja.
create or replace function public.support_ai_reply(p_ticket_id uuid, p_body text, p_meta jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.mz_require_user(); v_t public.support_tickets%rowtype;
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb); v_esc boolean; v_reason text; a record;
begin
  v_t := public.mz_support_own(p_ticket_id);
  if v_t.user_id <> v_uid then perform public.mz_fail('forbidden', 'No puedes responder en esta conversación.'); end if;
  if char_length(trim(coalesce(p_body, ''))) < 1 then perform public.mz_fail('validation', 'Respuesta vacía.'); end if;
  v_esc := coalesce((v_meta->>'escalate')::boolean, false);
  v_reason := left(nullif(trim(coalesce(v_meta->>'escalate_reason', '')), ''), 500);
  insert into public.support_messages (ticket_id, role, body, meta) values (v_t.id, 'ai', left(public.mz_support_redact(p_body), 4000),
    jsonb_strip_nulls(jsonb_build_object('escalate', v_esc, 'confidence', left(v_meta->>'confidence', 10), 'topic', left(v_meta->>'topic', 30),
      'actions', case when jsonb_typeof(v_meta->'actions') = 'array' then v_meta->'actions' end, 'kb_ids', case when jsonb_typeof(v_meta->'kb_ids') = 'array' then v_meta->'kb_ids' end)));
  if jsonb_typeof(v_meta->'kb_ids') = 'array' then
    update public.support_kb set uses = uses + 1 where id::text in (select jsonb_array_elements_text(v_meta->'kb_ids'));
  end if;
  update public.support_tickets set topic = coalesce(left(v_meta->>'topic', 30), topic), updated_at = now(),
    status = case when v_esc then 'needs_human' else status end,
    escalated_reason = case when v_esc then coalesce(v_reason, 'La IA pidió ayuda humana.') else escalated_reason end
   where id = v_t.id;
  if v_esc and v_t.status <> 'needs_human' then
    for a in select id from public.profiles where role = 'admin' and status = 'active' loop
      perform public.mz_notify(a.id, 'support_needs_human', 'Soporte: un cliente necesita ayuda', coalesce(v_reason, v_t.subject), '/admin/soporte');
    end loop;
  end if;
  return public.mz_support_ticket_json((select t from public.support_tickets t where t.id = v_t.id));
end $$;

create or replace function public.support_escalate(p_ticket_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user(); v_t public.support_tickets%rowtype; a record;
begin
  v_t := public.mz_support_own(p_ticket_id);
  if v_t.user_id <> v_uid then perform public.mz_fail('forbidden', 'No puedes cambiar esta conversación.'); end if;
  update public.support_tickets set status = 'needs_human', updated_at = now(),
    escalated_reason = left(coalesce(nullif(trim(p_reason), ''), 'La persona pidió hablar con el equipo.'), 500) where id = v_t.id;
  if v_t.status <> 'needs_human' then
    for a in select id from public.profiles where role = 'admin' and status = 'active' loop
      perform public.mz_notify(a.id, 'support_needs_human', 'Soporte: un cliente pidió hablar con alguien', coalesce(p_reason, v_t.subject), '/admin/soporte');
    end loop;
  end if;
  return public.mz_support_ticket_json((select t from public.support_tickets t where t.id = v_t.id));
end $$;

create or replace function public.support_feedback(p_message_id uuid, p_helpful boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_user(); v_m public.support_messages%rowtype; v_t public.support_tickets%rowtype;
begin
  select * into v_m from public.support_messages where id = p_message_id;
  if not found or v_m.role <> 'ai' then perform public.mz_fail('not_found', 'No encontramos ese mensaje.'); end if;
  v_t := public.mz_support_own(v_m.ticket_id);
  if v_t.user_id <> v_uid then perform public.mz_fail('forbidden', 'No puedes calificar este mensaje.'); end if;
  update public.support_messages set helpful = p_helpful where id = p_message_id;
  return public.mz_support_ticket_json((select t from public.support_tickets t where t.id = v_t.id));
end $$;

-- Respuestas aprobadas que usa la IA (solo las activas).
create or replace function public.support_kb() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'question', question, 'answer', answer) order by uses desc, updated_at desc), '[]'::jsonb)
  from (select * from public.support_kb where active order by uses desc, updated_at desc limit 200) k;
$$;

-- ---------- Equipo (administración) ----------
create or replace function public.admin_support_queue(p_status text default 'needs_human') returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.mz_require_admin();
  return coalesce((select jsonb_agg(x order by (x->>'updated_at') desc) from (
    select jsonb_build_object('id', t.id, 'status', t.status, 'subject', t.subject, 'topic', t.topic, 'escalated_reason', t.escalated_reason,
      'updated_at', t.updated_at, 'created_at', t.created_at,
      'user', (select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name) from public.profiles p where p.id = t.user_id),
      'messages_count', (select count(*) from public.support_messages m where m.ticket_id = t.id),
      'unhelpful', (select count(*) from public.support_messages m where m.ticket_id = t.id and m.helpful = false),
      'last', (select jsonb_build_object('role', m.role, 'body', left(m.body, 200)) from public.support_messages m where m.ticket_id = t.id order by m.created_at desc limit 1)) x
    from public.support_tickets t
    where (coalesce(p_status, '') = '' or p_status = 'all' or t.status = p_status
        or (p_status = 'unhelpful' and exists (select 1 from public.support_messages m where m.ticket_id = t.id and m.helpful = false)))
      and exists (select 1 from public.support_messages m where m.ticket_id = t.id)
    order by t.updated_at desc limit 200) q), '[]'::jsonb);
end $$;

create or replace function public.admin_support_ticket(p_ticket_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_t public.support_tickets%rowtype;
begin
  perform public.mz_require_admin();
  select * into v_t from public.support_tickets where id = p_ticket_id;
  if not found then perform public.mz_fail('not_found', 'No encontramos esta conversación.'); end if;
  return public.mz_support_ticket_json(v_t) || jsonb_build_object(
    'user', (select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'created_at', p.created_at) from public.profiles p where p.id = v_t.user_id));
end $$;

create or replace function public.admin_support_reply(p_ticket_id uuid, p_body text, p_save_kb boolean default false, p_question text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_admin(); v_t public.support_tickets%rowtype; v_body text := trim(coalesce(p_body, '')); v_q text;
begin
  select * into v_t from public.support_tickets where id = p_ticket_id for update;
  if not found then perform public.mz_fail('not_found', 'No encontramos esta conversación.'); end if;
  if char_length(v_body) < 2 or char_length(v_body) > 3000 then perform public.mz_fail('validation', 'Escribe la respuesta (2 a 3000 caracteres).', '{"field":"body"}'); end if;
  insert into public.support_messages (ticket_id, role, body, author_id) values (v_t.id, 'agent', v_body, v_uid);
  update public.support_tickets set status = 'answered', updated_at = now() where id = v_t.id;
  perform public.mz_notify(v_t.user_id, 'support_reply', 'El equipo de soporte te respondió', left(v_body, 140), '/ayuda');
  if coalesce(p_save_kb, false) then
    v_q := left(trim(coalesce(nullif(p_question, ''), v_t.subject, '')), 300);
    if char_length(v_q) < 5 then perform public.mz_fail('validation', 'Escribe la pregunta que resuelve esta respuesta (mínimo 5 caracteres).', '{"field":"question"}'); end if;
    insert into public.support_kb (question, answer, created_by) values (v_q, v_body, v_uid);
  end if;
  perform public.mz_audit('support_reply', 'support_ticket', v_t.id::text, jsonb_build_object('saved_kb', coalesce(p_save_kb, false)));
  return public.admin_support_ticket(v_t.id);
end $$;

create or replace function public.admin_support_close(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.mz_require_admin();
  update public.support_tickets set status = 'resolved', updated_at = now() where id = p_ticket_id;
  if not found then perform public.mz_fail('not_found', 'No encontramos esta conversación.'); end if;
  return public.admin_support_ticket(p_ticket_id);
end $$;

create or replace function public.admin_kb_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.mz_require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'question', question, 'answer', answer, 'active', active, 'uses', uses, 'updated_at', updated_at)
    order by updated_at desc) from public.support_kb), '[]'::jsonb);
end $$;

create or replace function public.admin_kb_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public.mz_require_admin(); v_id uuid := nullif(p->>'id', '')::uuid;
  v_q text := trim(coalesce(p->>'question', '')); v_a text := trim(coalesce(p->>'answer', '')); v_active boolean := coalesce((p->>'active')::boolean, true);
begin
  if char_length(v_q) < 5 or char_length(v_q) > 300 then perform public.mz_fail('validation', 'La pregunta debe tener de 5 a 300 caracteres.', '{"field":"question"}'); end if;
  if char_length(v_a) < 5 or char_length(v_a) > 3000 then perform public.mz_fail('validation', 'La respuesta debe tener de 5 a 3000 caracteres.', '{"field":"answer"}'); end if;
  if v_id is null then
    insert into public.support_kb (question, answer, active, created_by) values (v_q, v_a, v_active, v_uid) returning id into v_id;
  else
    update public.support_kb set question = v_q, answer = v_a, active = v_active, updated_at = now() where id = v_id;
    if not found then perform public.mz_fail('not_found', 'No encontramos esa respuesta.'); end if;
  end if;
  return public.admin_kb_list();
end $$;

create or replace function public.admin_kb_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.mz_require_admin();
  delete from public.support_kb where id = p_id;
  return public.admin_kb_list();
end $$;

revoke all on function public.mz_support_redact(text), public.mz_support_ticket_json(public.support_tickets), public.mz_support_own(uuid),
  public.support_current(), public.support_new(), public.support_send(uuid, text), public.support_ai_reply(uuid, text, jsonb),
  public.support_escalate(uuid, text), public.support_feedback(uuid, boolean), public.support_kb(),
  public.admin_support_queue(text), public.admin_support_ticket(uuid), public.admin_support_reply(uuid, text, boolean, text),
  public.admin_support_close(uuid), public.admin_kb_list(), public.admin_kb_save(jsonb), public.admin_kb_delete(uuid)
from public, anon, authenticated;
grant execute on function
  public.support_current(), public.support_new(), public.support_send(uuid, text), public.support_ai_reply(uuid, text, jsonb),
  public.support_escalate(uuid, text), public.support_feedback(uuid, boolean), public.support_kb(),
  public.admin_support_queue(text), public.admin_support_ticket(uuid), public.admin_support_reply(uuid, text, boolean, text),
  public.admin_support_close(uuid), public.admin_kb_list(), public.admin_kb_save(jsonb), public.admin_kb_delete(uuid)
to authenticated;
