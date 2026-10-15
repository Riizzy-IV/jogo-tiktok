const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const Simulator = require('./src/simulator');
const TikTokSource = require('./src/tiktok');
const GIFTS = require('./src/gifts');

const PORT = Number(process.env.LIVE_ARCADE_PORT) || 21213;
const GAMES_DIR = path.join(__dirname, 'games');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff2': 'font/woff2',
};

let launcherWin = null;
const gameWins = new Map();
let source = null;
let status = { mode: 'none', state: 'disconnected', detail: 'Nenhuma fonte de eventos ativa' };

// ---------- Jogos ----------
function listGames() {
  if (!fs.existsSync(GAMES_DIR)) return [];
  return fs.readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(GAMES_DIR, d.name, 'game.json')))
    .map((d) => ({ id: d.name, ...JSON.parse(fs.readFileSync(path.join(GAMES_DIR, d.name, 'game.json'), 'utf8')) }));
}

function gameUrl(id) { return `http://localhost:${PORT}/games/${encodeURIComponent(id)}/`; }

// Jogos Roblox abrem o arquivo do mapa no Roblox Studio. No instalador o arquivo fica fora do .asar (ver asarUnpack)
function placeFile(game) {
  return path.join(GAMES_DIR, game.id, game.place).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

// O Studio fica em %LOCALAPPDATA%\Roblox\Versions\<versão>\ e nem sempre registra a extensão .rbxlx no Windows
function findStudio() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Versions');
  if (!fs.existsSync(base)) return null;
  return fs.readdirSync(base)
    .map((v) => path.join(base, v, 'RobloxStudioBeta.exe'))
    .filter((exe) => fs.existsSync(exe))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

async function playGame(id) {
  const game = listGames().find((g) => g.id === id);
  if (!game) return false;
  if (game.platform === 'roblox') {
    // O Studio registra .rbxlx no Windows na primeira vez que abre; antes disso, chama o executável direto
    if (!(await shell.openPath(placeFile(game)))) return { roblox: true };
    const studio = findStudio();
    if (!studio) return { error: 'Roblox Studio não encontrado. Instale em create.roblox.com e tente de novo.' };
    spawn(studio, [placeFile(game)], { detached: true, stdio: 'ignore' }).unref();
    return { roblox: true };
  }
  const existing = gameWins.get(id);
  if (existing && !existing.isDestroyed()) { existing.focus(); return true; }

  const vertical = game.orientation !== 'landscape';
  const win = new BrowserWindow({
    width: vertical ? 540 : 960,
    height: vertical ? 960 : 540,
    title: `${game.name} — Live Arcade`,
    backgroundColor: '#0b0f1a',
    autoHideMenuBar: true,
  });
  win.setAspectRatio(vertical ? 9 / 16 : 16 / 9);
  win.loadURL(gameUrl(id));
  // Mantém o título fixo para a captura de janela do LIVE Studio/OBS achar sempre a mesma
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => gameWins.delete(id));
  gameWins.set(id, win);
  return true;
}

// ---------- Servidor local (arquivos dos jogos + WebSocket de eventos) ----------
const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname === '/roblox/poll') return robloxPoll(searchParams, res);
  let file = path.normalize(path.join(__dirname, decodeURIComponent(pathname)));
  if (!file.startsWith(GAMES_DIR + path.sep)) { res.writeHead(404); return res.end('Not found'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', status }));
  updateClients();
  ws.on('close', updateClients);
});

// ---------- Ponte para o Roblox Studio ----------
// Scripts do Roblox não abrem WebSocket, só HTTP: o jogo pergunta "o que chegou depois do evento N?"
// e a resposta espera até 20 s por novidade (long-poll), então quase não há requisições paradas.
const ROBLOX_WAIT = 20000;
const robloxQueue = [];
const robloxWaiters = new Set();
let robloxSeq = 0;
let robloxLastPoll = 0;

function pushRoblox(evt) {
  if (evt.type === 'join') return; // muito ruído e nenhum jogo Roblox usa
  const { type, user, text, gift, count } = evt;
  robloxQueue.push({ seq: ++robloxSeq, type, user: user && { id: user.id, nickname: user.nickname }, text, gift, count });
  if (robloxQueue.length > 300) robloxQueue.shift();
  for (const wake of robloxWaiters) wake();
}

function robloxPoll(params, res) {
  const wasActive = robloxActive();
  robloxLastPoll = Date.now();
  if (!wasActive) updateClients();
  const reply = (events) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ seq: robloxSeq, status, events }));
  };
  const since = Number(params.get('since'));
  // Primeira chamada (ou o launcher reiniciou e a contagem voltou): só sincroniza, sem reenviar eventos antigos
  if (!params.has('since') || !Number.isFinite(since) || since > robloxSeq) return reply([]);
  const pending = () => robloxQueue.filter((e) => e.seq > since);
  if (pending().length) return reply(pending());

  const done = () => { clearTimeout(timer); robloxWaiters.delete(done); robloxLastPoll = Date.now(); reply(pending()); };
  const timer = setTimeout(done, ROBLOX_WAIT);
  robloxWaiters.add(done);
  res.on('close', () => { clearTimeout(timer); robloxWaiters.delete(done); });
}

const robloxActive = () => robloxWaiters.size > 0 || Date.now() - robloxLastPoll < ROBLOX_WAIT + 10000;
function updateClients() { sendToLauncher('games:clients', wss.clients.size + (robloxActive() ? 1 : 0)); }
setInterval(updateClients, 10000);

function sendToLauncher(channel, payload) {
  if (launcherWin && !launcherWin.isDestroyed()) launcherWin.webContents.send(channel, payload);
}

function broadcast(evt) {
  const full = { ...evt, ts: Date.now() };
  const msg = JSON.stringify(full);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  pushRoblox(full);
  sendToLauncher('live:event', full);
}

function setStatus(s) {
  status = s;
  sendToLauncher('live:status', s);
  const msg = JSON.stringify({ type: 'status', status: s });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

// ---------- Fontes de eventos ----------
function stopSource() {
  if (source) { source.stop(); source.removeAllListeners(); source = null; }
  setStatus({ mode: 'none', state: 'disconnected', detail: 'Nenhuma fonte de eventos ativa' });
}

function useSource(src) {
  stopSource();
  source = src;
  src.on('event', broadcast);
  src.on('status', setStatus);
  src.start();
}

ipcMain.handle('app:info', () => ({ port: PORT, version: app.getVersion() }));
ipcMain.handle('games:list', () => listGames().map((g) => ({
  ...g,
  url: gameUrl(g.id),
  coverUrl: g.cover ? gameUrl(g.id) + encodeURIComponent(g.cover) : null,
})));
ipcMain.handle('games:play', (_, id) => playGame(id));
ipcMain.handle('games:openBrowser', (_, id) => shell.openExternal(gameUrl(id)));
ipcMain.handle('games:reveal', (_, id) => {
  const game = listGames().find((g) => g.id === id);
  if (game?.platform === 'roblox') shell.showItemInFolder(placeFile(game));
});
ipcMain.handle('gifts:list', () => GIFTS);
ipcMain.handle('status:get', () => status);
ipcMain.handle('source:sim', (_, rate) => { const sim = new Simulator(); sim.setRate(rate); useSource(sim); });
ipcMain.handle('sim:rate', (_, rate) => { if (source instanceof Simulator) source.setRate(rate); });
ipcMain.handle('source:tiktok', (_, username) => useSource(new TikTokSource(username)));
ipcMain.handle('source:stop', () => stopSource());
ipcMain.handle('event:inject', (_, evt) => broadcast(evt));

// ---------- App ----------
function createLauncher() {
  launcherWin = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: 'Live Arcade',
    backgroundColor: '#101014',
    autoHideMenuBar: true,
    // Sem moldura do Windows; os botões nativos ficam desenhados sobre a barra do app
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#101014', symbolColor: '#e8e8ea', height: 32 },
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  launcherWin.loadFile(path.join(__dirname, 'launcher', 'index.html'));
  launcherWin.on('closed', () => {
    launcherWin = null;
    for (const w of gameWins.values()) if (!w.isDestroyed()) w.close();
  });
}

// Só uma instância: abrir de novo traz a janela que já está aberta
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!launcherWin) return;
  if (launcherWin.isMinimized()) launcherWin.restore();
  launcherWin.focus();
});

app.whenReady().then(() => {
  server.on('error', (err) => {
    const msg = err.code === 'EADDRINUSE'
      ? `A porta ${PORT} já está em uso por outro programa. Feche-o e abra o Live Arcade de novo; os jogos não vão receber eventos até lá.`
      : `O servidor local falhou: ${err.message}`;
    dialog.showErrorBox('Live Arcade', msg);
  });
  server.listen(PORT, '127.0.0.1');
  createLauncher();
});

app.on('window-all-closed', () => { stopSource(); app.quit(); });
