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
