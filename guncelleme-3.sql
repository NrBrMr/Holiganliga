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
