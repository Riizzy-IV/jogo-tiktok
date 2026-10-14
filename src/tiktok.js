const { EventEmitter } = require('events');

// Converte os eventos da tiktok-live-connector para o formato interno do launcher:
// { type, user: { id, nickname, avatar }, text?, gift?: { name, coins, count }, count? }
// A biblioteca usa o protocolo v3 (displayId, content, count); os nomes antigos ficam como reserva
function toUser(d) {
  const u = d.user || {};
  const handle = u.uniqueId || u.displayId;
  const img = u.avatarThumb || u.profilePicture || {};
  return {
    id: handle || String(u.idStr || u.id || u.userId || 'anon'),
    nickname: u.nickname || handle || 'anônimo',
    avatar: img.urlList?.[0] || img.url?.[0] || u.profilePictureUrl,
  };
}

// Reserva para quando o TikTok manda o presente sem nome (só o id)
const KNOWN_GIFTS = {
  5655: { name: 'Rosa', coins: 1 },
};

class TikTokSource extends EventEmitter {
  constructor(username, options = {}) {
    super();
    this.username = username.trim().replace(/^@/, '');
    this.options = options;
    this.conn = null;
  }

  async start() {
    const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');
    this.emit('status', { mode: 'tiktok', state: 'connecting', detail: `Conectando em @${this.username}...` });

    // Sem enableExtendedGiftInfo: a lista de presentes da sala usa uma rota paga do Euler Stream.
    // Nome e moedas do presente já vêm em giftDetails de cada evento.
    const conn = new TikTokLiveConnection(this.username, {
      ...(this.options.signApiKey ? { signApiKey: this.options.signApiKey } : {}),
    });
    this.conn = conn;
    const send = (evt) => this.emit('event', evt);

    conn.on(WebcastEvent.CHAT, (d) => send({ type: 'comment', user: toUser(d), text: d.content ?? d.comment ?? '' }));
    // Presentes em sequência (combo) chegam várias vezes com repeatCount crescente e um último com repeatEnd.
    // Conta só o que aumentou desde o evento anterior da mesma sequência, assim nada é contado em dobro.
    const streaks = new Map();
    conn.on(WebcastEvent.GIFT, (d) => {
      const info = d.gift || d.giftDetails || {}; // protocolo v3 usa "gift"; versões antigas, "giftDetails"
      const user = toUser(d);
      const id = String(d.giftId || info.id || '');
      const key = `${user.id}:${id}:${d.groupId || ''}`;
      const total = Number(d.repeatCount) || 1;
      const delta = total - (streaks.get(key) || 0);
      if (d.repeatEnd) streaks.delete(key);
      else streaks.set(key, total);
      if (delta <= 0) return;
      const known = KNOWN_GIFTS[id];
      send({
        type: 'gift',
        user,
        gift: {
          id,
          name: info.name || info.giftName || known?.name || `Presente ${id}`,
          coins: Number(info.diamondCount) || known?.coins || 1,
          count: delta,
        },
      });
    });
    conn.on(WebcastEvent.LIKE, (d) => send({ type: 'like', user: toUser(d), count: Number(d.count ?? d.likeCount) || 1 }));
    conn.on(WebcastEvent.FOLLOW, (d) => send({ type: 'follow', user: toUser(d) }));
    conn.on(WebcastEvent.SHARE, (d) => send({ type: 'share', user: toUser(d) }));
    conn.on(WebcastEvent.MEMBER, (d) => send({ type: 'join', user: toUser(d) }));
    conn.on(WebcastEvent.STREAM_END, () =>
      this.emit('status', { mode: 'tiktok', state: 'disconnected', detail: 'A live terminou' }));
    conn.on(WebcastEvent.DISCONNECTED, () =>
      this.emit('status', { mode: 'tiktok', state: 'disconnected', detail: 'Desconectado do TikTok' }));

    try {
      const state = await conn.connect();
      this.emit('status', { mode: 'tiktok', state: 'connected', detail: `Ao vivo: @${this.username} (sala ${state.roomId})` });
    } catch (err) {
      const msg = /offline|isn't online|not online/i.test(`${err?.name} ${err?.message}`)
        ? `@${this.username} não está ao vivo agora`
        : `Falha ao conectar: ${err?.message || err}`;
      this.emit('status', { mode: 'tiktok', state: 'error', detail: msg });
    }
  }

  stop() {
    try { this.conn?.disconnect(); } catch { /* já desconectado */ }
    this.conn = null;
  }
}

module.exports = TikTokSource;
