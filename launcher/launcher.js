const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Preferências guardadas só neste computador
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem storage */ } },
};

const ICON_PLAY = '<svg viewBox="0 0 10 10"><path d="M1 0l9 5-9 5z"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M6 6l12 12M18 6L6 18"/></svg>';

let games = [];
let favs = new Set(store.get('favs', []));
let recent = store.get('recent', {});
const ui = {
  page: 'library',
  history: [],
  tab: 'all',
  view: store.get('view', 'grid'),
  sort: store.get('sort', 'recent'),
  query: '',
  filters: { genre: new Set(), inputs: new Set(), orientation: new Set() },
};
let rate = 'normal';
let current = { mode: 'none', state: 'disconnected' };
const stats = { comment: 0, gift: 0, coins: 0, like: 0 };

// ---------- Navegação ----------
function go(page, push = true) {
  if (page === ui.page) return;
  if (push) ui.history.push(ui.page);
  ui.page = page;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('hidden', p.id !== `page-${page}`));
  $('.scroll').scrollTop = 0;
}
$$('.nav-item').forEach((n) => n.addEventListener('click', () => go(n.dataset.page)));
$('#back').addEventListener('click', () => { if (ui.history.length) go(ui.history.pop(), false); });
$('#top-live').addEventListener('click', () => go('live'));
$('#side-status').addEventListener('click', () => go('live'));
$('#avatar').addEventListener('click', () => go('live'));

// ---------- Banner ----------
if (store.get('bannerDismissed', false)) $('#banner').classList.add('hidden');
$('#banner-dismiss').addEventListener('click', () => { $('#banner').classList.add('hidden'); store.set('bannerDismissed', true); });
$('#banner-go').addEventListener('click', () => go('live'));

// ---------- Biblioteca ----------
function filterValues(g, key) {
  if (key === 'orientation') return [g.orientation === 'landscape' ? 'Horizontal (16:9)' : 'Vertical (9:16)'];
  if (key === 'genre') return g.genre ? [g.genre] : [];
  return g[key] || [];
}

function visibleGames() {
  const q = ui.query.trim().toLowerCase();
  let list = games.filter((g) => {
    if (ui.tab === 'fav' && !favs.has(g.id)) return false;
    if (q && !g.name.toLowerCase().includes(q)) return false;
    for (const [key, set] of Object.entries(ui.filters)) {
      if (set.size && !filterValues(g, key).some((v) => set.has(v))) return false;
    }
    return true;
  });
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  if (ui.sort === 'az') list.sort(byName);
  else if (ui.sort === 'za') list.sort((a, b) => byName(b, a));
  else list.sort((a, b) => (recent[b.id] || 0) - (recent[a.id] || 0) || byName(a, b));
  return list;
}

function coverEl(g) {
  const el = document.createElement('div');
  el.className = 'cover';
  el.style.background = g.coverColor || 'var(--surface)';
  if (g.coverUrl) {
    const img = document.createElement('img');
    img.src = g.coverUrl;
    img.alt = '';
    img.onerror = () => { img.remove(); el.textContent = g.icon || '🎮'; };
    el.appendChild(img);
  } else el.textContent = g.icon || '🎮';
  return el;
}

function renderLibrary() {
  const box = $('#games');
  box.className = `games ${ui.view}`;
  box.innerHTML = '';
  const list = visibleGames();

  for (const g of list) {
    const card = document.createElement('article');
    card.className = 'card';
    const cover = coverEl(g);
    cover.addEventListener('click', () => play(g.id));
    if (favs.has(g.id)) {
      const b = document.createElement('span');
      b.className = 'fav-badge';
      b.textContent = '♥';
      cover.appendChild(b);
    }
    card.appendChild(cover);

    const info = document.createElement('div');
    info.className = 'card-info';
    info.innerHTML = `<div><div class="card-name"></div><div class="card-meta"></div>
      <button class="card-play">${ICON_PLAY} Jogar</button></div><button class="more" title="Mais opções">${ICON_MORE}</button>`;
    info.querySelector('.card-name').textContent = g.name;
    info.querySelector('.card-meta').textContent = [g.genre, ...(g.inputs || [])].filter(Boolean).join(' · ');
    info.querySelector('.card-play').addEventListener('click', () => play(g.id));
    info.querySelector('.more').addEventListener('click', (e) => { e.stopPropagation(); openMenu(e.currentTarget, g); });
    card.appendChild(info);
    box.appendChild(card);
  }

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = ui.tab === 'fav' && !favs.size
      ? 'Nenhum favorito ainda. Use o menu "..." de um jogo para favoritar.'
      : 'Nenhum jogo encontrado com esses filtros.';
    box.appendChild(empty);
  }
  $('#count').textContent = `Exibindo ${list.length} de ${games.length}`;

  const active = Object.values(ui.filters).reduce((n, s) => n + s.size, 0) + (ui.query ? 1 : 0);
  $('#filters-title').textContent = active ? `Filtros (${active})` : 'Filtros';
  renderFilterOptions();
}

function renderFilterOptions() {
  for (const group of $$('.filter-group')) {
    const key = group.dataset.key;
    const values = [...new Set(games.flatMap((g) => filterValues(g, key)))].sort();
    const box = group.querySelector('.filter-options');
    box.innerHTML = '';
    for (const v of values) {
      const n = games.filter((g) => filterValues(g, key).includes(v)).length;
      const b = document.createElement('button');
      b.className = `filter-option${ui.filters[key].has(v) ? ' on' : ''}`;
      b.innerHTML = `<span></span><span class="x">${ICON_X}</span>`;
      b.firstChild.textContent = `${v} (${n})`;
      b.addEventListener('click', () => {
        const set = ui.filters[key];
        set.has(v) ? set.delete(v) : set.add(v);
        renderLibrary();
      });
      box.appendChild(b);
    }
  }
}

$$('.filter-toggle').forEach((t) => t.addEventListener('click', () => t.parentElement.classList.toggle('open')));
$('#filters-reset').addEventListener('click', () => {
  Object.values(ui.filters).forEach((s) => s.clear());
  setQuery('');
});

function setQuery(q) {
  ui.query = q;
  $('#search').value = q;
  $('#filter-title').value = q;
  renderLibrary();
}
$('#search').addEventListener('input', (e) => { go('library'); setQuery(e.target.value); });
$('#filter-title').addEventListener('input', (e) => setQuery(e.target.value));

$$('.tab').forEach((t) => t.addEventListener('click', () => {
  ui.tab = t.dataset.tab;
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  renderLibrary();
}));

$('#sort').value = ui.sort;
$('#sort').addEventListener('change', (e) => { ui.sort = e.target.value; store.set('sort', ui.sort); renderLibrary(); });

function setView(v) {
  ui.view = v;
  store.set('view', v);
  $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  renderLibrary();
}
$$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

$('#refresh').addEventListener('click', loadGames);

async function loadGames() {
  games = await window.live.games();
  renderLibrary();
  renderQuick();
}

function play(id) {
  recent[id] = Date.now();
  store.set('recent', recent);
  window.live.play(id);
  renderQuick();
  if (ui.sort === 'recent') renderLibrary();
}

// ---------- Inicialização rápida ----------
function renderQuick() {
  const box = $('#quick-list');
  box.innerHTML = '';
  const list = games.filter((g) => recent[g.id] || favs.has(g.id))
    .sort((a, b) => (recent[b.id] || 0) - (recent[a.id] || 0)).slice(0, 6);
  if (!list.length) {
    box.innerHTML = '<div class="quick-empty">Os jogos que você abrir aparecem aqui.</div>';
    return;
  }
  for (const g of list) {
    const b = document.createElement('button');
    b.className = 'quick-item';
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    if (g.coverUrl) thumb.style.backgroundImage = `url("${g.coverUrl}")`;
    else { thumb.style.background = g.coverColor || 'var(--surface)'; thumb.textContent = g.icon || '🎮'; }
    const name = document.createElement('span');
    name.textContent = g.name;
    b.append(thumb, name);
    b.addEventListener('click', () => play(g.id));
    box.appendChild(b);
  }
}

// ---------- Menu "..." ----------
const menu = $('#menu');
function openMenu(anchor, g) {
  const fav = favs.has(g.id);
  menu.innerHTML = '';
  const items = [
    ['<svg viewBox="0 0 24 24"><path d="M7 4l12 8-12 8z"/></svg>', 'Jogar', () => play(g.id)],
    [`<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"${fav ? ' fill="currentColor"' : ''}/></svg>`,
      fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos', () => toggleFav(g.id)],
    ['<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>', 'Abrir no navegador', () => window.live.openInBrowser(g.id)],
    ['<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>', 'Copiar link para o OBS', () => {
      navigator.clipboard.writeText(g.url).then(() => toast('Link copiado. No OBS: Fonte > Navegador > cole a URL'));
    }],
  ];
  for (const [icon, label, fn] of items) {
    const b = document.createElement('button');
    b.innerHTML = icon;
    b.append(label);
    b.addEventListener('click', () => { closeMenu(); fn(); });
    menu.appendChild(b);
  }
  menu.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left, innerWidth - menu.offsetWidth - 12);
  const top = r.bottom + menu.offsetHeight + 8 > innerHeight ? r.top - menu.offsetHeight - 6 : r.bottom + 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
function closeMenu() { menu.classList.add('hidden'); }
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) closeMenu(); });
$('.scroll').addEventListener('scroll', closeMenu);

function toggleFav(id) {
  favs.has(id) ? favs.delete(id) : favs.add(id);
  store.set('favs', [...favs]);
  renderLibrary();
  renderQuick();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ---------- Ao Vivo: conexão ----------
let mode = 'sim';
$$('#mode button').forEach((b) => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  $$('#mode button').forEach((x) => x.classList.toggle('active', x === b));
  $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== mode));
}));

$$('#rate button').forEach((b) => b.addEventListener('click', () => {
  rate = b.dataset.rate;
  $$('#rate button').forEach((x) => x.classList.toggle('active', x === b));
  window.live.setRate(rate);
}));

$('#sim-toggle').addEventListener('click', () => {
  if (current.mode === 'sim' && current.state === 'connected') window.live.stop();
  else window.live.startSim(rate);
});

$('#tt-toggle').addEventListener('click', () => {
  if (current.mode === 'tiktok' && (current.state === 'connected' || current.state === 'connecting')) return window.live.stop();
  const user = $('#username').value.trim().replace(/^@/, '');
  if (!user) return $('#username').focus();
  store.set('tiktokUser', user);
  window.live.connect(user);
});
$('#username').value = store.get('tiktokUser', '');
$('#username').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#tt-toggle').click(); });

function renderStatus(s) {
  current = s;
  const cls = `${s.state}${s.mode === 'sim' ? ' sim' : ''}`;
  for (const id of ['#side-status', '#live-status']) $(id).className = `${id.slice(1)} ${cls}`;
  $('#side-status-text').textContent = s.state === 'connected' ? (s.mode === 'sim' ? 'Simulação ativa' : 'Ao vivo') : s.detail || 'Desconectado';
  $('#live-status-text').textContent = s.detail || s.state;
  $('#nav-dot').className = `nav-dot${s.state === 'connected' ? (s.mode === 'sim' ? ' sim' : ' on') : ''}`;

  const simOn = s.mode === 'sim' && s.state === 'connected';
  $('#sim-toggle').textContent = simOn ? 'Parar simulação' : 'Iniciar simulação';
  $('#sim-toggle').classList.toggle('on', simOn);
  const ttOn = s.mode === 'tiktok' && (s.state === 'connected' || s.state === 'connecting');
  $('#tt-toggle').textContent = ttOn ? 'Desconectar' : 'Conectar';
  $('#tt-toggle').classList.toggle('on', ttOn);

  const user = store.get('tiktokUser', '');
  $('#avatar').textContent = s.mode === 'tiktok' && user ? user[0].toUpperCase() : s.mode === 'sim' ? 'S' : '?';
}

window.live.onClients((n) => { $('#clients').textContent = String(n); });

// ---------- Ao Vivo: feed ----------
const ICONS = { comment: '💬', gift: '🎁', like: '❤️', follow: '⭐', share: '🔁', join: '👋' };
const MAX_FEED = 150;

function describe(e) {
  switch (e.type) {
    case 'comment': return e.text;
    case 'gift': return `${e.gift.emoji || ''} ${e.gift.name} ×${e.gift.count} (${e.gift.coins * e.gift.count} 🪙)`;
    case 'like': return `curtiu ×${e.count}`;
    case 'follow': return 'começou a seguir';
    case 'share': return 'compartilhou a live';
    default: return e.type;
  }
}

function addFeed(e) {
  if (e.type === 'join') return; // muito ruído em live real
  const feed = $('#feed');
  feed.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  li.className = e.type;
  li.innerHTML = `<span class="ico">${ICONS[e.type] || '•'}</span><span class="who"></span><span class="what"></span>`;
  li.querySelector('.who').textContent = e.user?.nickname || '?';
  li.querySelector('.what').textContent = describe(e);
  feed.prepend(li);
  while (feed.children.length > MAX_FEED) feed.lastChild.remove();
}

function bump(e) {
  if (e.type === 'comment') stats.comment++;
  if (e.type === 'gift') { stats.gift += e.gift.count; stats.coins += e.gift.coins * e.gift.count; }
  if (e.type === 'like') stats.like += e.count || 1;
  for (const k of Object.keys(stats)) $(`#st-${k}`).textContent = stats[k].toLocaleString('pt-BR');
}

function resetFeed() { $('#feed').innerHTML = '<li class="empty">Os eventos da live aparecem aqui</li>'; }
$('#clear-feed').addEventListener('click', resetFeed);

window.live.onEvent((e) => { addFeed(e); bump(e); });
window.live.onStatus(renderStatus);

// ---------- Ao Vivo: eventos de teste ----------
let GIFTS = [];
function testUser() {
  const id = $('#t-user').value.trim() || 'teste';
  return { id, nickname: id };
}
$('#t-send-comment').addEventListener('click', () => {
  const text = $('#t-comment').value.trim();
  if (!text) return $('#t-comment').focus();
  window.live.inject({ type: 'comment', user: testUser(), text });
});
$('#t-comment').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#t-send-comment').click(); });
$('#t-send-gift').addEventListener('click', () => {
  const g = GIFTS[$('#t-gift').selectedIndex];
  const count = Math.max(1, Math.min(99, parseInt($('#t-count').value, 10) || 1));
  window.live.inject({ type: 'gift', user: testUser(), gift: { name: g.name, coins: g.coins, count, emoji: g.emoji } });
});

// ---------- Início ----------
(async () => {
  GIFTS = await window.live.gifts();
  $('#t-gift').innerHTML = GIFTS.map((g) => `<option>${g.emoji} ${g.name} — ${g.coins} 🪙</option>`).join('');
  resetFeed();
  setView(ui.view);
  renderStatus(await window.live.status());
  await loadGames();
})();
