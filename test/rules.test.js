import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createHandlers } from '../src/handlers.js';
import { matchRules, normalize, parseRules } from '../src/rules.js';

const RULES = parseRules({
  qoidalar: [
    { nomi: 'Salomlashish', kalit_sozlar: ['salom', 'assalomu alaykum', 'привет'], javob: 'Assalomu alaykum! Qanday yordam bera olamiz?' },
    { nomi: 'Yetkazib berish', kalit_sozlar: ['dostavka', 'yetkazib', 'доставка'], javob: 'Toshkent bo\'ylab yetkazib beramiz.' },
    { nomi: 'Ish vaqti', kalit_sozlar: ['ish vaqti', 'soat nechada'], javob: 'Har kuni 9:00 dan 21:00 gacha.' },
    { nomi: 'Qisqa', kalit_sozlar: ['opt'], javob: 'Ulgurji narxlar bor.' },
  ],
});

test('normalize: kirill, apostrof, belgilar', () => {
  assert.equal(normalize('ДОСТАВКА есть?'), 'dostavka est');
  assert.equal(normalize("Qo‘ng‘iroq, iltimos!"), 'qongiroq iltimos');
});

test('matchRules: kalit so\'z va so\'z boshi bo\'yicha', () => {
  const names = (t) => matchRules(RULES, t).map((r) => r.name);
  assert.deepEqual(names('Salom!'), ['Salomlashish']);
  assert.deepEqual(names('Dostavkangiz bormi?'), ['Yetkazib berish']);
  assert.deepEqual(names('доставка есть?'), ['Yetkazib berish']);
  assert.deepEqual(names('Assalomu alaykum, ish vaqtingiz qanaqa? yetkazib berasizmi'), ['Salomlashish', 'Yetkazib berish', 'Ish vaqti']);
  assert.deepEqual(names('Kinder bormi'), []);
  // 3 harfli kalit so'z faqat butun so'z bo'lsa
  assert.deepEqual(names('optom bormi'), []);
  assert.deepEqual(names('opt narx'), ['Qisqa']);
});

test('parseRules: xatolar aniq aytiladi', () => {
  assert.throws(() => parseRules({}), /qoidalar/);
  assert.throws(() => parseRules({ qoidalar: [{ nomi: 'X', kalit_sozlar: ['a'], javob: '' }] }), /"X".*javob/);
  assert.throws(() => parseRules({ qoidalar: [{ kalit_sozlar: [], javob: 'ok' }] }), /kalit_sozlar/);
});

test('javoblar.json fayli to\'g\'ri formatda', () => {
  const rules = parseRules(JSON.parse(readFileSync(new URL('../javoblar.json', import.meta.url), 'utf8')));
  assert.ok(Array.isArray(rules));
});

// --- handler bilan birga ---

const ENV = {
  BOT_TOKEN: '1:a',
  SEARCH_API_URL: 'https://api.example.com',
  SEARCH_API_KEY: 'k',
  ADMIN_CHAT_ID: '999',
  BUYURTMA_BOT_USERNAME: 'shokoladchi_bot',
};

function setup(products = []) {
  const sent = [];
  let t = 0;
  const api = { sendMessage: async (chatId, text, opts) => sent.push({ chatId, text, opts }) };
  const silent = { info() {}, warn() {}, error() {} };
  const h = createHandlers({
    api,
    searchProducts: async () => products,
    config: loadConfig(ENV),
    getRules: () => RULES,
    logger: silent,
    now: () => t,
  });
  return { sent, h, advance: (ms) => (t += ms) };
}

const msg = (text) => ({ business_connection_id: 'bc', chat: { id: 5, type: 'private' }, from: { id: 5, first_name: 'A' }, text });

test('handler: qoida mos kelsa tayyor javob, operator javobi va adminga xabar yo\'q', async () => {
  const { sent, h } = setup();
  await h.handleBusinessMessage(msg('Dostavka bormi?'));
  assert.deepEqual(sent.map((s) => s.text), ['Toshkent bo\'ylab yetkazib beramiz.']);
  assert.equal(sent[0].opts.business_connection_id, 'bc');
});

test('handler: qoida + mahsulot birga', async () => {
  const { sent, h } = setup([{ id: '1', name: 'Kinder', price: 1000, available: true, image: null, description: '' }]);
  await h.handleBusinessMessage(msg('Salom, kinder bormi'));
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /Assalomu alaykum/);
  assert.match(sent[1].text, /Kinder/);
});

test('handler: hech narsa mos kelmasa — operator javobi va adminga xabar', async () => {
  const { sent, h } = setup();
  await h.handleBusinessMessage(msg('qandaydir savol'));
  assert.deepEqual(sent.map((s) => s.chatId), [5, '999']);
  assert.equal(sent[0].text, 'Operator tez orada javob beradi');
  assert.match(sent[1].text, /qandaydir savol/);
});

test('handler: bir xil qoida bir mijozga qayta-qayta yuborilmaydi', async () => {
  const { sent, h, advance } = setup();
  await h.handleBusinessMessage(msg('salom'));
  await h.handleBusinessMessage(msg('salom'));
  assert.equal(sent.length, 1);
  advance(301_000);
  await h.handleBusinessMessage(msg('salom'));
  assert.equal(sent.length, 2);
});
