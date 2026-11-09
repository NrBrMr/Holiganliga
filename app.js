import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, LEAGUE_NAME, SEASON, POINTS } from './config.js';

// =====================================================================
//  DURUM
// =====================================================================
const app = document.getElementById('app');
const configured = !SUPABASE_URL.includes('XXXX') && !SUPABASE_ANON_KEY.includes('BURAYA');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const state = {
  session: null, profile: null,
  teams: [], players: [], matches: [], goals: [],
  goalsByMatch: new Map(),
  loaded: false,
  panelTeam: null,
};
let lastHash = null;

document.getElementById('league-name').textContent = LEAGUE_NAME;
document.getElementById('season').textContent = SEASON || '';
document.title = LEAGUE_NAME;

// =====================================================================
//  YARDIMCILAR
// =====================================================================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const teamById = id => state.teams.find(t => t.id === id);
const playerById = id => state.players.find(p => p.id === id);
const pname = p => p ? `${p.number != null ? p.number + ' · ' : ''}${esc(p.name)}` : '—';
const signed = n => (n > 0 ? '+' : '') + n;
const isAdmin = () => state.profile?.role === 'admin';
const myTeam = () => (state.profile?.role === 'captain' ? state.profile.team_id : null);
const goalsOf = mid => state.goalsByMatch.get(mid) || [];
const byTr = (a, b) => a.localeCompare(b, 'tr');

function teamPlayers(tid, onlyActive = true) {
  return state.players
    .filter(p => p.team_id === tid && (!onlyActive || p.active))
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || byTr(a.name, b.name));
}

function logo(t, size = 28) {
  if (!t) return `<span class="logo ph" style="width:${size}px;height:${size}px"></span>`;
  if (t.logo_url) {
    return `<img class="logo" src="${esc(t.logo_url)}" crossorigin="anonymous" alt="" style="width:${size}px;height:${size}px">`;
  }
  const ini = (t.short_name || t.name).slice(0, 3).toLocaleUpperCase('tr');
  return `<span class="logo ph" style="width:${size}px;height:${size}px;background:${esc(t.color || '#16a34a')};font-size:${Math.round(size * 0.34)}px">${esc(ini)}</span>`;
}

function fmtDate(iso, withDay = true) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', withDay
    ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });
}
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const fromLocalInput = v => (v ? new Date(v).toISOString() : null);

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ''), 3200);
}

function errMsg(e) {
  const m = e?.message || String(e);
  if (e?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'Bu işlem için yetkin yok.';
  if (/Invalid login/i.test(m)) return 'E-posta veya şifre hatalı.';
  if (/Email not confirmed/i.test(m)) return 'Önce e-postandaki onay linkine tıklamalısın.';
  if (/duplicate key/i.test(m)) return 'Bu kayıt zaten var.';
  if (/Password should be/i.test(m)) return 'Şifre en az 6 karakter olmalı.';
  return m;
}

// Bir işlemi çalıştır, verileri yenile, sayfayı tekrar çiz
async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await loadAll();
    await route();
  } catch (e) {
    console.error(e);
    toast(errMsg(e), true);
  }
}
const check = ({ error, data }) => { if (error) throw error; return data; };

// =====================================================================
//  VERİ
// =====================================================================
async function fetchAll(table, order = 'id') {
  const size = 1000, out = [];
  for (let from = 0; ; from += size) {
    const data = check(await sb.from(table).select('*').order(order).range(from, from + size - 1));
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

async function loadAll() {
  const [teams, players, matches, goals] = await Promise.all([
    fetchAll('teams'), fetchAll('players'), fetchAll('matches'), fetchAll('goals'),
  ]);
  teams.sort((a, b) => byTr(a.name, b.name));
  const gbm = new Map();
  for (const g of goals) {
    if (!gbm.has(g.match_id)) gbm.set(g.match_id, []);
    gbm.get(g.match_id).push(g);
  }
  Object.assign(state, { teams, players, matches, goals, goalsByMatch: gbm, loaded: true });
}

async function loadProfile() {
  if (!state.session) { state.profile = null; return; }
  const { data } = await sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle();
  state.profile = data || null;
}

function scoreOf(m) {
  let h = 0, a = 0;
  for (const g of goalsOf(m.id)) {
    if (g.team_id === m.home_team_id) h++;
    else if (g.team_id === m.away_team_id) a++;
  }
  return [h, a];
}

function computeStandings() {
  const rows = new Map(state.teams.map(t => [t.id, { team: t, o: 0, g: 0, b: 0, m: 0, ag: 0, yg: 0, p: 0, form: [] }]));
  const played = state.matches
    .filter(m => m.status === 'approved')
    .sort((a, b) => a.week - b.week || new Date(a.match_date || 0) - new Date(b.match_date || 0));
  for (const m of played) {
    const [h, a] = scoreOf(m);
    const H = rows.get(m.home_team_id), A = rows.get(m.away_team_id);
    if (!H || !A) continue;
    H.o++; A.o++;
    H.ag += h; H.yg += a; A.ag += a; A.yg += h;
    if (h > a) { H.g++; A.m++; H.p += POINTS.win; A.p += POINTS.loss; H.form.push('G'); A.form.push('M'); }
    else if (h < a) { A.g++; H.m++; A.p += POINTS.win; H.p += POINTS.loss; A.form.push('G'); H.form.push('M'); }
    else { H.b++; A.b++; H.p += POINTS.draw; A.p += POINTS.draw; H.form.push('B'); A.form.push('B'); }
  }
  return [...rows.values()].sort((x, y) =>
    y.p - x.p || (y.ag - y.yg) - (x.ag - x.yg) || y.ag - x.ag || byTr(x.team.name, y.team.name));
}

function leaders() {
  const approved = new Set(state.matches.filter(m => m.status === 'approved').map(m => m.id));
  const goals = new Map(), assists = new Map(), mvps = new Map();
  const inc = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  for (const g of state.goals) {
    if (!approved.has(g.match_id)) continue;
    if (g.scorer_id && !g.own_goal) inc(goals, g.scorer_id);
    if (g.assist_id) inc(assists, g.assist_id);
  }
  for (const m of state.matches) if (approved.has(m.id) && m.mvp_player_id) inc(mvps, m.mvp_player_id);
  const list = map => [...map.entries()]
    .map(([pid, n]) => ({ player: playerById(pid), n }))
    .filter(x => x.player)
    .sort((a, b) => b.n - a.n || byTr(a.player.name, b.player.name));
  return { goals: list(goals), assists: list(assists), mvps: list(mvps) };
}

const lastApprovedWeek = () =>
  Math.max(0, ...state.matches.filter(m => m.status === 'approved').map(m => m.week));

// =====================================================================
//  GÖRSEL OLARAK PAYLAŞ
// =====================================================================
async function shareNode(node, name) {
  if (!window.html2canvas) return toast('Görsel aracı yüklenemedi, sayfayı yenile.', true);
  toast('Görsel hazırlanıyor…');
  node.classList.add('capturing');
  let canvas;
  try {
    canvas = await window.html2canvas(node, { backgroundColor: '#0b1410', scale: 2, useCORS: true, logging: false });
  } finally {
    node.classList.remove('capturing');
  }
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  // Paylaşım desteklenmiyorsa: resmi göster, indir / uzun basıp kaydet
  const url = URL.createObjectURL(blob);
  const modal = $('#modal');
  modal.innerHTML = `<div class="modal-box">
      <img src="${url}" alt="">
      <p class="muted">Telefonda resme uzun basıp kaydedebilirsin.</p>
      <div class="row"><a class="btn" href="${url}" download="${esc(file.name)}">İndir</a>
      <button class="btn ghost" id="modal-close">Kapat</button></div></div>`;
  modal.hidden = false;
  $('#modal-close').onclick = () => { modal.hidden = true; modal.innerHTML = ''; URL.revokeObjectURL(url); };
}

function shareBtn(id) { return `<button class="btn share" data-share="${id}">📸 Görsel olarak paylaş</button>`; }
function bindShare(name) {
  $$('[data-share]').forEach(b => (b.onclick = () => shareNode(document.getElementById(b.dataset.share), name)));
}
const capHead = sub => `<div class="cap-head"><b>⚽ ${esc(LEAGUE_NAME)}</b><span>${esc(sub)}</span></div>`;

// =====================================================================
//  SAYFALAR
// =====================================================================
function viewStandings() {
  const rows = computeStandings();
  const w = lastApprovedWeek();
  if (!state.teams.length) {
    app.innerHTML = `<div class="card empty">Henüz takım eklenmedi.${isAdmin() ? ' <a href="#/panel">Panelden ekle →</a>' : ''}</div>`;
    return;
  }
  app.innerHTML = `
    <div id="cap-table" class="cap">
      ${capHead(`Puan Durumu${w ? ` · ${w}. hafta sonrası` : ''}`)}
      <div class="card flush">
        <table class="standings">
          <thead><tr><th>#</th><th class="tm">Takım</th><th>O</th><th>G</th><th>B</th><th>M</th>
            <th class="hide-sm">AG</th><th class="hide-sm">YG</th><th>AV</th><th>P</th><th class="hide-sm">Form</th></tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr>
              <td class="pos">${i + 1}</td>
              <td class="tm"><a href="#/takim/${r.team.id}">${logo(r.team, 24)}<span>${esc(r.team.name)}</span></a></td>
              <td>${r.o}</td><td>${r.g}</td><td>${r.b}</td><td>${r.m}</td>
              <td class="hide-sm">${r.ag}</td><td class="hide-sm">${r.yg}</td>
              <td>${signed(r.ag - r.yg)}</td><td class="pts">${r.p}</td>
              <td class="form hide-sm">${r.form.slice(-5).map(f => `<i class="f ${f}">${f}</i>`).join('')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${shareBtn('cap-table')}
    ${weekBlock()}`;
  bindShare(`puan-durumu-${w}-hafta`);
}

// Ana sayfada sıradaki / son haftanın maçları
function weekBlock() {
  const pending = state.matches.filter(m => m.status !== 'approved').map(m => m.week);
  const week = pending.length ? Math.min(...pending) : lastApprovedWeek();
  const ms = state.matches.filter(m => m.week === week).sort(byDate);
  if (!ms.length) return '';
  return `<h2 class="sec">${week}. Hafta</h2><div class="card flush">${ms.map(matchRow).join('')}</div>`;
}

const byDate = (a, b) => new Date(a.match_date || 0) - new Date(b.match_date || 0) || a.id - b.id;

function matchRow(m) {
  const H = teamById(m.home_team_id), A = teamById(m.away_team_id);
  const [h, a] = scoreOf(m);
  const started = m.status === 'approved' || goalsOf(m.id).length > 0;
  const center = started
    ? `<b class="score ${m.status === 'approved' ? '' : 'tmp'}">${h} - ${a}</b>`
    : `<span class="time">${m.match_date ? fmtDate(m.match_date, false) : 'vs'}</span>`;
  let badge = '';
  if (m.status !== 'approved' && started) badge = '<span class="badge warn">Onay bekliyor</span>';
  return `<a class="match" href="#/mac/${m.id}">
      <span class="side home"><span class="nm">${esc(H?.name)}</span>${logo(H, 26)}</span>
      ${center}
      <span class="side away">${logo(A, 26)}<span class="nm">${esc(A?.name)}</span></span>
      <span class="meta">${m.match_date ? fmtDate(m.match_date) : ''}${m.venue ? ' · ' + esc(m.venue) : ''} ${badge}</span>
    </a>`;
}

function viewFixtures() {
  if (!state.matches.length) {
    app.innerHTML = `<div class="card empty">Henüz maç eklenmedi.</div>`;
    return;
  }
  const weeks = [...new Set(state.matches.map(m => m.week))].sort((a, b) => a - b);
  app.innerHTML = weeks.map(w => `
    <h2 class="sec" id="hafta-${w}">${w}. Hafta</h2>
    <div class="card flush">${state.matches.filter(m => m.week === w).sort(byDate).map(matchRow).join('')}</div>`).join('');
  const firstOpen = state.matches.filter(m => m.status !== 'approved').map(m => m.week);
  if (firstOpen.length && lastHash !== '#/fikstur:scrolled') {
    document.getElementById(`hafta-${Math.min(...firstOpen)}`)?.scrollIntoView({ block: 'start' });
  }
}

function viewLeaders() {
  const L = leaders();
  const block = (title, icon, list, unit) => `
    <div class="card flush">
      <h3 class="card-h">${icon} ${title}</h3>
      ${list.length ? `<ol class="leaders">${list.slice(0, 15).map((x, i) => {
        const t = teamById(x.player.team_id);
        return `<li class="${i < 3 ? 'top' + (i + 1) : ''}"><span class="rk">${i + 1}</span>${logo(t, 22)}
          <span class="pl">${esc(x.player.name)}<small>${esc(t?.name)}</small></span><b>${x.n}</b><small class="u">${unit}</small></li>`;
      }).join('')}</ol>` : '<p class="muted pad">Henüz veri yok.</p>'}
    </div>`;
  app.innerHTML = `
    <div id="cap-leaders" class="cap">
      ${capHead(`Krallık Yarışı${lastApprovedWeek() ? ` · ${lastApprovedWeek()}. hafta sonrası` : ''}`)}
      ${block('Gol Krallığı', '⚽', L.goals, 'gol')}
      ${block('Asist Krallığı', '🎯', L.assists, 'asist')}
      ${block('En Çok MVP', '⭐', L.mvps, 'MVP')}
    </div>
    ${shareBtn('cap-leaders')}`;
  bindShare('krallik-yarisi');
}

function viewTeam(id) {
  const t = teamById(id);
  if (!t) { app.innerHTML = '<div class="card empty">Takım bulunamadı.</div>'; return; }
  const approved = new Set(state.matches.filter(m => m.status === 'approved').map(m => m.id));
  const st = new Map();
  const get = pid => st.get(pid) || st.set(pid, { g: 0, a: 0, mvp: 0 }).get(pid);
  for (const g of state.goals) {
    if (!approved.has(g.match_id)) continue;
    if (g.scorer_id && !g.own_goal) get(g.scorer_id).g++;
    if (g.assist_id) get(g.assist_id).a++;
  }
  for (const m of state.matches) if (approved.has(m.id) && m.mvp_player_id) get(m.mvp_player_id).mvp++;
  const row = computeStandings().findIndex(r => r.team.id === id) + 1;
  const ms = state.matches.filter(m => m.home_team_id === id || m.away_team_id === id).sort((a, b) => a.week - b.week || byDate(a, b));
  app.innerHTML = `
    <div id="cap-team" class="cap">
      <div class="team-hero">${logo(t, 72)}<div><h1>${esc(t.name)}</h1><span class="muted">${row}. sırada</span></div></div>
      <div class="card flush">
        <table class="roster"><thead><tr><th>No</th><th class="tm">Oyuncu</th><th>⚽</th><th>🎯</th><th>⭐</th></tr></thead>
        <tbody>${teamPlayers(id).map(p => {
          const s = st.get(p.id) || { g: 0, a: 0, mvp: 0 };
          return `<tr><td>${p.number ?? ''}</td><td class="tm">${esc(p.name)}</td><td>${s.g}</td><td>${s.a}</td><td>${s.mvp}</td></tr>`;
        }).join('') || '<tr><td colspan="5" class="muted">Oyuncu eklenmemiş.</td></tr>'}</tbody></table>
      </div>
    </div>
    ${shareBtn('cap-team')}
    <h2 class="sec">Maçlar</h2>
    <div class="card flush">${ms.map(matchRow).join('') || '<p class="muted pad">Maç yok.</p>'}</div>`;
  bindShare(`takim-${t.name}`);
}

// ---------------------------------------------------------------------
//  MAÇ DETAYI + DÜZENLEME
// ---------------------------------------------------------------------
function editableTeams(m) {
  if (isAdmin()) return [m.home_team_id, m.away_team_id];
  const t = myTeam();
  if (t && m.status !== 'approved' && (t === m.home_team_id || t === m.away_team_id)) return [t];
  return [];
}

async function viewMatch(id) {
  const m = state.matches.find(x => x.id === id);
  if (!m) { app.innerHTML = '<div class="card empty">Maç bulunamadı.</div>'; return; }
  const lineups = check(await sb.from('lineups').select('*').eq('match_id', id));
  const H = teamById(m.home_team_id), A = teamById(m.away_team_id);
  const [h, a] = scoreOf(m);
  const goals = [...goalsOf(id)].sort((x, y) => (x.minute ?? 999) - (y.minute ?? 999) || x.id - y.id);
  const mvp = playerById(m.mvp_player_id);
  const luOf = tid => lineups.filter(l => l.team_id === tid).map(l => playerById(l.player_id)).filter(Boolean)
    .sort((x, y) => (x.number ?? 999) - (y.number ?? 999) || byTr(x.name, y.name));

  const goalLine = g => {
    const s = playerById(g.scorer_id), as = playerById(g.assist_id);
    const who = g.own_goal ? `${s ? esc(s.name) : 'Rakip'} <small>(k.k.)</small>` : (s ? esc(s.name) : 'Belirtilmemiş');
    return `<div class="goal ${g.team_id === m.home_team_id ? 'h' : 'a'}">
      <span>⚽ ${g.minute != null ? g.minute + "' " : ''}${who}${as ? ` <small>asist: ${esc(as.name)}</small>` : ''}</span></div>`;
  };

  const status = m.status === 'approved' ? '<span class="badge ok">Onaylandı</span>'
    : goals.length ? '<span class="badge warn">Onay bekliyor</span>' : '<span class="badge">Oynanmadı</span>';

  app.innerHTML = `
    <div id="cap-match" class="cap">
      ${capHead(`${m.week}. Hafta${m.match_date ? ' · ' + fmtDate(m.match_date) : ''}${m.venue ? ' · ' + m.venue : ''}`)}
      <div class="card match-hero">
        <a href="#/takim/${H?.id}" class="mh-team">${logo(H, 64)}<span>${esc(H?.name)}</span></a>
        <div class="mh-score">${m.status === 'approved' || goals.length ? `${h} - ${a}` : 'vs'}<div>${status}</div></div>
        <a href="#/takim/${A?.id}" class="mh-team">${logo(A, 64)}<span>${esc(A?.name)}</span></a>
      </div>
      ${goals.length ? `<div class="card goals">${goals.map(goalLine).join('')}</div>` : ''}
      ${mvp ? `<div class="card mvp">⭐ <b>Maçın Oyuncusu:</b> ${esc(mvp.name)} <small>${esc(teamById(mvp.team_id)?.name)}</small></div>` : ''}
      <div class="lineups">
        ${[H, A].map(t => `<div class="card"><h3 class="card-h">${logo(t, 22)} ${esc(t?.name)}</h3>
          ${luOf(t?.id).length ? `<ul class="lu">${luOf(t.id).map(p => `<li>${pname(p)}</li>`).join('')}</ul>` : '<p class="muted">Kadro girilmedi.</p>'}</div>`).join('')}
      </div>
    </div>
    ${shareBtn('cap-match')}
    ${m.note ? `<div class="card muted">📝 ${esc(m.note)}</div>` : ''}
    ${editableTeams(m).map(t => teamEditor(m, t, lineups)).join('')}
    ${isAdmin() ? adminMatchEditor(m, lineups) : ''}`;

  bindShare(`mac-${H?.name}-${A?.name}`);
  bindMatchEditors(m);
}

function scorerOptions(m, T) {
  const opp = T === m.home_team_id ? m.away_team_id : m.home_team_id;
  return `<option value="">Golcü seç…</option>
    <optgroup label="${esc(teamById(T)?.name)}">${teamPlayers(T).map(p => `<option value="p:${p.id}">${pname(p)}</option>`).join('')}</optgroup>
    <optgroup label="Kendi kalesine (rakip oyuncu)">${teamPlayers(opp).map(p => `<option value="og:${p.id}">${pname(p)} (k.k.)</option>`).join('')}
      <option value="og:">Rakip – belirtilmemiş (k.k.)</option></optgroup>
    <option value="none">Golcü belirtilmemiş</option>`;
}

function teamEditor(m, T, lineups) {
  const t = teamById(T);
  const inLu = new Set(lineups.filter(l => l.team_id === T).map(l => l.player_id));
  const myGoals = goalsOf(m.id).filter(g => g.team_id === T).sort((x, y) => (x.minute ?? 999) - (y.minute ?? 999) || x.id - y.id);
  const submitted = T === m.home_team_id ? m.home_submitted : m.away_submitted;
  return `
  <section class="card edit" data-team="${T}">
    <h3 class="card-h">${logo(t, 22)} ${esc(t?.name)} · Düzenle</h3>

    <h4>Maç kadrosu</h4>
    <div class="checks">${teamPlayers(T).map(p => `
      <label><input type="checkbox" name="lu" value="${p.id}" ${inLu.has(p.id) ? 'checked' : ''}> ${pname(p)}</label>`).join('') || '<p class="muted">Önce oyuncu ekle.</p>'}
    </div>
    <button class="btn" data-act="save-lineup">Kadroyu kaydet</button>

    <h4>Goller (${myGoals.length})</h4>
    <ul class="goal-list">${myGoals.map(g => {
      const s = playerById(g.scorer_id), as = playerById(g.assist_id);
      return `<li>${g.minute != null ? g.minute + "' " : ''}${s ? esc(s.name) : (g.own_goal ? 'Rakip' : 'Belirtilmemiş')}${g.own_goal ? ' (k.k.)' : ''}${as ? ` · asist ${esc(as.name)}` : ''}
        <button class="x" data-del-goal="${g.id}" title="Sil">✕</button></li>`;
    }).join('')}</ul>
    <form class="goal-form">
      <select name="scorer" required>${scorerOptions(m, T)}</select>
      <select name="assist"><option value="">Asist yok</option>${teamPlayers(T).map(p => `<option value="${p.id}">${pname(p)}</option>`).join('')}</select>
      <input name="minute" type="number" min="0" max="120" placeholder="Dk" class="num">
      <button class="btn">+ Gol ekle</button>
    </form>

    <details><summary>Takıma yeni oyuncu ekle</summary>
      <form class="add-player inline"><input name="number" type="number" class="num" placeholder="No">
        <input name="name" placeholder="Oyuncu adı" required><button class="btn">Ekle</button></form>
    </details>

    ${!isAdmin() ? `<label class="submit-toggle"><input type="checkbox" data-act="submitted" ${submitted ? 'checked' : ''}>
       Bilgileri tamamladım (yöneticiye haber ver)</label>` : ''}
  </section>`;
}

function adminMatchEditor(m, lineups) {
  const luIds = new Set(lineups.map(l => l.player_id));
  let cands = [...teamPlayers(m.home_team_id), ...teamPlayers(m.away_team_id)];
  if (luIds.size) cands = cands.filter(p => luIds.has(p.id));
  const sub = t => (t ? '✅' : '⏳');
  return `
  <section class="card edit admin" id="admin-match">
    <h3 class="card-h">🛠 Yönetici</h3>
    <p class="muted">Kaptan durumu: ${esc(teamById(m.home_team_id)?.name)} ${sub(m.home_submitted)} · ${esc(teamById(m.away_team_id)?.name)} ${sub(m.away_submitted)}</p>

    <h4>Maçın Oyuncusu (MVP)</h4>
    <div class="row">
      <select id="mvp-sel"><option value="">— Seçilmedi —</option>${cands.map(p =>
        `<option value="${p.id}" ${p.id === m.mvp_player_id ? 'selected' : ''}>${pname(p)} (${esc(teamById(p.team_id)?.short_name || teamById(p.team_id)?.name)})</option>`).join('')}</select>
      <button class="btn" data-act="save-mvp">Kaydet</button>
    </div>

    <h4>Maç bilgileri</h4>
    <form id="match-info" class="grid">
      <label>Hafta<input name="week" type="number" min="1" value="${m.week}"></label>
      <label>Tarih<input name="date" type="datetime-local" value="${toLocalInput(m.match_date)}"></label>
      <label class="full">Saha<input name="venue" value="${esc(m.venue)}"></label>
      <label class="full">Not<input name="note" value="${esc(m.note)}" placeholder="Örn. hükmen, ertelendi…"></label>
      <button class="btn full">Bilgileri kaydet</button>
    </form>

    <div class="row gap">
      ${m.status === 'approved'
        ? '<button class="btn ghost" data-act="unapprove">Onayı kaldır</button>'
        : '<button class="btn ok" data-act="approve">✔ Sonucu onayla (tabloya işle)</button>'}
      <button class="btn danger" data-act="delete-match">Maçı sil</button>
    </div>
  </section>`;
}

function bindMatchEditors(m) {
  $$('.edit[data-team]').forEach(sec => {
    const T = Number(sec.dataset.team);

    $('[data-act="save-lineup"]', sec).onclick = () => act(async () => {
      const ids = $$('input[name="lu"]:checked', sec).map(i => Number(i.value));
      check(await sb.from('lineups').delete().eq('match_id', m.id).eq('team_id', T));
      if (ids.length) check(await sb.from('lineups').insert(ids.map(pid => ({ match_id: m.id, player_id: pid, team_id: T }))));
    }, 'Kadro kaydedildi');

    $('.goal-form', sec).onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const sc = f.get('scorer');
      let scorer_id = null, own_goal = false;
      if (sc.startsWith('p:')) scorer_id = Number(sc.slice(2));
      else if (sc.startsWith('og:')) { own_goal = true; scorer_id = sc.slice(3) ? Number(sc.slice(3)) : null; }
      const assist_id = f.get('assist') ? Number(f.get('assist')) : null;
      if (assist_id && assist_id === scorer_id) return toast('Golcü ve asist aynı kişi olamaz.', true);
      const minute = f.get('minute') !== '' ? Number(f.get('minute')) : null;
      act(async () => check(await sb.from('goals').insert({ match_id: m.id, team_id: T, scorer_id, assist_id, own_goal, minute })), 'Gol eklendi');
    };

    $$('[data-del-goal]', sec).forEach(b => (b.onclick = () => {
      if (!confirm('Bu gol silinsin mi?')) return;
      act(async () => check(await sb.from('goals').delete().eq('id', Number(b.dataset.delGoal))), 'Gol silindi');
    }));

    $('.add-player', sec).onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target);
      act(async () => check(await sb.from('players').insert({
        team_id: T, name: f.get('name').trim(), number: f.get('number') ? Number(f.get('number')) : null,
      })), 'Oyuncu eklendi');
    };

    const sub = $('[data-act="submitted"]', sec);
    if (sub) sub.onchange = () => act(async () => check(await sb.rpc('set_submitted', { p_match: m.id, p_done: sub.checked })),
      sub.checked ? 'Yöneticiye bildirildi' : 'İşaret kaldırıldı');
  });

  const adm = $('#admin-match');
  if (!adm) return;
  const upd = (patch, msg) => act(async () => check(await sb.from('matches').update(patch).eq('id', m.id)), msg);
  $('[data-act="save-mvp"]', adm).onclick = () => upd({ mvp_player_id: $('#mvp-sel').value ? Number($('#mvp-sel').value) : null }, 'MVP kaydedildi');
  $('#match-info').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    upd({ week: Number(f.get('week')) || 1, match_date: fromLocalInput(f.get('date')), venue: f.get('venue') || null, note: f.get('note') || null }, 'Kaydedildi');
  };
  $('[data-act="approve"]', adm)?.addEventListener('click', () => upd({ status: 'approved' }, 'Onaylandı, tablo güncellendi'));
  $('[data-act="unapprove"]', adm)?.addEventListener('click', () => upd({ status: 'planned' }, 'Onay kaldırıldı'));
  $('[data-act="delete-match"]', adm).onclick = () => {
    if (!confirm('Maç, golleri ve kadrosuyla birlikte silinecek. Emin misin?')) return;
    act(async () => { check(await sb.from('matches').delete().eq('id', m.id)); location.hash = '#/fikstur'; }, 'Maç silindi');
  };
}

// ---------------------------------------------------------------------
//  GİRİŞ / PANEL
// ---------------------------------------------------------------------
function viewLogin() {
  app.innerHTML = `
    <div class="card auth">
      <h2>Giriş yap</h2>
      <p class="muted">Lig yöneticisi ve takım kaptanları için. İzlemek için giriş gerekmez.</p>
      <form id="login">
        <input name="email" type="email" placeholder="E-posta" required autocomplete="email">
        <input name="password" type="password" placeholder="Şifre" required autocomplete="current-password">
        <button class="btn full">Giriş yap</button>
      </form>
      <details><summary>Hesabın yok mu? Kayıt ol</summary>
        <form id="signup">
          <input name="name" placeholder="Adın soyadın" required>
          <input name="email" type="email" placeholder="E-posta" required autocomplete="email">
          <input name="password" type="password" placeholder="Şifre (en az 6 karakter)" required minlength="6" autocomplete="new-password">
          <button class="btn full">Kayıt ol</button>
        </form>
        <p class="muted small">Kayıttan sonra yönetici seni takımına kaptan olarak atayınca düzenleme yapabilirsin.</p>
      </details>
    </div>`;
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) toast(errMsg(error), true); else toast('Hoş geldin!');
  };
  $('#signup').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { data, error } = await sb.auth.signUp({
      email: f.get('email'), password: f.get('password'),
      options: { data: { display_name: f.get('name') }, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) return toast(errMsg(error), true);
    toast(data.session ? 'Kayıt tamam!' : 'Onay e-postası gönderildi, gelen kutunu kontrol et.');
  };
}

async function viewPanel() {
  if (!state.session) return viewLogin();
  const p = state.profile;
  const head = `<div class="card userbar"><span>👤 ${esc(p?.display_name || state.session.user.email)}
      <small class="muted">${isAdmin() ? 'Yönetici' : myTeam() ? `Kaptan · ${esc(teamById(myTeam())?.name)}` : 'İzleyici'}</small></span>
      <button class="btn ghost small" id="logout">Çıkış</button></div>`;

  if (isAdmin()) await adminPanel(head);
  else if (myTeam()) captainPanel(head);
  else app.innerHTML = head + `<div class="card empty">Hesabın oluşturuldu. Lig yöneticisi seni bir takıma <b>kaptan</b> olarak atadığında
      buradan kadro ve gol girebileceksin.</div>`;

  $('#logout').onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; };
}

function playersEditor(T) {
  const ps = teamPlayers(T, false);
  return `<div class="players-editor" data-team="${T}">
    ${ps.map(p => `<form class="prow" data-pid="${p.id}">
      <input name="number" type="number" class="num" value="${p.number ?? ''}" placeholder="No">
      <input name="name" value="${esc(p.name)}" required>
      <label class="chk"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Aktif</label>
      <button class="btn small">Kaydet</button>
      ${isAdmin() ? `<button type="button" class="x" data-del-player="${p.id}" title="Sil">✕</button>` : ''}
    </form>`).join('') || '<p class="muted">Henüz oyuncu yok.</p>'}
    <form class="add-player inline"><input name="number" type="number" class="num" placeholder="No">
      <input name="name" placeholder="Yeni oyuncu adı" required><button class="btn">+ Ekle</button></form>
  </div>`;
}

function bindPlayersEditor() {
  $$('.players-editor').forEach(ed => {
    const T = Number(ed.dataset.team);
    $$('.prow', ed).forEach(f => (f.onsubmit = e => {
      e.preventDefault();
      const d = new FormData(f);
      act(async () => check(await sb.from('players').update({
        name: d.get('name').trim(), number: d.get('number') ? Number(d.get('number')) : null, active: d.get('active') === 'on',
      }).eq('id', Number(f.dataset.pid))), 'Oyuncu güncellendi');
    }));
    $$('[data-del-player]', ed).forEach(b => (b.onclick = () => {
      if (!confirm('Oyuncu silinsin mi? Geçmiş gollerinde ismi görünmez olur. (Sadece pasif yapmak daha iyi olabilir.)')) return;
      act(async () => check(await sb.from('players').delete().eq('id', Number(b.dataset.delPlayer))), 'Oyuncu silindi');
    }));
    $('.add-player', ed).onsubmit = e => {
      e.preventDefault();
      const d = new FormData(e.target);
      act(async () => check(await sb.from('players').insert({
        team_id: T, name: d.get('name').trim(), number: d.get('number') ? Number(d.get('number')) : null,
      })), 'Oyuncu eklendi');
    };
  });
}

function captainPanel(head) {
  const T = myTeam();
  const ms = state.matches.filter(m => (m.home_team_id === T || m.away_team_id === T) && m.status !== 'approved')
    .sort((a, b) => a.week - b.week || byDate(a, b));
  app.innerHTML = head + `
    <h2 class="sec">Düzenlenebilir maçların</h2>
    <p class="muted">Maça dokun → kadro ve golleri gir.</p>
    <div class="card flush">${ms.map(matchRow).join('') || '<p class="muted pad">Açık maç yok.</p>'}</div>
    <h2 class="sec">${logo(teamById(T), 22)} Oyuncuların</h2>
    <div class="card">${playersEditor(T)}</div>`;
  bindPlayersEditor();
}

async function adminPanel(head) {
  const profiles = check(await sb.from('profiles').select('*').order('created_at'));
  const waiting = state.matches.filter(m => m.status !== 'approved' && (goalsOf(m.id).length || m.home_submitted || m.away_submitted))
    .sort((a, b) => a.week - b.week || byDate(a, b));
  if (!state.panelTeam || !teamById(state.panelTeam)) state.panelTeam = state.teams[0]?.id ?? null;
  const nextWeek = Math.max(1, ...state.matches.map(m => m.week));
  const teamOpts = sel => state.teams.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

  app.innerHTML = head + `
    ${waiting.length ? `<h2 class="sec">⏳ Onay bekleyen maçlar</h2><div class="card flush">${waiting.map(matchRow).join('')}</div>` : ''}

    <h2 class="sec">Maç ekle</h2>
    <form id="add-match" class="card grid">
      <label>Hafta<input name="week" type="number" min="1" value="${nextWeek}" required></label>
      <label>Tarih / saat<input name="date" type="datetime-local"></label>
      <label>Ev sahibi<select name="home" required>${teamOpts()}</select></label>
      <label>Deplasman<select name="away" required>${teamOpts(state.teams[1]?.id)}</select></label>
      <label class="full">Saha<input name="venue" placeholder="Örn. Yıldız Halı Saha 2"></label>
      <button class="btn full">+ Maçı ekle</button>
    </form>

    <h2 class="sec">Takımlar</h2>
    <div class="card">
      ${state.teams.map(t => `<form class="trow" data-tid="${t.id}">
        ${logo(t, 40)}
        <input name="name" value="${esc(t.name)}" required>
        <input name="short" value="${esc(t.short_name)}" maxlength="3" placeholder="KSA" class="num">
        <input name="color" type="color" value="${esc(t.color || '#16a34a')}">
        <label class="btn small ghost">Logo<input type="file" accept="image/*" hidden data-logo="${t.id}"></label>
        <button class="btn small">Kaydet</button>
        <button type="button" class="x" data-del-team="${t.id}" title="Sil">✕</button>
      </form>`).join('')}
      <form id="add-team" class="inline">
        <input name="name" placeholder="Yeni takım adı" required>
        <input name="short" maxlength="3" placeholder="KSA" class="num">
        <input name="color" type="color" value="#16a34a">
        <button class="btn">+ Ekle</button>
      </form>
    </div>

    <h2 class="sec">Oyuncular</h2>
    <div class="card">
      ${state.teams.length ? `<select id="panel-team">${teamOpts(state.panelTeam)}</select>${playersEditor(state.panelTeam)}` : '<p class="muted">Önce takım ekle.</p>'}
    </div>

    <h2 class="sec">Kullanıcılar & kaptanlar</h2>
    <div class="card">
      <p class="muted small">Kaptanlar sitede kayıt olunca burada görünür. Rolünü "Kaptan" yapıp takımını seç.</p>
      ${profiles.map(u => `<form class="urow" data-uid="${u.id}">
        <span class="em">${esc(u.display_name || '')}<small>${esc(u.email)}</small></span>
        <select name="role">
          <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>İzleyici</option>
          <option value="captain" ${u.role === 'captain' ? 'selected' : ''}>Kaptan</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Yönetici</option>
        </select>
        <select name="team"><option value="">— Takım —</option>${teamOpts(u.team_id)}</select>
        <button class="btn small">Kaydet</button>
      </form>`).join('')}
    </div>`;

  $('#add-match').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const home = Number(f.get('home')), away = Number(f.get('away'));
    if (home === away) return toast('Bir takım kendisiyle oynayamaz 🙂', true);
    act(async () => check(await sb.from('matches').insert({
      week: Number(f.get('week')), match_date: fromLocalInput(f.get('date')), venue: f.get('venue') || null,
      home_team_id: home, away_team_id: away,
    })), 'Maç eklendi');
  };

  $('#add-team').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    act(async () => check(await sb.from('teams').insert({
      name: f.get('name').trim(), short_name: f.get('short').trim() || null, color: f.get('color'),
    })), 'Takım eklendi');
  };

  $$('.trow').forEach(f => (f.onsubmit = e => {
    e.preventDefault();
    const d = new FormData(f);
    act(async () => check(await sb.from('teams').update({
      name: d.get('name').trim(), short_name: d.get('short').trim() || null, color: d.get('color'),
    }).eq('id', Number(f.dataset.tid))), 'Takım güncellendi');
  }));

  $$('[data-del-team]').forEach(b => (b.onclick = () => {
    if (!confirm('Takım, oyuncuları ve maçlarıyla birlikte silinecek! Emin misin?')) return;
    act(async () => check(await sb.from('teams').delete().eq('id', Number(b.dataset.delTeam))), 'Takım silindi');
  }));

  $$('[data-logo]').forEach(inp => (inp.onchange = () => {
    const file = inp.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('Logo en fazla 2 MB olmalı.', true);
    const id = Number(inp.dataset.logo);
    act(async () => {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `team-${id}-${Date.now()}.${ext}`;
      check(await sb.storage.from('logos').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type }));
      const { data } = sb.storage.from('logos').getPublicUrl(path);
      check(await sb.from('teams').update({ logo_url: data.publicUrl }).eq('id', id));
    }, 'Logo yüklendi');
  }));

  const pt = $('#panel-team');
  if (pt) pt.onchange = () => { state.panelTeam = Number(pt.value); route(); };
  bindPlayersEditor();

  $$('.urow').forEach(f => (f.onsubmit = e => {
    e.preventDefault();
    const d = new FormData(f);
    const role = d.get('role'), team_id = d.get('team') ? Number(d.get('team')) : null;
    if (role === 'captain' && !team_id) return toast('Kaptan için takım seçmelisin.', true);
    if (f.dataset.uid === state.session.user.id && role !== 'admin' && !confirm('Kendi yönetici yetkini kaldırıyorsun. Emin misin?')) return;
    act(async () => check(await sb.from('profiles').update({ role, team_id }).eq('id', f.dataset.uid)), 'Kullanıcı güncellendi');
  }));
}

// =====================================================================
//  YÖNLENDİRME
// =====================================================================
async function route() {
  const hash = location.hash || '#/';
  const [, page = '', id] = hash.split('/');
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (['mac', 'takim'].includes(page) ? '' : page)));
  $('#tab-panel span').textContent = state.session ? 'Panel' : 'Giriş';
  const changed = hash !== lastHash;

  try {
    if (page === 'fikstur') viewFixtures();
    else if (page === 'krallar') viewLeaders();
    else if (page === 'mac') await viewMatch(Number(id));
    else if (page === 'takim') viewTeam(Number(id));
    else if (page === 'panel') await viewPanel();
    else viewStandings();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card empty">Bir hata oldu: ${esc(errMsg(e))}</div>`;
  }
  if (changed && page !== 'fikstur') window.scrollTo(0, 0);
  lastHash = page === 'fikstur' ? '#/fikstur:scrolled' : hash;
}

async function start() {
  if (!configured) {
    app.innerHTML = `<div class="card empty"><h2>Kurulum gerekli</h2>
      <p><code>config.js</code> dosyasına Supabase adresini ve anahtarını yaz. Adımlar README dosyasında.</p></div>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  try {
    await Promise.all([loadAll(), loadProfile()]);
  } catch (e) {
    app.innerHTML = `<div class="card empty">Veriler yüklenemedi: ${esc(errMsg(e))}<br><small>schema.sql çalıştırıldı mı?</small></div>`;
    return;
  }
  await route();

  sb.auth.onAuthStateChange((event, session) => {
    // Supabase önerisi: callback içinde doğrudan başka sorgu bekleme
    setTimeout(async () => {
      const was = state.session?.user?.id, now = session?.user?.id;
      state.session = session;
      if (was === now && event !== 'USER_UPDATED') return;
      await loadProfile();
      if (event === 'SIGNED_IN' && location.hash.startsWith('#/panel') === false && !was) location.hash = '#/panel';
      else route();
    }, 0);
  });
  window.addEventListener('hashchange', route);
}

start();
