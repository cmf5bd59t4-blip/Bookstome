-- Bookstome: Datenbank für Konten, Bibliotheken und Freunde (Supabase / PostgreSQL)
--
-- So richtest du sie ein: In Supabase links "SQL Editor" öffnen, "New query",
-- diesen gesamten Text einfügen und auf "Run" klicken. Das Skript darf mehrfach
-- laufen; vorhandene Bücher und Freundschaften bleiben dabei erhalten.
--
-- Sicherheit: Jede Tabelle hat Row Level Security. Man sieht nur die eigenen Daten
-- und die Bücher von Freunden, die nicht verborgen sind. Freundschaften entstehen
-- nur über einen Einladungslink. Einladungen und Freundschaften laufen ausschließlich
-- über die Funktionen unten, nie direkt über die Tabellen.

-- ---------------------------------------------------------------- Tabellen

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '' check (char_length(display_name) <= 60),
  library_name  text not null default '' check (char_length(library_name) <= 80),
  recommendation jsonb check (recommendation is null or octet_length(recommendation::text) < 50000),
  updated_at    timestamptz not null default now()
);

create table if not exists public.books (
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (char_length(id) between 1 and 120),
  data       jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 600000),
  hidden     boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner, id)
);

create table if not exists public.invites (
  token      text primary key default replace(gen_random_uuid()::text, '-', ''),
  inviter    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_by    uuid references auth.users (id) on delete set null,
  used_at    timestamptz
);
create index if not exists invites_inviter_idx on public.invites (inviter);

create table if not exists public.friendships (
  a          uuid not null references auth.users (id) on delete cascade,
  b          uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index if not exists friendships_b_idx on public.friendships (b);

-- updated_at automatisch setzen
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists books_touch on public.books;
create trigger books_touch before insert or update on public.books
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- Hilfsfunktion

-- Sind die angemeldete Person und "other" befreundet?
create or replace function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where f.a = least(auth.uid(), other) and f.b = greatest(auth.uid(), other)
  );
$$;

-- ---------------------------------------------------------------- Zugriffsregeln

alter table public.profiles    enable row level security;
alter table public.books       enable row level security;
alter table public.invites     enable row level security;
alter table public.friendships enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_friend(id));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists books_select on public.books;
drop policy if exists books_insert on public.books;
drop policy if exists books_update on public.books;
drop policy if exists books_delete on public.books;
create policy books_select on public.books for select to authenticated
  using (owner = (select auth.uid()) or (not hidden and public.is_friend(owner)));
create policy books_insert on public.books for insert to authenticated
  with check (owner = (select auth.uid()));
create policy books_update on public.books for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy books_delete on public.books for delete to authenticated
  using (owner = (select auth.uid()));

-- invites und friendships: keine Policies, also kein direkter Zugriff. Nur über die Funktionen.

revoke all on public.profiles, public.books, public.invites, public.friendships from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.books to authenticated;

-- ---------------------------------------------------------------- Funktionen für die App

-- Neuen Einladungslink erzeugen (einmal verwendbar, 30 Tage gültig).
create or replace function public.create_invite()
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  t text;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  delete from public.invites where inviter = me and used_by is null and expires_at < now();
  if (select count(*) from public.invites where inviter = me and created_at > now() - interval '1 day') >= 50 then
    raise exception 'too_many_invites';
  end if;
  insert into public.invites (inviter) values (me) returning token into t;
  return t;
end;
$$;

-- Wer lädt ein? Auch ohne Anmeldung abrufbar, damit die Einladungsseite den Namen zeigen kann.
create or replace function public.invite_info(p_token text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object('name', coalesce(p.display_name, ''), 'library', coalesce(p.library_name, ''))
  from public.invites i
  left join public.profiles p on p.id = i.inviter
  where i.token = p_token and i.used_by is null and i.expires_at > now();
$$;

-- Einladung annehmen: macht beide zu Freunden.
create or replace function public.accept_invite(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  inv public.invites;
  p public.profiles;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  select * into inv from public.invites where token = p_token for update;
  if not found then raise exception 'invite_invalid'; end if;
  if inv.inviter = me then raise exception 'invite_own'; end if;
  if inv.used_by is not null and inv.used_by <> me then raise exception 'invite_used'; end if;
  if inv.used_by is null and inv.expires_at < now() then raise exception 'invite_expired'; end if;
  insert into public.friendships (a, b)
    values (least(me, inv.inviter), greatest(me, inv.inviter))
    on conflict do nothing;
  update public.invites set used_by = me, used_at = coalesce(used_at, now()) where token = p_token;
  select * into p from public.profiles where id = inv.inviter;
  return json_build_object('id', inv.inviter, 'name', coalesce(p.display_name, ''), 'library', coalesce(p.library_name, ''));
end;
$$;

-- Liste der eigenen Freunde mit Anzahl ihrer sichtbaren Bücher.
create or replace function public.my_friends()
returns table (id uuid, name text, library text, books bigint, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.other,
         coalesce(p.display_name, ''),
         coalesce(p.library_name, ''),
         (select count(*) from public.books bk where bk.owner = o.other and not bk.hidden),
         o.created_at
  from (
    select case when f.a = auth.uid() then f.b else f.a end as other, f.created_at
    from public.friendships f
    where auth.uid() in (f.a, f.b)
  ) o
  left join public.profiles p on p.id = o.other
  order by lower(coalesce(p.display_name, ''));
$$;

-- Freundschaft beenden (für beide Seiten).
create or replace function public.remove_friend(p_friend uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.friendships
  where a = least(auth.uid(), p_friend) and b = greatest(auth.uid(), p_friend);
$$;

-- Eigenes Konto samt allen Daten löschen.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  delete from public.books where owner = me;
  delete from public.friendships where me in (a, b);
  delete from public.invites where inviter = me;
  delete from public.profiles where id = me;
  begin
    delete from auth.users where id = me;
  exception when others then
    null; -- Falls das Projekt das Löschen des Logins nicht erlaubt, sind die Daten trotzdem weg.
  end;
end;
$$;

revoke all on function public.is_friend(uuid), public.create_invite(), public.invite_info(text),
  public.accept_invite(text), public.my_friends(), public.remove_friend(uuid), public.delete_my_account()
  from public, anon, authenticated;
grant execute on function public.is_friend(uuid), public.create_invite(), public.accept_invite(text),
  public.my_friends(), public.remove_friend(uuid), public.delete_my_account() to authenticated;
grant execute on function public.invite_info(text) to anon, authenticated;
