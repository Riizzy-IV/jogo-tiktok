// Corrida Maluca — jogo interativo para TikTok LIVE (resolução fixa 1080×1920, escalada para a janela)
const W = 1080, H = 1920;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
cv.width = W; cv.height = H;
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  cv.style.width = `${W * s}px`;
  cv.style.height = `${H * s}px`;
}
addEventListener('resize', fit);
fit();

const CFG = {
  maxRacers: 10,
  lobbySeconds: 15,      // tempo de espera após o primeiro inscrito
  fullLobbySeconds: 5,   // tempo de espera quando a pista lota
  countdown: 3,
  raceSeconds: 30,       // duração aproximada de uma corrida sem turbo
  finishGrace: 6,        // segundos após o vencedor até encerrar
  podiumSeconds: 8,
  bigGiftCoins: 100,     // a partir daqui o presente solta um raio no líder
  maxBoost: 15,          // turbo acumulado máximo (s), para ninguém vencer sozinho
};
const addBoost = (holder, secs) => { holder.boost = Math.min(CFG.maxBoost, (holder.boost || 0) + secs); };
const TRACK = { top: 300, laneH: 112, startX: 170, finishX: 990 };
const COLORS = ['#fe2c55', '#25f4ee', '#ffd23f', '#3ddc84', '#b06cff', '#ff8a3d', '#4d9dff', '#ff5ec4', '#c6ff4d', '#ffffff'];
const FONT = '"Segoe UI", system-ui, sans-serif';

let phase = 'lobby';   // lobby | countdown | racing | podium
let timer = 0;
let raceTime = 0;
let firstFinishAt = null;
let place = 0;
let racers = [];
let queue = [];
let feed = [];
let popups = [];
let particles = [];
let results = [];
let shake = 0;
let conn = { mode: 'none', state: 'disconnected' };
let wsOk = false;
let wins = loadWins();

// ---------- Persistência do ranking ----------
function loadWins() {
  try { return JSON.parse(localStorage.getItem('corrida.wins')) || {}; } catch { return {}; }
}
function saveWins() {
  try { localStorage.setItem('corrida.wins', JSON.stringify(wins)); } catch { /* sem storage */ }
}

// ---------- Utilidades ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function short(name, max = 14) { return name.length > max ? `${name.slice(0, max - 1)}…` : name; }
function laneY(lane) { return TRACK.top + lane * TRACK.laneH; }
function racerX(r) { return TRACK.startX + r.x * (TRACK.finishX - TRACK.startX); }
function pushFeed(text, color = '#e8ecf5') {
  feed.unshift({ text, color });
  feed.length = Math.min(feed.length, 6);
}
function popup(r, text, color) {
  popups.push({ x: racerX(r), y: laneY(r.lane) + 30, text, color, ttl: 1.6 });
}

// ---------- Inscrição ----------
function makeRacer(entry, lane) {
  return {
    id: entry.id, name: entry.name, type: entry.type, lane,
    color: COLORS[lane % COLORS.length],
    x: 0, base: 0.9 + Math.random() * 0.2, phaseOff: Math.random() * 10,
    boost: entry.bank || 0, stun: 0, done: false, rank: 0,
  };
}

function addEntrant(user, type, bank = 0) {
  const id = user.id;
  const name = user.nickname || id;
  const inRace = racers.find((r) => r.id === id);
  if (inRace) {
    if (phase === 'lobby' && inRace.type !== type) { inRace.type = type; pushFeed(`${short(name)} trocou para ${type}`); }
    addBoost(inRace, bank);
    return;
  }
  const queued = queue.find((q) => q.id === id);
  if (queued) { queued.bank = Math.min(CFG.maxBoost, queued.bank + bank); return; }

  if (phase === 'lobby' && racers.length < CFG.maxRacers) {
    racers.push(makeRacer({ id, name, type, bank }, racers.length));
    if (racers.length === 1) timer = CFG.lobbySeconds;
    if (racers.length === CFG.maxRacers) timer = Math.min(timer, CFG.fullLobbySeconds);
    pushFeed(`🏁 ${short(name)} entrou de ${type}`, '#25f4ee');
  } else {
    queue.push({ id, name, type, bank });
    pushFeed(`⏳ ${short(name)} está na fila`, '#8892a8');
  }
}

// ---------- Eventos da live ----------
function onLive(e) {
  const user = e.user || { id: 'anon', nickname: 'anônimo' };
  const name = user.nickname || user.id;
  const racer = racers.find((r) => r.id === user.id);

  if (e.type === 'comment') {
    const t = (e.text || '').toLowerCase();
    if (/\bmoto\b/.test(t)) addEntrant(user, 'moto');
    else if (/\bcarro\b/.test(t)) addEntrant(user, 'carro');
    return;
  }

  if (e.type === 'gift') {
    const coins = (e.gift.coins || 1) * (e.gift.count || 1);
    const secs = Math.min(10, 0.5 + 1.5 * Math.sqrt(coins));
    const label = `${e.gift.emoji || '🎁'} ${e.gift.name}${e.gift.count > 1 ? ` ×${e.gift.count}` : ''}`;

    if (racer) {
      addBoost(racer, secs);
      if (phase === 'racing') popup(racer, `TURBO +${secs.toFixed(1)}s`, '#ffd23f');
    } else {
      addEntrant(user, Math.random() < 0.5 ? 'carro' : 'moto', secs);
    }
    pushFeed(`${label} de ${short(name)} → turbo`, '#ff8aa1');

    if (coins >= CFG.bigGiftCoins && phase === 'racing') {
      const leader = racers.filter((r) => !r.done && r.id !== user.id).sort((a, b) => b.x - a.x)[0];
      if (leader) {
        leader.stun = 2.5;
        leader.boost = 0;
        shake = 0.5;
        popup(leader, '⚡ ATORDOADO!', '#25f4ee');
        pushFeed(`⚡ ${short(name)} soltou um raio em ${short(leader.name)}!`, '#25f4ee');
      }
    }
    return;
  }

  if (e.type === 'like' && racer && phase === 'racing') {
    addBoost(racer, Math.min(0.6, 0.04 * (e.count || 1)));
    return;
  }

  if (e.type === 'follow') pushFeed(`⭐ ${short(name)} começou a seguir`, '#ffd23f');
}

// ---------- Fases ----------
function startCountdown() { phase = 'countdown'; timer = CFG.countdown; }
function startRace() { phase = 'racing'; raceTime = 0; place = 0; firstFinishAt = null; }

function endRace() {
  const finished = racers.filter((r) => r.done).sort((a, b) => a.rank - b.rank);
  const rest = racers.filter((r) => !r.done).sort((a, b) => b.x - a.x);
  results = [...finished, ...rest];
  phase = 'podium';
  timer = CFG.podiumSeconds;
}

function resetLobby() {
  phase = 'lobby';
  racers = [];
  results = [];
  const next = queue.splice(0, CFG.maxRacers);
  next.forEach((q, i) => racers.push(makeRacer(q, i)));
  timer = racers.length >= CFG.maxRacers ? CFG.fullLobbySeconds : CFG.lobbySeconds;
}

// ---------- Simulação ----------
function update(dt) {
  if (phase === 'lobby') {
    if (racers.length > 0) { timer -= dt; if (timer <= 0) startCountdown(); }
  } else if (phase === 'countdown') {
    timer -= dt;
    if (timer <= 0) startRace();
  } else if (phase === 'racing') {
    raceTime += dt;
    for (const r of racers) {
      if (r.done) continue;
      let v;
      if (r.stun > 0) { r.stun -= dt; v = 0.1; }
      else {
        const wobble = r.type === 'moto' ? 0.4 * Math.sin(raceTime * 2.1 + r.phaseOff) : 0.22 * Math.sin(raceTime * 1.3 + r.phaseOff);
        v = r.base * (1 + wobble);
        if (r.boost > 0) {
          v *= 2.1;
          r.boost = Math.max(0, r.boost - dt);
          spawnExhaust(r);
        }
      }
      r.x += (v * dt) / CFG.raceSeconds;
      if (r.x >= 1) {
        r.x = 1;
        r.done = true;
        r.rank = ++place;
        if (r.rank === 1) {
          firstFinishAt = raceTime;
          wins[r.id] = { name: r.name, wins: (wins[r.id]?.wins || 0) + 1 };
          saveWins();
          pushFeed(`🏆 ${short(r.name)} venceu a corrida!`, '#ffd23f');
          for (let i = 0; i < 60; i++) spawnConfetti();
        }
      }
    }
    const allDone = racers.every((r) => r.done);
    if (allDone || (firstFinishAt !== null && raceTime - firstFinishAt > CFG.finishGrace)) endRace();
  } else if (phase === 'podium') {
    timer -= dt;
    if (Math.random() < 0.3) spawnConfetti();
    if (timer <= 0) resetLobby();
  }

  for (const p of popups) { p.ttl -= dt; p.y -= 40 * dt; }
  popups = popups.filter((p) => p.ttl > 0);
  for (const p of particles) { p.ttl -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.rot += p.vr * dt; }
  particles = particles.filter((p) => p.ttl > 0);
  shake = Math.max(0, shake - dt);
}

function spawnExhaust(r) {
  if (Math.random() > 0.6) return;
  particles.push({
    x: racerX(r) - 48, y: laneY(r.lane) + 74 + (Math.random() - 0.5) * 14,
    vx: -260 - Math.random() * 140, vy: (Math.random() - 0.5) * 40,
    ttl: 0.35, max: 0.35, size: 10 + Math.random() * 8, color: Math.random() < 0.5 ? '#ffd23f' : '#ff8a3d', rot: 0, vr: 0,
  });
}

function spawnConfetti() {
  particles.push({
    x: Math.random() * W, y: TRACK.top - 40, vx: (Math.random() - 0.5) * 200, vy: 200 + Math.random() * 300, g: 200,
    ttl: 3, max: 3, size: 12 + Math.random() * 10, color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, confetti: true,
  });
}

// ---------- Desenho ----------
function text(str, x, y, size, color = '#fff', align = 'left', weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); }
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#120a2a');
  g.addColorStop(0.5, '#0b0f1a');
  g.addColorStop(1, '#06080f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawHeader() {
  // Título com sombra estilo TikTok (ciano/rosa)
  ctx.save();
  for (const [dx, c] of [[-5, '#25f4ee'], [5, '#fe2c55'], [0, '#ffffff']]) text('CORRIDA MALUCA', W / 2 + dx, 90, 104, c, 'center', 900);
  ctx.restore();

  let sub;
  let color = '#ffd23f';
  if (phase === 'lobby') {
    sub = racers.length === 0 ? 'Comente CARRO ou MOTO para entrar!' : `Largada em ${Math.ceil(timer)}s · comente CARRO ou MOTO`;
    if (racers.length === 0) color = '#e8ecf5';
  } else if (phase === 'countdown') sub = 'Preparar...';
  else if (phase === 'racing') { sub = 'CORRENDO! 🎁 presente = TURBO'; color = '#fe2c55'; }
  else sub = `Próxima corrida em ${Math.ceil(timer)}s`;
  text(sub, W / 2, 190, 44, color, 'center', 800);

  const info = `Pista ${racers.length}/${CFG.maxRacers}${queue.length ? ` · Fila: ${queue.length}` : ''}`;
  text(info, W / 2, 248, 30, '#8892a8', 'center', 600);

  // Indicador de conexão
  const live = wsOk && conn.state === 'connected';
  const label = !wsOk ? 'SEM LAUNCHER' : conn.mode === 'sim' && live ? 'SIMULAÇÃO' : live ? 'AO VIVO' : 'AGUARDANDO';
  const dot = !wsOk ? '#fe2c55' : live ? (conn.mode === 'sim' ? '#ffd23f' : '#3ddc84') : '#8892a8';
  roundRect(W - 250, 18, 232, 44, 22, 'rgba(0,0,0,.45)');
  ctx.beginPath(); ctx.arc(W - 225, 40, 8, 0, Math.PI * 2); ctx.fillStyle = dot; ctx.fill();
  text(label, W - 205, 41, 22, '#e8ecf5', 'left', 700);
}

function drawTrack() {
  const top = TRACK.top, h = TRACK.laneH * CFG.maxRacers;
  roundRect(20, top - 10, W - 40, h + 20, 24, '#1a1f2e');
  for (let i = 0; i < CFG.maxRacers; i++) {
    const y = laneY(i);
    ctx.fillStyle = i % 2 ? '#20263a' : '#1c2133';
    ctx.fillRect(20, y, W - 40, TRACK.laneH);
    if (i > 0) {
      ctx.setLineDash([28, 22]);
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(TRACK.startX, y); ctx.lineTo(TRACK.finishX, y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Largada
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.fillRect(TRACK.startX - 3, top, 6, h);
  // Chegada quadriculada
  const sq = 16;
  for (let y = 0; y < h; y += sq) {
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = ((y / sq + c) % 2) ? '#111' : '#f5f5f5';
      ctx.fillRect(TRACK.finishX + c * sq, top + y, sq, Math.min(sq, h - y));
    }
  }
}

function drawCar(x, y, color, stunned) {
  const body = stunned ? '#6b7280' : color;
  roundRect(x - 50, y - 16, 100, 30, 12, body);
  roundRect(x - 22, y - 34, 46, 22, 10, body);
  roundRect(x - 14, y - 30, 30, 15, 6, 'rgba(10,15,30,.75)');
  ctx.fillStyle = '#fff8';
  ctx.fillRect(x + 42, y - 10, 8, 7);
  for (const wx of [-28, 28]) {
    ctx.beginPath(); ctx.arc(x + wx, y + 16, 13, 0, Math.PI * 2); ctx.fillStyle = '#0a0a0a'; ctx.fill();
    ctx.beginPath(); ctx.arc(x + wx, y + 16, 5, 0, Math.PI * 2); ctx.fillStyle = '#9aa3b5'; ctx.fill();
  }
}

function drawMoto(x, y, color, stunned) {
  const body = stunned ? '#6b7280' : color;
  for (const wx of [-30, 30]) {
    ctx.beginPath(); ctx.arc(x + wx, y + 14, 15, 0, Math.PI * 2); ctx.lineWidth = 7; ctx.strokeStyle = '#0a0a0a'; ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x - 30, y + 14); ctx.lineTo(x - 8, y - 6); ctx.lineTo(x + 22, y - 6); ctx.lineTo(x + 30, y + 14);
  ctx.lineWidth = 8; ctx.strokeStyle = body; ctx.lineCap = 'round'; ctx.stroke();
  roundRect(x - 14, y - 16, 34, 14, 7, body);
  // Piloto
  ctx.beginPath(); ctx.moveTo(x - 2, y - 14); ctx.lineTo(x + 8, y - 40); ctx.lineWidth = 9; ctx.strokeStyle = '#222'; ctx.stroke();
  ctx.beginPath(); ctx.arc(x + 12, y - 48, 12, 0, Math.PI * 2); ctx.fillStyle = body; ctx.fill();
  ctx.fillStyle = 'rgba(10,15,30,.8)'; ctx.fillRect(x + 14, y - 52, 10, 7);
}

function drawRacers() {
  // Posição atual (para o número à esquerda da pista)
  const order = [...racers].sort((a, b) => (a.done && b.done ? a.rank - b.rank : b.x - a.x));
  const pos = new Map(order.map((r, i) => [r.id, i + 1]));

  for (let i = 0; i < CFG.maxRacers; i++) {
    const r = racers[i];
    const y = laneY(i);
    if (!r) {
      if (phase === 'lobby') text('vaga livre', TRACK.startX + 30, y + TRACK.laneH / 2, 26, 'rgba(255,255,255,.18)', 'left', 600);
      continue;
    }
    const cy = y + 64;
    const x = racerX(r);
    const label = phase === 'lobby' || phase === 'countdown' ? `${i + 1}` : `${pos.get(r.id)}º`;
    text(label, 95, y + TRACK.laneH / 2, 40, r.color, 'center', 900);

    if (r.boost > 0 && phase === 'racing' && r.stun <= 0) {
      ctx.save();
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 30;
    }
    if (r.type === 'moto') drawMoto(x, cy, r.color, r.stun > 0);
    else drawCar(x, cy, r.color, r.stun > 0);
    if (r.boost > 0 && phase === 'racing' && r.stun <= 0) ctx.restore();

    if (r.stun > 0) text('⚡', x, cy - 50, 40, '#25f4ee', 'center');
    // Nome à frente do veículo; perto da chegada passa para trás dele
    const nm = short(r.name);
    ctx.font = `700 28px ${FONT}`;
    const ahead = x + 64 + ctx.measureText(nm).width < TRACK.finishX - 12;
    ctx.save();
    ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
    text(nm, ahead ? x + 64 : x - 64, cy - 4, 28, '#fff', ahead ? 'left' : 'right', 700);
    ctx.restore();
    if (phase === 'lobby' && r.boost > 0) text(`🔥 ${r.boost.toFixed(0)}s`, TRACK.finishX - 30, cy, 26, '#ffd23f', 'right', 700);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.ttl / p.max, 0, 1);
    ctx.fillStyle = p.color;
    if (p.confetti) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.ttl / p.max), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawPopups() {
  for (const p of popups) {
    ctx.globalAlpha = clamp(p.ttl / 0.5, 0, 1);
    ctx.save(); ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
    text(p.text, clamp(p.x, 160, W - 160), p.y, 34, p.color, 'center', 900);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawCountdown() {
  if (phase === 'countdown') {
    const n = Math.ceil(timer);
    const frac = timer - Math.floor(timer);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(20, TRACK.top - 10, W - 40, TRACK.laneH * CFG.maxRacers + 20);
    text(String(n), W / 2, TRACK.top + 560, 260 + frac * 80, '#ffd23f', 'center', 900);
  } else if (phase === 'racing' && raceTime < 0.8) {
    ctx.globalAlpha = 1 - raceTime / 0.8;
    text('VAI!', W / 2, TRACK.top + 560, 280, '#3ddc84', 'center', 900);
    ctx.globalAlpha = 1;
  }
}

function drawPodium() {
  if (phase !== 'podium') return;
  ctx.fillStyle = 'rgba(5,7,13,.78)';
  ctx.fillRect(20, TRACK.top - 10, W - 40, TRACK.laneH * CFG.maxRacers + 20);
  const cy = TRACK.top + 200;
  const winner = results[0];
  text('🏆', W / 2, cy, 150, '#fff', 'center');
  text('VENCEDOR', W / 2, cy + 130, 48, '#ffd23f', 'center', 900);
  if (winner) text(short(winner.name, 18), W / 2, cy + 210, 76, '#fff', 'center', 900);
  const medals = ['🥈', '🥉', '4º', '5º'];
  results.slice(1, 5).forEach((r, i) => {
    const y = cy + 330 + i * 80;
    roundRect(220, y - 32, 640, 64, 18, 'rgba(255,255,255,.06)');
    text(medals[i], 280, y, 38, '#fff', 'center', 800);
    text(short(r.name, 18), 330, y, 36, '#e8ecf5', 'left', 700);
  });
}

function drawBottom() {
  const y0 = 1450;
  // Como jogar
  const boxes = [
    ['💬', 'Comente', 'CARRO ou MOTO'],
    ['🎁', 'Presente', '= TURBO'],
    ['⚡', '100+ moedas', '= raio no líder'],
  ];
  const bw = (W - 40 - 2 * 16) / 3;
  boxes.forEach(([ico, a, b], i) => {
    const x = 20 + i * (bw + 16);
    roundRect(x, y0, bw, 150, 22, 'rgba(255,255,255,.05)', 'rgba(255,255,255,.08)');
    text(ico, x + bw / 2, y0 + 42, 48, '#fff', 'center');
    text(a, x + bw / 2, y0 + 94, 30, '#e8ecf5', 'center', 800);
    text(b, x + bw / 2, y0 + 126, 26, '#ffd23f', 'center', 700);
  });

  // Feed de eventos
  const fy = y0 + 180;
  roundRect(20, fy, 620, 250, 22, 'rgba(255,255,255,.04)');
  feed.slice(0, 6).forEach((f, i) => {
    ctx.globalAlpha = 1 - i * 0.13;
    text(short(f.text, 34), 44, fy + 30 + i * 38, 26, f.color, 'left', 600);
  });
  ctx.globalAlpha = 1;

  // Ranking de vitórias
  const top = Object.values(wins).sort((a, b) => b.wins - a.wins).slice(0, 5);
  roundRect(656, fy, W - 676, 250, 22, 'rgba(255,215,63,.07)');
  text('🏆 VITÓRIAS', 680, fy + 30, 26, '#ffd23f', 'left', 900);
  if (top.length === 0) text('ninguém ainda', 680, fy + 80, 24, '#8892a8', 'left', 600);
  top.forEach((w, i) => {
    text(`${i + 1}. ${short(w.name, 12)}`, 680, fy + 76 + i * 36, 24, '#e8ecf5', 'left', 600);
    text(String(w.wins), W - 44, fy + 76 + i * 36, 24, '#ffd23f', 'right', 800);
  });
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * 24 * shake, (Math.random() - 0.5) * 24 * shake);
  drawBackground();
  drawHeader();
  drawTrack();
  drawRacers();
  drawParticles();
  drawPopups();
  drawCountdown();
  drawPodium();
  drawBottom();
  ctx.restore();
}

// ---------- Loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Conexão com o launcher ----------
function connect() {
  const ws = new WebSocket(`ws://${location.host || 'localhost:21213'}`);
  ws.onopen = () => { wsOk = true; };
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'status') conn = e.status;
    else onLive(e);
  };
  ws.onclose = () => { wsOk = false; setTimeout(connect, 2000); };
}
connect();
