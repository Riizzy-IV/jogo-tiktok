const { EventEmitter } = require('events');
const GIFTS = require('./gifts');

const FIRST = ['ana', 'joao', 'bia', 'lucas', 'duda', 'pedro', 'mari', 'gabi', 'rafa', 'leo', 'julia', 'caio',
  'lari', 'theo', 'nina', 'davi', 'malu', 'enzo', 'livia', 'bruno', 'carol', 'vini', 'isa', 'gui'];
const SUFFIX = ['gamer', 'oficial', '_br', '123', 'zinha', 'tv', 'xd', '2010', '_rj', '_sp', 'play', ''];
const CHATTER = ['kkkkkk', 'boa noite', 'vai vai vai', 'eu quero jogar', 'que jogo é esse?', 'top demais',
  'manda salve', 'primeira vez aqui', '🔥🔥🔥', 'aaaa', 'quem vai ganhar?', 'bora'];
// Comentários que acionam os jogos (corrida: carro/moto; urna: números)
const ENTRIES = ['carro', 'moto', 'CARRO', 'moto!!', 'quero carro', 'eu vou de moto',
  '22', '13', '22', '13', 'vota 22', '13!!!', 'é 22', '13 13 13'];

// Intervalo médio entre eventos (ms) por ritmo
const RATES = { calmo: 2200, normal: 700, frenesi: 180 };

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function pickGift() {
  const total = GIFTS.reduce((s, g) => s + g.weight, 0);
  let r = Math.random() * total;
  for (const g of GIFTS) { if ((r -= g.weight) <= 0) return g; }
  return GIFTS[0];
}

class Simulator extends EventEmitter {
  constructor() {
    super();
    this.rate = 'normal';
    this.users = [];
    this.timer = null;
  }

  newUser() {
    const id = pick(FIRST) + pick(SUFFIX) + (Math.random() < 0.4 ? Math.floor(Math.random() * 99) : '');
    const user = { id, nickname: id };
    this.users.push(user);
    return user;
  }

  // Público cresce ao longo da live, mas quem já está costuma voltar a interagir
  someUser() {
    if (this.users.length < 5 || Math.random() < 0.15) return this.newUser();
    return pick(this.users);
  }

  tick() {
    const user = this.someUser();
    const r = Math.random();
    let evt;
    if (r < 0.32) evt = { type: 'comment', user, text: pick(ENTRIES) };
    else if (r < 0.55) evt = { type: 'comment', user, text: pick(CHATTER) };
    else if (r < 0.75) evt = { type: 'like', user, count: 1 + Math.floor(Math.random() * 15) };
    else if (r < 0.93) {
      const g = pickGift();
      const count = g.coins <= 5 && Math.random() < 0.3 ? 1 + Math.floor(Math.random() * 10) : 1;
      evt = { type: 'gift', user, gift: { name: g.name, coins: g.coins, count, emoji: g.emoji } };
    } else if (r < 0.97) evt = { type: 'follow', user };
    else evt = { type: 'share', user };
    this.emit('event', evt);
  }

  schedule() {
    const base = RATES[this.rate] || RATES.normal;
    this.timer = setTimeout(() => { this.tick(); this.schedule(); }, base * (0.3 + Math.random() * 1.4));
  }

  setRate(rate) { this.rate = rate; }

  start() {
    this.stop();
    this.emit('status', { mode: 'sim', state: 'connected', detail: 'Simulação ativa' });
    this.schedule();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = Simulator;
