-- PrimeCapture Connect: internal staff workspace, no public signup/tenancy.
begin;
create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(email)),
  role text not null check (role in ('admin','operator')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 120),
  notes text not null default '' check(length(notes)<=1000),
  created_at timestamptz not null default now()
);
create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  provider text not null default 'facebook' check(provider='facebook'),
  kind text not null default 'page' check(kind='page'),
  external_id text not null check(external_id ~ '^[0-9]{5,30}$'),
  display_name text not null check(length(display_name) between 2 and 120),
  connection_status text not null default 'requested' check(connection_status in ('requested','business_approved','oauth_authorized','publish_ready','expired','revoked')),
  publish_capable boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider,external_id), unique(id,client_id),
  check(not publish_capable or (connection_status='publish_ready' and last_verified_at is not null))
);
create table public.meta_credentials (
  id uuid primary key default gen_random_uuid(), destination_id uuid not null unique references public.destinations(id) on delete cascade,
  ciphertext text not null, iv text not null, tag text not null, key_version integer not null default 1,
  expires_at timestamptz, scopes text[] not null default '{}', updated_at timestamptz not null default now()
);
create table public.productions (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id),
  destination_id uuid, title text not null check(length(title) between 2 and 120),
  status text not null default 'DRAFT' check(status in ('DRAFT','ACCESS_PENDING')),
  created_by uuid not null references public.staff_profiles(user_id), created_at timestamptz not null default now(),
  foreign key(destination_id,client_id) references public.destinations(id,client_id)
);
create table public.broadcasts (
  id uuid primary key default gen_random_uuid(), production_id uuid not null references public.productions(id),
  destination_id uuid not null references public.destinations(id), meta_live_id text,
  status text not null default 'BLOCKED_PERMISSION', operation_key uuid not null unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.agents (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 120),
  device_token_hash text not null unique check(length(device_token_hash)=64), paired_by uuid not null references public.staff_profiles(user_id),
  last_seen_at timestamptz, revoked_at timestamptz, obs_connected boolean not null default false,
  output_active boolean not null default false, recording_active boolean not null default false, created_at timestamptz not null default now()
);
create table public.agent_commands (
  id uuid primary key default gen_random_uuid(), agent_id uuid not null references public.agents(id),
  production_id uuid not null references public.productions(id), broadcast_id uuid references public.broadcasts(id),
  action text not null check(action in ('HEALTH_CHECK','GET_OBS_STATUS','CONFIGURE_STREAM_WHEN_IDLE','START_STREAM_AFTER_CONFIRMATION','RESTORE_STREAM_WHEN_IDLE')),
  state text not null default 'pending' check(state in ('pending','claimed','completed','failed','unknown')),
  expires_at timestamptz not null, created_by uuid not null references public.staff_profiles(user_id),
  created_at timestamptz not null default now(), completed_at timestamptz,
  check(expires_at<=created_at+interval '30 seconds')
);
create table public.obs_snapshots (
  id uuid primary key default gen_random_uuid(), agent_id uuid not null references public.agents(id),
  broadcast_id uuid not null references public.broadcasts(id), encrypted_settings jsonb not null,
  applied_settings_fingerprint text not null, created_at timestamptz not null default now()
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references public.staff_profiles(user_id),
  action text not null, resource_id uuid, created_at timestamptz not null default now()
);
create index audit_events_created_idx on public.audit_events(created_at desc);
create table public.pairing_codes (
  code_hash text primary key, name text not null, paired_by uuid not null references public.staff_profiles(user_id),
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.oauth_states (
  state_hash text primary key, actor uuid not null references public.staff_profiles(user_id),
  destination_id uuid not null references public.destinations(id), expires_at timestamptz not null, consumed_at timestamptz
);
create table public.rate_limits (key text primary key, count integer not null, window_start timestamptz not null);

-- Security-definer helpers avoid recursive RLS; nothing trusts browser role metadata.
create function public.is_active_staff() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_profiles where user_id=auth.uid() and is_active);
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staff_profiles where user_id=auth.uid() and is_active and role='admin');
$$;
revoke all on function public.is_active_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_active_staff(), public.is_admin() to authenticated;

do $$ declare t text; begin
  foreach t in array array['staff_profiles','clients','destinations','meta_credentials','productions','broadcasts','agents','agent_commands','obs_snapshots','audit_events','pairing_codes','oauth_states','rate_limits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant select on public.staff_profiles,public.clients,public.destinations,public.productions,public.audit_events to authenticated;
create policy own_profile on public.staff_profiles for select to authenticated using(user_id=auth.uid());
create policy staff_clients on public.clients for select to authenticated using(public.is_active_staff());
create policy staff_destinations on public.destinations for select to authenticated using(public.is_active_staff());
create policy staff_productions on public.productions for select to authenticated using(public.is_active_staff());
create policy admin_audit on public.audit_events for select to authenticated using(public.is_admin());
-- All credential, device, snapshot, OAuth and command tables have zero browser policies/grants.

create function public.create_staff_record(table_name text, record jsonb, actor uuid, event_action text) returns void
language plpgsql security definer set search_path='' as $$
declare record_id uuid := (record->>'id')::uuid;
begin
  if not exists(select 1 from public.staff_profiles where user_id=actor and is_active) then raise exception 'staff required'; end if;
  case table_name
    when 'clients' then
      if event_action<>'client.created' then raise exception 'invalid action'; end if;
      insert into public.clients select * from jsonb_populate_record(null::public.clients,record);
    when 'destinations' then
      if event_action<>'destination.registered' or record->>'connection_status'<>'requested' or (record->>'publish_capable')::boolean then raise exception 'verification required'; end if;
      insert into public.destinations select * from jsonb_populate_record(null::public.destinations,record);
    when 'productions' then
      if event_action<>'production.created' or record->>'created_by'<>actor::text or record->>'status'<>'DRAFT' then raise exception 'invalid action'; end if;
      insert into public.productions select * from jsonb_populate_record(null::public.productions,record);
    else raise exception 'table not allowed';
  end case;
  insert into public.audit_events(actor_user_id,action,resource_id) values(actor,event_action,record_id);
end $$;
create function public.consume_rate_limit(bucket_key text,max_requests integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  insert into public.rate_limits as r(key,count,window_start) values(bucket_key,1,clock_timestamp())
  on conflict(key) do update set count=case when r.window_start<clock_timestamp()-interval '1 minute' then 1 else r.count+1 end,
  window_start=case when r.window_start<clock_timestamp()-interval '1 minute' then clock_timestamp() else r.window_start end returning count into n;
  return n<=max_requests;
end $$;
create function public.create_pairing(code_hash text,device_name text,actor uuid,expiry timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.staff_profiles where user_id=actor and is_active and role='admin') then raise exception 'admin required'; end if;
  if expiry>now()+interval '5 minutes' or expiry<=now() or length(code_hash)<>64 or length(device_name) not between 2 and 120 then raise exception 'invalid pairing'; end if;
  delete from public.pairing_codes where expires_at<now();
  insert into public.pairing_codes values(code_hash,device_name,actor,expiry,now());
  insert into public.audit_events(actor_user_id,action) values(actor,'agent.pairing_requested');
end $$;
create function public.claim_pairing(code_hash text,token_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare pair public.pairing_codes; device_id uuid;
begin
  delete from public.pairing_codes p where p.code_hash=claim_pairing.code_hash and p.expires_at>now() returning * into pair;
  if pair.code_hash is null or length(token_hash)<>64 or not exists(select 1 from public.staff_profiles where user_id=pair.paired_by and is_active and role='admin') then raise exception 'invalid pairing'; end if;
  insert into public.agents(name,device_token_hash,paired_by) values(pair.name,token_hash,pair.paired_by) returning id into device_id;
  insert into public.audit_events(actor_user_id,action,resource_id) values(pair.paired_by,'agent.paired',device_id);
  return device_id;
end $$;
create function public.revoke_agent(device_id uuid,actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.staff_profiles where user_id=actor and is_active and role='admin') then raise exception 'admin required'; end if;
  update public.agents set revoked_at=now() where id=device_id and revoked_at is null;
  if found then insert into public.audit_events(actor_user_id,action,resource_id) values(actor,'agent.revoked',device_id); end if;
end $$;
create function public.disconnect_destination(page_id uuid,actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.staff_profiles where user_id=actor and is_active and role='admin') then raise exception 'admin required'; end if;
  delete from public.meta_credentials where destination_id=page_id;
  update public.destinations set connection_status='revoked',publish_capable=false,last_verified_at=null where id=page_id;
  if found then insert into public.audit_events(actor_user_id,action,resource_id) values(actor,'destination.disconnected_locally',page_id); end if;
end $$;
revoke all on function public.create_staff_record(text,jsonb,uuid,text),public.consume_rate_limit(text,integer),public.create_pairing(text,text,uuid,timestamptz),public.claim_pairing(text,text),public.revoke_agent(uuid,uuid),public.disconnect_destination(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_staff_record(text,jsonb,uuid,text),public.consume_rate_limit(text,integer),public.create_pairing(text,text,uuid,timestamptz),public.claim_pairing(text,text),public.revoke_agent(uuid,uuid),public.disconnect_destination(uuid,uuid) to service_role;
commit;
