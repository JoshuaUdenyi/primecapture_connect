-- Add YouTube without changing existing Facebook destinations or OBS controls.
begin;
alter table public.productions drop constraint productions_status_check;
alter table public.productions add constraint productions_status_check check(status in ('DRAFT','ACCESS_PENDING','BROADCAST_PREPARED'));
alter table public.destinations drop constraint destinations_provider_check;
alter table public.destinations drop constraint destinations_kind_check;
alter table public.destinations drop constraint destinations_external_id_check;
alter table public.destinations drop constraint destinations_display_name_check;
alter table public.destinations add constraint destinations_display_name_check check(length(display_name) between 1 and 120);
alter table public.destinations add constraint destinations_provider_identity_check check (
  (provider='facebook' and kind='page' and external_id ~ '^[0-9]{5,30}$') or
  (provider='youtube' and kind='channel' and external_id ~ '^UC[A-Za-z0-9_-]{22}$')
);
create table public.youtube_credentials (
  destination_id uuid primary key references public.destinations(id) on delete cascade,
  encrypted_refresh_token jsonb not null,
  updated_at timestamptz not null default now()
);
create table public.youtube_oauth_requests (
  id uuid primary key, invite_hash text not null unique check(length(invite_hash)=64),
  client_id uuid not null references public.clients(id), actor uuid not null references public.staff_profiles(user_id),
  expires_at timestamptz not null, invite_used_at timestamptz,
  state_hash text unique, browser_hash text, encrypted_verifier jsonb, oauth_expires_at timestamptz,
  consumed_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.youtube_broadcasts (
  id uuid primary key default gen_random_uuid(), production_id uuid not null unique references public.productions(id),
  destination_id uuid not null references public.destinations(id),
  youtube_broadcast_id text, youtube_stream_id text,
  status text not null default 'PREPARING' check(status in ('PREPARING','READY','NEEDS_ATTENTION')),
  privacy text not null check(privacy in ('private','unlisted','public')),
  scheduled_start_at timestamptz not null, made_for_kids boolean not null,
  created_by uuid not null references public.staff_profiles(user_id),
  operation_key uuid not null unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(status<>'READY' or (youtube_broadcast_id is not null and youtube_stream_id is not null))
);
-- No browser grants, including metadata: use the authenticated staff API.
revoke all on public.youtube_credentials,public.youtube_oauth_requests,public.youtube_broadcasts from public,anon,authenticated;
grant all on public.youtube_credentials,public.youtube_oauth_requests,public.youtube_broadcasts to service_role;
alter table public.youtube_credentials enable row level security;
alter table public.youtube_oauth_requests enable row level security;
alter table public.youtube_broadcasts enable row level security;

create function public.create_youtube_invite(ticket_id uuid,ticket_hash text,client uuid,actor uuid,expiry timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.staff_profiles s where s.user_id=actor and s.is_active and s.role='admin') then raise exception 'admin required'; end if;
  if length(ticket_hash)<>64 or expiry>now()+interval '24 hours' or expiry<=now() then raise exception 'invalid invitation'; end if;
  insert into public.youtube_oauth_requests(id,invite_hash,client_id,actor,expires_at) values(ticket_id,ticket_hash,client,actor,expiry);
  insert into public.audit_events(actor_user_id,action,resource_id) values(actor,'youtube.connection_link_created',client);
end $$;
create function public.begin_youtube_oauth(ticket_hash text,state_digest text,browser_digest text,verifier jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ticket uuid;
begin
  if length(state_digest)<>64 or length(browser_digest)<>64 then raise exception 'invalid state'; end if;
  update public.youtube_oauth_requests r set state_hash=state_digest,browser_hash=browser_digest,encrypted_verifier=verifier,
    oauth_expires_at=now()+interval '10 minutes',invite_used_at=now()
  where r.invite_hash=ticket_hash and r.invite_used_at is null and r.expires_at>now() and r.cancelled_at is null
    and exists(select 1 from public.staff_profiles s where s.user_id=r.actor and s.is_active and s.role='admin') returning r.id into ticket;
  if ticket is null then raise exception 'invalid invitation'; end if;
  return ticket;
end $$;
create function public.claim_youtube_oauth(state_digest text,browser_digest text) returns setof public.youtube_oauth_requests
language plpgsql security definer set search_path='' as $$
begin
  return query update public.youtube_oauth_requests r set consumed_at=now()
    where r.state_hash=state_digest and r.browser_hash=browser_digest and r.consumed_at is null and r.cancelled_at is null
      and r.expires_at>now() and r.oauth_expires_at>now()
      and exists(select 1 from public.staff_profiles s where s.user_id=r.actor and s.is_active and s.role='admin') returning r.*;
end $$;
create function public.save_youtube_connection(ticket_id uuid,new_destination uuid,channel_id text,channel_title text,encrypted_token jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ticket public.youtube_oauth_requests; destination public.destinations;
begin
  select * into ticket from public.youtube_oauth_requests r where r.id=ticket_id for update;
  if ticket.id is null or ticket.consumed_at is null or ticket.completed_at is not null or ticket.cancelled_at is not null or ticket.expires_at<=now() or ticket.oauth_expires_at<=now() then raise exception 'invalid consent'; end if;
  if not exists(select 1 from public.staff_profiles s where s.user_id=ticket.actor and s.is_active and s.role='admin') then raise exception 'admin required'; end if;
  perform pg_advisory_xact_lock(hashtext(channel_id));
  select * into destination from public.destinations d where d.provider='youtube' and d.external_id=channel_id for update;
  if destination.id is not null and destination.client_id<>ticket.client_id then raise exception 'channel belongs to another client'; end if;
  if destination.id is null then
    insert into public.destinations(id,client_id,provider,kind,external_id,display_name,connection_status,publish_capable,last_verified_at)
      values(new_destination,ticket.client_id,'youtube','channel',channel_id,channel_title,'oauth_authorized',false,now()) returning * into destination;
  else
    update public.destinations set display_name=channel_title,connection_status='oauth_authorized',publish_capable=false,last_verified_at=now() where id=destination.id;
  end if;
  insert into public.youtube_credentials(destination_id,encrypted_refresh_token) values(destination.id,encrypted_token)
    on conflict(destination_id) do update set encrypted_refresh_token=excluded.encrypted_refresh_token,updated_at=now();
  update public.youtube_oauth_requests set completed_at=now(),encrypted_verifier=null where id=ticket.id;
  insert into public.audit_events(actor_user_id,action,resource_id) values(ticket.actor,'youtube.channel_connected',destination.id);
  return destination.id;
end $$;
create function public.claim_youtube_broadcast(production uuid,actor uuid,start_time timestamptz,visibility text,kids boolean,operation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prod public.productions; destination public.destinations; broadcast public.youtube_broadcasts;
begin
  if not exists(select 1 from public.staff_profiles s where s.user_id=actor and s.is_active) then raise exception 'staff required'; end if;
  select * into prod from public.productions p where p.id=production for update;
  select * into destination from public.destinations d where d.id=prod.destination_id;
  if destination.provider<>'youtube' or destination.connection_status in ('revoked','expired') or not exists(select 1 from public.youtube_credentials c where c.destination_id=destination.id) then raise exception 'channel connection required'; end if;
  select * into broadcast from public.youtube_broadcasts b where b.production_id=production;
  if broadcast.id is not null then return to_jsonb(broadcast); end if;
  if start_time<=now() or start_time>now()+interval '366 days' then raise exception 'invalid start time'; end if;
  insert into public.youtube_broadcasts(production_id,destination_id,privacy,scheduled_start_at,made_for_kids,created_by,operation_key)
    values(production,destination.id,visibility,start_time,kids,actor,operation) returning * into broadcast;
  insert into public.audit_events(actor_user_id,action,resource_id) values(actor,'youtube.broadcast_requested',broadcast.id);
  return to_jsonb(broadcast);
end $$;
create function public.checkpoint_youtube_broadcast(broadcast uuid,actor uuid,step text,remote_id text default null) returns void
language plpgsql security definer set search_path='' as $$
declare item public.youtube_broadcasts;
begin
  if not exists(select 1 from public.staff_profiles s where s.user_id=actor and s.is_active) then raise exception 'staff required'; end if;
  select * into item from public.youtube_broadcasts b where b.id=broadcast for update;
  if item.id is null or item.status<>'PREPARING' then raise exception 'broadcast not pending'; end if;
  if step in ('broadcast','stream') and (remote_id is null or remote_id !~ '^[A-Za-z0-9_-]{6,128}$') then raise exception 'invalid remote id'; end if;
  case step
    when 'broadcast' then
      if item.youtube_broadcast_id is not null then raise exception 'already recorded'; end if;
      update public.youtube_broadcasts set youtube_broadcast_id=remote_id,updated_at=now() where id=broadcast;
    when 'stream' then
      if item.youtube_broadcast_id is null or item.youtube_stream_id is not null then raise exception 'invalid order'; end if;
      update public.youtube_broadcasts set youtube_stream_id=remote_id,updated_at=now() where id=broadcast;
    when 'ready' then
      if item.youtube_broadcast_id is null or item.youtube_stream_id is null or not exists(select 1 from public.destinations d join public.youtube_credentials c on c.destination_id=d.id where d.id=item.destination_id and d.connection_status not in ('revoked','expired')) then raise exception 'channel unavailable'; end if;
      update public.youtube_broadcasts set status='READY',updated_at=now() where id=broadcast;
      update public.productions set status='BROADCAST_PREPARED' where id=item.production_id;
      update public.destinations set connection_status='publish_ready',publish_capable=true,last_verified_at=now() where id=item.destination_id;
      insert into public.audit_events(actor_user_id,action,resource_id) values(actor,'youtube.broadcast_prepared',broadcast);
    when 'attention' then
      update public.youtube_broadcasts set status='NEEDS_ATTENTION',updated_at=now() where id=broadcast;
      insert into public.audit_events(actor_user_id,action,resource_id) values(actor,'youtube.broadcast_needs_attention',broadcast);
    else raise exception 'invalid step';
  end case;
end $$;
create or replace function public.disconnect_destination(page_id uuid,actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.staff_profiles s where s.user_id=actor and s.is_active and s.role='admin') then raise exception 'admin required'; end if;
  delete from public.meta_credentials where destination_id=page_id;
  delete from public.youtube_credentials where destination_id=page_id;
  update public.youtube_oauth_requests r set cancelled_at=now(),encrypted_verifier=null where r.client_id=(select d.client_id from public.destinations d where d.id=page_id) and r.completed_at is null;
  update public.destinations set connection_status='revoked',publish_capable=false,last_verified_at=null where id=page_id;
  if found then insert into public.audit_events(actor_user_id,action,resource_id) values(actor,'destination.disconnected_locally',page_id); end if;
end $$;
revoke all on function public.create_youtube_invite(uuid,text,uuid,uuid,timestamptz),public.begin_youtube_oauth(text,text,text,jsonb),public.claim_youtube_oauth(text,text),public.save_youtube_connection(uuid,uuid,text,text,jsonb),public.claim_youtube_broadcast(uuid,uuid,timestamptz,text,boolean,uuid),public.checkpoint_youtube_broadcast(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_youtube_invite(uuid,text,uuid,uuid,timestamptz),public.begin_youtube_oauth(text,text,text,jsonb),public.claim_youtube_oauth(text,text),public.save_youtube_connection(uuid,uuid,text,text,jsonb),public.claim_youtube_broadcast(uuid,uuid,timestamptz,text,boolean,uuid),public.checkpoint_youtube_broadcast(uuid,uuid,text,text) to service_role;
commit;
