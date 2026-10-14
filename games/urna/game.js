// Urna Interativa — disputa entre 2 candidatos para TikTok LIVE (palco fixo 1080×1920)
const W = 1080, H = 1920;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const stage = $('#stage');
let scale = 1;

function fit() {
  scale = Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `translate(${(innerWidth - W * scale) / 2}px, ${(innerHeight - H * scale) / 2}px) scale(${scale})`;
}
addEventListener('resize', fit);
fit();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Math.round(n).toLocaleString('pt-BR');
const short = (s, max = 18) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// ---------- Configuração e estado (salvos neste computador) ----------
const SILHOUETTE = '<svg viewBox="0 0 100 110"><circle cx="50" cy="36" r="22"/><path d="M6 110c0-27 20-43 44-43s44 16 44 43z"/></svg>';
// Mão: foto recortada (mao.png, 240×558) + manga que continua o braço até fora da tela
const HAND = '<div class="hand-inner"><img src="mao.png" alt="" draggable="false"><div class="sleeve"></div></div>';
const TIP = { x: 50, y: 1 }; // ponta do dedo (mao.png exibida a 60%, ver .hand no CSS)

// Rosa branca → 22 e rosa vermelha → 13, como nos selos "Voto no..." da tela
const GIFT_TABLE = [
  // nomes do simulador e da live em português
  ['Rosa Branca', '🤍', 1, 0], ['Rosa', '🌹', 1, 1], ['Coração', '💖', 5, 0], ['GG', '🎮', 1, 1],
  ['Rosquinha', '🍩', 30, 0], ['Perfume', '🧴', 20, 1], ['Galáxia', '🌌', 1000, 0], ['Mãos de Coração', '🫶', 100, 1], ['Leão', '🦁', 29999, 0],
  // nomes como a API do TikTok costuma enviar
  ['White Rose', '🤍', 1, 0], ['Rose', '🌹', 1, 1], ['Finger Heart', '💖', 5, 0], ['TikTok', '🎵', 1, 1],
  ['Doughnut', '🍩', 30, 0], ['Ice Cream Cone', '🍦', 1, 1], ['Galaxy', '🌌', 1000, 0], ['Hand Hearts', '🫶', 100, 1], ['Lion', '🦁', 29999, 0],
];
const defaultGifts = () => GIFT_TABLE.map(([name, emoji, coins, cand]) => ({ name, emoji, coins, cand, points: coins, on: true }));

const DEFAULT_CFG = {
  candidates: [
    { name: 'Bolsonaro', number: '22', color: '#1e6fd9', photo: null },
    { name: 'Lula', number: '13', color: '#e0262f', photo: null },
  ],
  gifts: defaultGifts(),
  roundMinutes: 5,
  commentVote: true,
  cooldown: 3,
  hands: true,
  tester: 'teste_painel',
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem espaço ou sem storage */ }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const freshState = () => ({ points: [0, 0], gifts: [0, 0], sup: [{}, {}], last: [null, null], roundEndsAt: null });

let cfg = { ...clone(DEFAULT_CFG), ...load('urna2.cfg', {}) };

// Configurações salvas antes das rosas: rosa vermelha passa para o 13 e a branca entra para o 22
if (!cfg.rosesV1) {
  for (const g of cfg.gifts) if (/^(rosa|rose)$/i.test(g.name.trim())) g.cand = 1;
  for (const [name, emoji] of [['Rosa Branca', '🤍'], ['White Rose', '🤍']]) {
    const g = findGift(cfg.gifts, name);
    if (g) g.cand = 0;
    else cfg.gifts.unshift({ name, emoji, coins: 1, cand: 0, points: 1, on: true });
  }
  cfg.rosesV1 = true;
  save('urna2.cfg', cfg);
}
let st = { ...freshState(), ...load('urna2.state', {}) };
const choice = new Map();   // usuário → candidato escolhido comentando o número
const lastVote = new Map(); // usuário → horário do último ponto por comentário
const shown = [0, 0];       // pontos exibidos (animados até o valor real)
let paused = false;

let saveTimer;
function saveState() { clearTimeout(saveTimer); saveTimer = setTimeout(() => save('urna2.state', st), 600); }
function findGift(list, name) {
  const n = (name || '').trim().toLowerCase();
  return list.find((g) => g.name.trim().toLowerCase() === n);
}

// ---------- Montagem ----------
let cards = [];
let urnas = [];

// Fotos da pasta fotos/ (ex.: fotos/13.jpg) valem quando o painel não tem foto escolhida
const filePhotos = {};
function probePhoto(number) {
  if (number in filePhotos) return Promise.resolve();
  filePhotos[number] = null;
  const exts = ['jpg', 'jpeg', 'png', 'webp'];
  return exts.reduce((p, ext) => p.then(() => filePhotos[number] || new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { filePhotos[number] = img.src; resolve(); };
    img.onerror = () => resolve();
    img.src = `fotos/${encodeURIComponent(number)}.${ext}`;
  })), Promise.resolve());
}
const photoOf = (c) => c.photo || filePhotos[c.number] || null;

function paintPhoto(el, c) {
  el.style.setProperty('--c', c.color);
  const url = photoOf(c);
  if (url) { el.style.backgroundImage = `url("${url}")`; el.innerHTML = ''; }
  else { el.style.backgroundImage = ''; el.innerHTML = SILHOUETTE; }
}

function build() {
  $('#clock').classList.toggle('hidden', cfg.roundMinutes <= 0);
  // Selos "Voto no..." por número: img/voto-22.png, img/voto-13.png
  cfg.candidates.forEach((c, i) => {
    const img = $(`#badge-${i}`);
    img.classList.remove('missing');
    img.onerror = () => img.classList.add('missing');
    img.src = `img/voto-${encodeURIComponent(c.number)}.png`;
  });

  $('#cards').innerHTML = '';
  cards = cfg.candidates.map((c) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.setProperty('--c', c.color);
    el.innerHTML = `
      <div class="card-head"><span class="card-num"></span><span class="chip">EMPATE</span></div>
      <div class="card-body">
        <div class="points">0</div><div class="points-lbl">PONTOS</div>
        <div class="progress"><i></i></div>
        <div class="card-row"><span class="pct">0%</span><span class="ngifts">🎁 0 presentes</span></div>
        <div class="last"></div>
        <div class="king"></div>
      </div>`;
    $('.card-num', el).textContent = c.number;
    $('#cards').appendChild(el);
    return {
      el, chip: $('.chip', el), points: $('.points', el), bar: $('.progress i', el),
      pct: $('.pct', el), ngifts: $('.ngifts', el), last: $('.last', el), king: $('.king', el), body: $('.card-body', el),
    };
  });

  $('#urnas').innerHTML = '';
  urnas = cfg.candidates.map((c, i) => {
    const wrap = document.createElement('div');
    wrap.className = `urna-wrap${i === 1 ? ' mirror' : ''}`;
    wrap.style.setProperty('--c', c.color);
    wrap.innerHTML = `
      <div class="urna">
        <img class="urna-img" src="img/urna.png" alt="" draggable="false">
        <div class="screen"></div>
        ${Object.entries(URNA_KEYS).map(([k, [x, y]]) => `<div class="key" data-k="${k}" style="${hotspot(x, y, 84, 58)}"></div>`).join('')}
        ${Object.entries(URNA_ACTS).map(([k, [x, y]]) => `<div class="act ${k}" style="${hotspot(x, y, 104, 62)}"></div>`).join('')}
      </div>
      <div class="hand${cfg.hands ? '' : ' off'}">${HAND}</div>`;
    $('#urnas').appendChild(wrap);
    const u = { wrap, screen: $('.screen', wrap), hand: $('.hand', wrap), pending: 0, running: false, i };
    screenIdle(u);
    return u;
  });
  requestAnimationFrame(() => urnas.forEach(handRest));
  render();
}

// ---------- Imagem da urna (img/urna.png = original 1744×711 recortada em x 263, 1481×708) ----------
// Centro de cada tecla na imagem original; as áreas viram % do recorte para valer em qualquer tamanho
const URNA_IMG = { x0: 263, w: 1481, h: 708 };
const URNA_KEYS = {
  1: [1335, 222], 2: [1438, 222], 3: [1540, 222],
  4: [1340, 290], 5: [1442, 290], 6: [1545, 290],
  7: [1345, 360], 8: [1447, 360], 9: [1550, 360],
  0: [1452, 432],
};
const URNA_ACTS = { branco: [1337, 527], corrige: [1457, 527], confirma: [1578, 522] };
function hotspot(cx, cy, w, h) {
  const p = (v, total) => `${((v / total) * 100).toFixed(3)}%`;
  return `left:${p(cx - URNA_IMG.x0 - w / 2, URNA_IMG.w)};top:${p(cy - h / 2, URNA_IMG.h)};width:${p(w, URNA_IMG.w)};height:${p(h, URNA_IMG.h)}`;
}

// ---------- Telas da urna ----------
// Tela parada: só a foto grande e o número, como na urna de referência
function screenIdle(u) {
  const c = cfg.candidates[u.i];
  u.screen.innerHTML = '<div class="scr scr-idle"><div class="photo"></div><div class="scr-num"></div></div>';
  paintPhoto($('.photo', u.screen), c);
  $('.scr-num', u.screen).textContent = c.number;
}

function screenTyping(u, typed) {
  const n = cfg.candidates[u.i].number.length;
  const boxes = Array.from({ length: n }, (_, k) =>
    `<div class="digit${k === typed.length ? ' cur' : ''}">${typed[k] || ''}</div>`).join('');
  u.screen.innerHTML = `<div class="scr"><div class="scr-top">SEU VOTO PARA</div><div class="digits">${boxes}</div>
    <div class="scr-hint">Número: digite o número do candidato</div></div>`;
}

function screenFim(u) {
  u.screen.innerHTML = '<div class="scr scr-fim"><b>FIM</b><small>VOTOU</small></div>';
}

// ---------- Mãozinha ----------
function localPos(u, el) {
  const a = el.getBoundingClientRect();
  const b = u.wrap.getBoundingClientRect();
  return { x: (a.left + a.width / 2 - b.left) / scale, y: (a.top + a.height / 2 - b.top) / scale };
}
function handTo(u, x, y) { u.hand.style.transform = `translate(${x - TIP.x}px, ${y - TIP.y}px)`; }
function handRest(u) {
  const p = localPos(u, $('.key[data-k="5"]', u.wrap));
  handTo(u, p.x + 10, u.wrap.offsetHeight + 30);
}

// Tempos da animação do voto (ms)
const T = { move: 400, press: 210, afterKey: 190, beforeConfirm: 450, fim: 1200, rest: 500 };

async function press(u, el) {
  if (cfg.hands) {
    const p = localPos(u, el);
    handTo(u, p.x, p.y);
    await wait(T.move);
    u.hand.classList.add('press');
  }
  el.classList.add('down');
  await wait(T.press);
  el.classList.remove('down');
  u.hand.classList.remove('press');
}

async function voteAnimation(u) {
  u.running = true;
  while (u.pending > 0) {
    u.pending--;
    const num = cfg.candidates[u.i].number;
    let typed = '';
    screenTyping(u, typed);
    for (const d of num) {
      await press(u, $(`.key[data-k="${d}"]`, u.wrap));
      typed += d;
      screenTyping(u, typed);
      await wait(T.afterKey);
    }
    screenIdle(u);
    await wait(T.beforeConfirm);
    await press(u, $('.act.confirma', u.wrap));
    screenFim(u);
    if (cfg.hands) handRest(u);
    await wait(T.fim);
    screenIdle(u);
    await wait(T.rest);
  }
  u.running = false;
}

function enqueueVote(i) {
  const u = urnas[i];
  if (!u) return;
  // No máximo uma animação esperando: com muitos votos a urna não fica atrasada
  u.pending = 1;
  if (!u.running) voteAnimation(u);
}

// ---------- Placar ----------
function render() {
  const [a, b] = st.points;
  const total = a + b;
  $('#sum-total').textContent = fmt(total);
  $('#sum-diff').textContent = fmt(Math.abs(a - b));
  const lead = a === b ? -1 : a > b ? 0 : 1;
  const status = $('#sum-status');
  status.textContent = lead < 0 ? 'EMPATE' : `${cfg.candidates[lead].number} NA FRENTE`;
  status.style.background = lead < 0 ? '' : cfg.candidates[lead].color;

  cards.forEach((c, i) => {
    const pct = total ? (st.points[i] / total) * 100 : 0;
    c.chip.textContent = lead < 0 ? 'EMPATE' : lead === i ? '👑 NA FRENTE' : 'ATRÁS';
    c.el.classList.toggle('lead', lead === i);
    c.bar.style.width = `${total ? pct : 50}%`;
    c.pct.textContent = `${pct.toFixed(1).replace('.', ',')}%`;
    c.ngifts.textContent = `🎁 ${fmt(st.gifts[i])} ${st.gifts[i] === 1 ? 'presente' : 'presentes'}`;
    const l = st.last[i];
    c.last.innerHTML = '';
    if (l) {
      if (l.test) c.last.insertAdjacentHTML('beforeend', '<b>TESTE</b>');
      c.last.append(`@${short(l.user, 16)} • ${l.label} • +${fmt(l.pts)} ${l.pts === 1 ? 'ponto' : 'pontos'}`);
    }
    const top = Object.values(st.sup[i]).sort((x, y) => y.pts - x.pts)[0];
    c.king.textContent = top ? `👑 @${short(top.name, 18)} · ${fmt(top.pts)}` : '';
  });
}

function addPoints(i, pts, user, label, giftCount, test = false) {
  if (paused || i < 0 || i > 1) return;
  st.points[i] += pts;
  st.gifts[i] += giftCount;
  const name = user.nickname || user.id;
  const s = st.sup[i][user.id] || (st.sup[i][user.id] = { name, pts: 0 });
  s.pts += pts;
  s.name = name;
  st.last[i] = { user: name, label, pts, test };
  if (cfg.roundMinutes > 0 && !st.roundEndsAt) st.roundEndsAt = Date.now() + cfg.roundMinutes * 60000;

  const c = cards[i];
  c.el.classList.remove('bump'); void c.el.offsetWidth; c.el.classList.add('bump');
  const plus = document.createElement('div');
  plus.className = 'plus';
  plus.textContent = `+${fmt(pts)}`;
  c.body.appendChild(plus);
  setTimeout(() => plus.remove(), 1200);
  if (pts >= 100) {
    const r = c.el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    burst(cfg.candidates[i].color, (r.left + r.width / 2 - sr.left) / scale, (r.top + 140 - sr.top) / scale, Math.min(140, 40 + pts / 20));
  }
  if (test) showTestBadge();
  enqueueVote(i);
  render();
  saveState();
}

// ---------- Eventos da live ----------
function onLive(e) {
  const user = e.user || { id: 'anon', nickname: 'anônimo' };

  if (e.type === 'comment') {
    const nums = (e.text || '').match(/\d{1,3}/g) || [];
    const i = cfg.candidates.findIndex((c) => nums.includes(c.number));
    if (i < 0) return;
    choice.set(user.id, i);
    if (!cfg.commentVote) return;
    const now = Date.now();
    if (now - (lastVote.get(user.id) || 0) < cfg.cooldown * 1000) return;
    lastVote.set(user.id, now);
    addPoints(i, 1, user, 'comentário', 0);
    return;
  }

  if (e.type === 'gift') {
    const count = e.gift.count || 1;
    let g = findGift(cfg.gifts, e.gift.name);
    if (!g) {
      // Presente novo: entra na lista sem candidato, para o streamer configurar
      g = { name: e.gift.name, emoji: e.gift.emoji || '🎁', coins: e.gift.coins || 1, cand: -1, points: e.gift.coins || 1, on: true, auto: true };
      cfg.gifts.push(g);
      save('urna2.cfg', cfg);
    }
    if (!g.on) return;
    const i = g.cand >= 0 ? g.cand : (choice.get(user.id) ?? -1);
    addPoints(i, Math.max(1, g.points) * count, user, `${g.name}${count > 1 ? ` ×${count}` : ''}`, count);
  }
}

let testTimer;
function showTestBadge() {
  $('#test-badge').classList.remove('hidden');
  clearTimeout(testTimer);
  testTimer = setTimeout(() => $('#test-badge').classList.add('hidden'), 5000);
}

// ---------- Rodada ----------
function clockText(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function tick() {
  if (cfg.roundMinutes <= 0 || paused) return;
  const left = st.roundEndsAt ? Math.max(0, st.roundEndsAt - Date.now()) : cfg.roundMinutes * 60000;
  $('#clock').textContent = clockText(left);
  $('#clock').classList.toggle('low', !!st.roundEndsAt && left <= 30000);
  if (st.roundEndsAt && left <= 0) endRound();
}
setInterval(tick, 250);

function endRound() {
  const [a, b] = st.points;
  paused = true;
  if (a === b) {
    // Empate: prorrogação de 30 segundos
    st.roundEndsAt = Date.now() + 30000;
    paused = false;
    return;
  }
  const i = a > b ? 0 : 1;
  const c = cfg.candidates[i];
  $('#winner-num').textContent = c.number;
  $('#winner-name').textContent = c.name;
  $('#winner-votes').textContent = `${fmt(st.points[i])} pontos · ${((st.points[i] / (a + b)) * 100).toFixed(1).replace('.', ',')}%`;
  $('.winner-card').style.setProperty('--c', c.color);
  paintPhoto($('#winner-photo'), c);
  $('#winner').classList.remove('hidden');
  for (let k = 0; k < 4; k++) setTimeout(() => burst(c.color, W / 2, 700, 120), k * 600);
  setTimeout(() => {
    $('#winner').classList.add('hidden');
    resetVotes();
    paused = false;
  }, 12000);
}

function resetVotes() {
  st = freshState();
  shown[0] = shown[1] = 0;
  choice.clear();
  save('urna2.state', st);
  render();
  tick();
}

// ---------- Confete + contagem animada ----------
const fx = $('#fx').getContext('2d');
let parts = [];
function burst(color, x, y, n) {
  const palette = [color, '#ffd23f', '#ffffff'];
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const v = 300 + Math.random() * 700;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 400, r: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
      s: 10 + Math.random() * 12, c: palette[k % 3], t: 2.2 });
  }
}
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  cards.forEach((c, i) => {
    if (shown[i] === st.points[i]) return;
    shown[i] += (st.points[i] - shown[i]) * Math.min(1, dt * 8);
    if (Math.abs(st.points[i] - shown[i]) < 0.5) shown[i] = st.points[i];
    c.points.textContent = fmt(shown[i]);
  });
  fx.clearRect(0, 0, W, H);
  for (const p of parts) {
    p.t -= dt; p.vy += 1100 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
    fx.globalAlpha = Math.min(1, p.t);
    fx.save(); fx.translate(p.x, p.y); fx.rotate(p.r);
    fx.fillStyle = p.c; fx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    fx.restore();
  }
  fx.globalAlpha = 1;
  parts = parts.filter((p) => p.t > 0 && p.y < H + 50);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Painel de configuração ----------
let draft = null;
let giftFilter = 'all';

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = 300; cv.height = 400;
      const s = Math.max(300 / img.width, 400 / img.height);
      const w = img.width * s, h = img.height * s;
      cv.getContext('2d').drawImage(img, (300 - w) / 2, (400 - h) / 2, w, h);
      URL.revokeObjectURL(img.src);
      resolve(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function renderCandsPane() {
  const pane = $('#pane-cands');
  pane.innerHTML = '';
  draft.candidates.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'cand-row';
    row.style.setProperty('--c', c.color);
    row.innerHTML = `
      <div class="cand-photo" title="Clique para escolher a foto (botão direito remove)"></div>
      <div class="cand-fields">
        <label class="field">Nome <input data-f="name" maxlength="28"></label>
        <label class="field">Número <input data-f="number" maxlength="3" inputmode="numeric"></label>
        <label class="field">Cor <input type="color" data-f="color"></label>
        <div class="cand-tip">Clique na foto para trocar (botão direito remove). Ou salve o arquivo como games/urna/fotos/NÚMERO.jpg</div>
      </div>
      <input type="file" accept="image/*" hidden>`;
    const ph = $('.cand-photo', row);
    const paint = () => {
      row.style.setProperty('--c', c.color);
      const url = photoOf(c);
      ph.style.backgroundImage = url ? `url("${url}")` : '';
      ph.textContent = url ? '' : 'Escolher foto';
    };
    paint();
    for (const inp of $$('[data-f]', row)) {
      inp.value = c[inp.dataset.f];
      inp.addEventListener('input', () => { c[inp.dataset.f] = inp.value; paint(); });
    }
    const file = $('input[type=file]', row);
    ph.addEventListener('click', () => file.click());
    ph.addEventListener('contextmenu', (ev) => { ev.preventDefault(); c.photo = null; paint(); });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try { c.photo = await resizePhoto(file.files[0]); paint(); } catch { alert('Não consegui abrir essa imagem.'); }
    });
    pane.appendChild(row);
  });
}

function renderGiftFilter() {
  const opts = [['all', 'Todos'], ['0', draft.candidates[0].number || 'A'], ['1', draft.candidates[1].number || 'B'], ['none', 'Sem candidato'], ['off', 'Desligados']];
  const box = $('#gift-filter');
  box.innerHTML = '';
  for (const [k, label] of opts) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = giftFilter === k ? 'on' : '';
    b.addEventListener('click', () => { giftFilter = k; renderGiftFilter(); renderGiftList(); });
    box.appendChild(b);
  }
}

function renderGiftList() {
  const q = $('#gift-search').value.trim().toLowerCase();
  const list = draft.gifts.filter((g) => {
    if (q && !g.name.toLowerCase().includes(q)) return false;
    if (giftFilter === 'off') return !g.on;
    if (giftFilter === 'none') return g.cand < 0;
    if (giftFilter === '0' || giftFilter === '1') return g.cand === Number(giftFilter);
    return true;
  });
  const box = $('#gift-list');
  box.innerHTML = list.length ? '' : '<div class="empty-list">Nenhum presente aqui.</div>';
  $('#gift-count').textContent = String(draft.gifts.length);

  for (const g of list) {
    const row = document.createElement('div');
    row.className = `gift${g.on ? '' : ' off'}`;
    row.style.borderLeftColor = g.cand >= 0 ? draft.candidates[g.cand].color : '#44444c';
    row.innerHTML = `
      <div class="gift-emo"></div>
      <div class="gift-name"><span></span><small></small></div>
      <div class="to">PARA ${draft.candidates.map((c, i) => `<button data-i="${i}"></button>`).join('')}</div>
      <label class="pts">PONTOS <input type="number" min="1"></label>
      <button class="toggle" title="Ligar/desligar"></button>
      <button class="btn green sm" data-act="test">TESTAR</button>
      <button class="x" data-act="del" title="Remover">✕</button>`;
    $('.gift-emo', row).textContent = g.emoji || '🎁';
    $('.gift-name span', row).textContent = g.name;
    $('.gift-name small', row).textContent = `${g.coins} ${g.coins === 1 ? 'moeda' : 'moedas'}${g.auto ? ' · detectado na live' : ''}`;
    $$('.to button', row).forEach((b) => {
      const i = Number(b.dataset.i);
      b.textContent = draft.candidates[i].number;
      if (g.cand === i) { b.classList.add('on'); b.style.background = draft.candidates[i].color; }
      b.addEventListener('click', () => { g.cand = g.cand === i ? -1 : i; renderGiftList(); });
    });
    const pts = $('.pts input', row);
    pts.value = g.points;
    pts.addEventListener('input', () => { g.points = Math.max(1, Number(pts.value) || 1); });
    const tg = $('.toggle', row);
    tg.classList.toggle('on', g.on);
    tg.addEventListener('click', () => { g.on = !g.on; renderGiftList(); });
    $('[data-act=test]', row).addEventListener('click', () => {
      if (g.cand < 0) { alert('Escolha para qual candidato vai este presente.'); return; }
      const tester = $('#cfg-tester').value.trim() || 'teste_painel';
      addPoints(g.cand, Math.max(1, g.points), { id: `__${tester}`, nickname: tester }, g.name, 1, true);
    });
    $('[data-act=del]', row).addEventListener('click', () => { draft.gifts.splice(draft.gifts.indexOf(g), 1); renderGiftList(); });
    box.appendChild(row);
  }
}

function setTab(tab) {
  $$('#cfg-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
  if (tab === 'gifts') { renderGiftFilter(); renderGiftList(); }
}
$$('#cfg-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#gift-search').addEventListener('input', renderGiftList);
$('#gift-add').addEventListener('click', () => {
  const name = $('#gift-new').value.trim();
  if (!name) return $('#gift-new').focus();
  if (findGift(draft.gifts, name)) { alert('Esse presente já está na lista.'); return; }
  const coins = Math.max(1, Number($('#gift-new-coins').value) || 1);
  draft.gifts.unshift({ name, emoji: '🎁', coins, cand: -1, points: coins, on: true });
  $('#gift-new').value = '';
  giftFilter = 'all';
  renderGiftFilter();
  renderGiftList();
});
$('#gift-defaults').addEventListener('click', () => {
  if (!confirm('Voltar a lista de presentes para o padrão?')) return;
  draft.gifts = defaultGifts();
  renderGiftList();
});

function openConfig() {
  draft = clone(cfg);
  $('#cfg-round').value = draft.roundMinutes;
  $('#cfg-tester').value = draft.tester;
  $('#cfg-comment').checked = draft.commentVote;
  $('#cfg-cooldown').value = draft.cooldown;
  $('#cfg-hands').checked = draft.hands;
  renderCandsPane();
  $('#gift-count').textContent = String(draft.gifts.length);
  setTab('cands');
  $('#config').classList.remove('hidden');
}
function closeConfig() { $('#config').classList.add('hidden'); draft = null; }

$('#gear').addEventListener('click', openConfig);
$('#cfg-close').addEventListener('click', closeConfig);
$('#cfg-cancel').addEventListener('click', closeConfig);
$('#cfg-reset').addEventListener('click', () => { if (confirm('Zerar o placar e o cronômetro?')) resetVotes(); });
$('#cfg-save').addEventListener('click', () => {
  for (const c of draft.candidates) { c.name = c.name.trim() || 'Candidato'; c.number = c.number.replace(/\D/g, ''); }
  const [n0, n1] = draft.candidates.map((c) => c.number);
  if (!n0 || !n1 || n0 === n1) { setTab('cands'); alert('Os dois candidatos precisam de números diferentes.'); return; }
  const newRound = Math.max(0, Number($('#cfg-round').value) || 0);
  if (newRound !== draft.roundMinutes) st.roundEndsAt = null;
  draft.roundMinutes = newRound;
  draft.tester = $('#cfg-tester').value.trim() || 'teste_painel';
  draft.commentVote = $('#cfg-comment').checked;
  draft.cooldown = Math.max(0, Number($('#cfg-cooldown').value) || 0);
  draft.hands = $('#cfg-hands').checked;
  // presentes detectados na live enquanto o painel estava aberto
  for (const g of cfg.gifts) if (!findGift(draft.gifts, g.name)) draft.gifts.push(g);
  cfg = draft;
  save('urna2.cfg', cfg);
  saveState();
  closeConfig();
  build();
  tick();
  Promise.all(cfg.candidates.map((c) => probePhoto(c.number))).then(build);
});
addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT') return;
  if (ev.key.toLowerCase() === 'c') ($('#config').classList.contains('hidden') ? openConfig() : closeConfig());
  if (ev.key === 'Escape') closeConfig();
});

// ---------- Conexão com o launcher ----------
function setConn(ok, status) {
  const el = $('#conn');
  const live = ok && status?.state === 'connected';
  el.className = `conn ${!ok ? '' : live ? (status.mode === 'sim' ? 'sim' : 'live') : 'wait'}`;
  $('b', el).textContent = !ok ? 'SEM LAUNCHER' : live ? (status.mode === 'sim' ? 'SIMULAÇÃO' : 'AO VIVO') : 'SEM LIVE';
}
let lastStatus = null;
function connect() {
  const ws = new WebSocket(`ws://${location.host || 'localhost:21213'}`);
  ws.onopen = () => setConn(true, lastStatus);
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'status') { lastStatus = e.status; setConn(true, e.status); } else onLive(e);
  };
  ws.onclose = () => { setConn(false); setTimeout(connect, 2000); };
}

// Sem o arquivo do logo, mostra o título em texto
function logoFallback() { $('#logo').classList.add('hidden'); $('#title').classList.remove('hidden'); }
$('#logo').onerror = logoFallback;
if ($('#logo').complete && !$('#logo').naturalWidth) logoFallback();

build();
tick();
connect();
Promise.all(cfg.candidates.map((c) => probePhoto(c.number))).then(build);
