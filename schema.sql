-- =====================================================================
--  HALI SAHA LİGİ — Supabase veritabanı kurulumu
--  Supabase > SQL Editor > New query > bu dosyanın tamamını yapıştır > Run
-- =====================================================================

-- ---------- TABLOLAR ----------
create table if not exists public.teams (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  short_name  text,
  logo_url    text,
  color       text default '#16a34a',
  created_at  timestamptz default now()
);

create table if not exists public.players (
  id          bigint generated always as identity primary key,
  team_id     bigint not null references public.teams(id) on delete cascade,
  name        text not null,
  number      int,
  active      boolean not null default true,
  created_at  timestamptz default now()
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'viewer' check (role in ('admin','captain','viewer')),
  team_id      bigint references public.teams(id) on delete set null,
  created_at   timestamptz default now()
);

create table if not exists public.matches (
  id              bigint generated always as identity primary key,
  week            int not null default 1,
  match_date      timestamptz,
  venue           text,
  home_team_id    bigint not null references public.teams(id) on delete cascade,
  away_team_id    bigint not null references public.teams(id) on delete cascade,
  status          text not null default 'planned' check (status in ('planned','approved')),
  home_submitted  boolean not null default false,
  away_submitted  boolean not null default false,
  mvp_player_id   bigint references public.players(id) on delete set null,
  note            text,
  created_at      timestamptz default now(),
  check (home_team_id <> away_team_id)
);

-- Maç kadrosu
create table if not exists public.lineups (
  match_id   bigint not null references public.matches(id) on delete cascade,
  player_id  bigint not null references public.players(id) on delete cascade,
  team_id    bigint not null references public.teams(id) on delete cascade,
  primary key (match_id, player_id)
);

-- Goller: team_id = golün YAZILDIĞI takım. Skor bu tablodan otomatik hesaplanır.
-- Kendi kalesine gol: own_goal = true, scorer_id = rakip oyuncu (veya boş).
create table if not exists public.goals (
  id          bigint generated always as identity primary key,
  match_id    bigint not null references public.matches(id) on delete cascade,
  team_id     bigint not null references public.teams(id) on delete cascade,
  scorer_id   bigint references public.players(id) on delete set null,
  assist_id   bigint references public.players(id) on delete set null,
  own_goal    boolean not null default false,
  minute      int,
  created_at  timestamptz default now()
);

create index if not exists goals_match_idx   on public.goals(match_id);
create index if not exists lineups_match_idx on public.lineups(match_id);
create index if not exists players_team_idx  on public.players(team_id);

-- ---------- YARDIMCI FONKSİYONLAR ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_team() returns bigint
language sql stable security definer set search_path = public as $$
  select team_id from profiles where id = auth.uid() and role = 'captain';
$$;

create or replace function public.player_team(p bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select team_id from players where id = p;
$$;

-- Admin her maçı düzenler; kaptan sadece kendi takımının, onaylanmamış maçını
create or replace function public.can_edit_match_team(p_match bigint, p_team bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    p_team = public.my_team() and exists (
      select 1 from matches m
      where m.id = p_match and m.status <> 'approved'
        and p_team in (m.home_team_id, m.away_team_id)
    )
  );
$$;

-- Kaptan "bilgileri tamamladım" işaretler
create or replace function public.set_submitted(p_match bigint, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  t bigint := public.my_team();
  m matches%rowtype;
begin
  select * into m from matches where id = p_match;
  if not found then raise exception 'Maç bulunamadı'; end if;
  if m.status = 'approved' then raise exception 'Maç zaten onaylanmış'; end if;
  if t is not null and t = m.home_team_id then
    update matches set home_submitted = p_done where id = p_match;
  elsif t is not null and t = m.away_team_id then
    update matches set away_submitted = p_done where id = p_match;
  else
    raise exception 'Bu maç için yetkin yok';
  end if;
end;
$$;

-- Yeni kayıt olan herkese otomatik profil (rolü 'viewer')
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- GÜVENLİK (RLS) ----------
alter table public.teams    enable row level security;
alter table public.players  enable row level security;
alter table public.profiles enable row level security;
alter table public.matches  enable row level security;
alter table public.lineups  enable row level security;
alter table public.goals    enable row level security;

-- Herkes okuyabilir
create policy "teams read"   on public.teams   for select using (true);
create policy "players read" on public.players for select using (true);
create policy "matches read" on public.matches for select using (true);
create policy "lineups read" on public.lineups for select using (true);
create policy "goals read"   on public.goals   for select using (true);

-- Takımlar ve maçlar: sadece admin
create policy "teams admin insert" on public.teams for insert with check (public.is_admin());
create policy "teams admin update" on public.teams for update using (public.is_admin()) with check (public.is_admin());
create policy "teams admin delete" on public.teams for delete using (public.is_admin());

create policy "matches admin insert" on public.matches for insert with check (public.is_admin());
create policy "matches admin update" on public.matches for update using (public.is_admin()) with check (public.is_admin());
create policy "matches admin delete" on public.matches for delete using (public.is_admin());

-- Oyuncular: admin hepsi, kaptan kendi takımına ekler/düzenler (silme sadece admin)
create policy "players insert" on public.players for insert
  with check (public.is_admin() or team_id = public.my_team());
create policy "players update" on public.players for update
  using (public.is_admin() or team_id = public.my_team())
  with check (public.is_admin() or team_id = public.my_team());
create policy "players admin delete" on public.players for delete using (public.is_admin());

-- Kadro
create policy "lineups insert" on public.lineups for insert
  with check (public.can_edit_match_team(match_id, team_id)
              and public.player_team(player_id) = team_id);
create policy "lineups delete" on public.lineups for delete
  using (public.can_edit_match_team(match_id, team_id));

-- Goller
create policy "goals insert" on public.goals for insert
  with check (
    public.can_edit_match_team(match_id, team_id)
    and (assist_id is null or public.player_team(assist_id) = team_id)
    and (
      scorer_id is null
      or (own_goal = false and public.player_team(scorer_id) =  team_id)
      or (own_goal = true  and public.player_team(scorer_id) <> team_id)
    )
  );
create policy "goals delete" on public.goals for delete
  using (public.can_edit_match_team(match_id, team_id));

-- Profiller: herkes kendini görür, admin herkesi görür ve rol atar
create policy "profiles read" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy "profiles admin update" on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

-- ---------- LOGO DEPOSU ----------
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "logos admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and public.is_admin());
create policy "logos admin update" on storage.objects for update to authenticated
  using (bucket_id = 'logos' and public.is_admin());
create policy "logos admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and public.is_admin());

-- =====================================================================
--  SİTEDE KAYIT OLDUKTAN SONRA kendini admin yapmak için (e-postanı yaz):
--  update public.profiles set role = 'admin' where email = 'senin@mailin.com';
-- =====================================================================


-- =====================================================================
--  HOLIGANLIGA — Güncelleme 2
--  Oyuncu fotoğrafları, kaptanın logo değiştirmesi, saha dizilişi
--  (Birden fazla kez çalıştırılırsa sorun çıkarmaz)
-- =====================================================================

alter table public.players add column if not exists photo_url text;
alter table public.lineups add column if not exists slot int;

create unique index if not exists lineups_slot_uniq
  on public.lineups(match_id, team_id, slot) where slot is not null;

create table if not exists public.match_formations (
  match_id      bigint not null references public.matches(id) on delete cascade,
  team_id       bigint not null references public.teams(id) on delete cascade,
  player_count  int not null check (player_count between 5 and 11),
  formation     text not null,
  primary key (match_id, team_id)
);
alter table public.match_formations enable row level security;

drop policy if exists "formations read"   on public.match_formations;
drop policy if exists "formations insert" on public.match_formations;
drop policy if exists "formations update" on public.match_formations;
drop policy if exists "formations delete" on public.match_formations;
create policy "formations read" on public.match_formations for select using (true);
create policy "formations insert" on public.match_formations for insert
  with check (public.can_edit_match_team(match_id, team_id));
create policy "formations update" on public.match_formations for update
  using (public.can_edit_match_team(match_id, team_id))
  with check (public.can_edit_match_team(match_id, team_id));
create policy "formations delete" on public.match_formations for delete
  using (public.can_edit_match_team(match_id, team_id));

-- Kaptan sadece kendi takımının logosunu değiştirebilir (isim vb. değil)
create or replace function public.set_team_logo(p_team bigint, p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (coalesce(public.is_admin(), false) or coalesce(p_team = public.my_team(), false)) then
    raise exception 'Bu takım için yetkin yok';
  end if;
  update teams set logo_url = p_url where id = p_team;
end;
$$;

-- Kaptanlar sadece kendi takım klasörüne (t<takımId>/...) resim yükleyebilir
drop policy if exists "logos captain insert" on storage.objects;
create policy "logos captain insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and public.my_team() is not null
    and (storage.foldername(name))[1] = 't' || public.my_team()::text
  );


-- =====================================================================
--  HOLIGANLIGA — Güncelleme 3: her maçta iki MVP (her takımdan bir)
--  (Birden fazla kez çalıştırılırsa sorun çıkarmaz)
-- =====================================================================
alter table public.matches add column if not exists home_mvp_id bigint references public.players(id) on delete set null;
alter table public.matches add column if not exists away_mvp_id bigint references public.players(id) on delete set null;

-- Eski tek MVP kayıtlarını doğru takıma taşı
update public.matches m set home_mvp_id = m.mvp_player_id, mvp_player_id = null
where m.mvp_player_id is not null and m.home_mvp_id is null
  and (select team_id from public.players where id = m.mvp_player_id) = m.home_team_id;
update public.matches m set away_mvp_id = m.mvp_player_id, mvp_player_id = null
where m.mvp_player_id is not null and m.away_mvp_id is null
  and (select team_id from public.players where id = m.mvp_player_id) = m.away_team_id;
