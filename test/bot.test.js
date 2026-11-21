import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { formatPrice, productText } from '../src/format.js';
import { createHandlers } from '../src/handlers.js';
import { buildQueries, createSearch, keywords, normalizeResults } from '../src/search.js';

const ENV = {
  BOT_TOKEN: '123:abc',
  SEARCH_API_URL: 'https://api.example.com/',
  SEARCH_API_KEY: 'k1',
  ADMIN_CHAT_ID: '999',
  BUYURTMA_BOT_USERNAME: '@shokoladchi_bot',
};

// --- config ---

test('config: majburiy o\'zgaruvchilar tekshiriladi', () => {
  assert.throws(() => loadConfig({}), /BOT_TOKEN, SEARCH_API_URL, SEARCH_API_KEY, ADMIN_CHAT_ID, BUYURTMA_BOT_USERNAME/);
  const c = loadConfig(ENV);
  assert.equal(c.searchApiUrl, 'https://api.example.com');
  assert.equal(c.orderBotUsername, 'shokoladchi_bot');
  assert.equal(c.maxResults, 5);
  assert.throws(() => loadConfig({ ...ENV, ADMIN_CHAT_ID: 'abc' }), /ADMIN_CHAT_ID/);
});

// --- search ---

test('keywords: salomlashish va savol so\'zlari olib tashlanadi', () => {
  assert.deepEqual(keywords('Assalomu alaykum, Kinder bormi? Narxi qancha'), ['kinder']);
  assert.deepEqual(keywords('Snickers va Twix bormi'), ['snickers', 'twix']);
  assert.deepEqual(keywords('привет, сколько стоит Milka?'), ['milka']);
});

test('buildQueries: bosqichlar', () => {
  assert.deepEqual(buildQueries('Kinder'), [['Kinder']]);
  assert.deepEqual(buildQueries('Kinder bueno bormi'), [['Kinder bueno bormi'], ['kinder bueno'], ['kinder', 'bueno']]);
  assert.deepEqual(buildQueries('   '), []);
});

test('normalizeResults: noto\'g\'ri yozuvlar tashlanadi', () => {
  const r = normalizeResults([
    { id: 12, name: 'Kinder', price: 12500, available: true },
    { id: 'x y', name: 'Yomon id' },
    { id: 3, name: '' },
    { id: 4, name: 'Milka', price: '9000' },
  ]);
  assert.deepEqual(r, [
    { id: '12', name: 'Kinder', price: 12500, available: true },
    { id: '4', name: 'Milka', price: 9000, available: null },
  ]);
});

function fakeFetch(db, calls) {
  return async (url, init) => {
    calls.push({ url: String(url), key: init.headers['X-API-Key'] });
    const q = new URL(url).searchParams.get('q').toLowerCase();
    const hits = db.filter((p) => q.split(' ').every((w) => p.name.toLowerCase().includes(w)));
    return { ok: true, status: 200, json: async () => hits };
  };
}

const DB = [
  { id: 1, name: 'Kinder Bueno', price: 12500, available: true },
  { id: 2, name: 'Snickers 50g', price: 8000, available: false },
  { id: 3, name: 'Twix', price: 7000, available: true },
];

test('search: so\'rov manzili va X-API-Key to\'g\'ri', async () => {
  const calls = [];
  const search = createSearch({ apiUrl: 'https://api.example.com', apiKey: 'k1', timeoutMs: 1000, maxResults: 5, fetchImpl: fakeFetch(DB, calls) });
  const r = await search('Kinder');
  assert.equal(r.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/search?q=Kinder&limit=5');
  assert.equal(calls[0].key, 'k1');
});

test('search: oddiy gapdan mahsulotlar topiladi va birlashtiriladi', async () => {
  const calls = [];
  const search = createSearch({ apiUrl: 'https://api.example.com', apiKey: 'k1', timeoutMs: 1000, maxResults: 5, fetchImpl: fakeFetch(DB, calls) });
  const r = await search('Salom, snickers va twix bormi?');
  assert.deepEqual(r.map((p) => p.id), ['2', '3']);
});

test('search: API xatosi SearchError beradi', async () => {
  const search = createSearch({
    apiUrl: 'https://api.example.com', apiKey: 'bad', timeoutMs: 1000, maxResults: 5,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  });
  await assert.rejects(() => search('kinder'), /401/);
});

// --- format ---

test('format: narx va kartochka', () => {
  assert.equal(formatPrice(125000), "125 000 so'm");
  assert.equal(formatPrice(null), null);
  assert.equal(
    productText({ name: 'A <b>&', price: 1500, available: false }),
    "<b>A &lt;b&gt;&amp;</b>\nNarxi: 1 500 so'm\n❌ Hozircha mavjud emas",
  );
});

// --- handlers ---

function setup({ products = [], fail = false, apiError = null } = {}) {
  const sent = [];
  let t = 0;
  const api = {
    sendMessage: async (chatId, text, opts = {}) => {
      if (apiError && opts.reply_markup) throw apiError;
      sent.push({ chatId, text, opts });
    },
  };
  const searchProducts = async () => {
    if (fail) throw new Error('down');
    return products;
  };
  const silent = { info() {}, warn() {}, error() {} };
  const h = createHandlers({ api, searchProducts, config: loadConfig(ENV), logger: silent, now: () => t });
  return { sent, h, advance: (ms) => (t += ms) };
}

const customer = { id: 555, is_bot: false, first_name: 'Ali', username: 'ali' };
const msg = (over = {}) => ({
  business_connection_id: 'bc1',
  chat: { id: 555, type: 'private' },
  from: customer,
  text: 'kinder',
  ...over,
});

test('handler: topilgan har bir mahsulot alohida xabar va tugma bilan', async () => {
  const { sent, h } = setup({ products: normalizeResults(DB) });
  await h.handleBusinessMessage(msg());
  assert.equal(sent.length, 3);
  for (const s of sent) {
    assert.equal(s.chatId, 555);
    assert.equal(s.opts.business_connection_id, 'bc1');
  }
  const btn = sent[0].opts.reply_markup.inline_keyboard[0][0];
  assert.equal(btn.text, 'Buyurtma berish');
  assert.equal(btn.url, 'https://t.me/shokoladchi_bot?start=product_1');
  assert.match(sent[0].text, /Kinder Bueno/);
  assert.match(sent[0].text, /12 500 so'm/);
  assert.match(sent[0].text, /✅ Mavjud/);
  assert.match(sent[1].text, /❌ Hozircha mavjud emas/);
});

test('handler: topilmasa — mijozga operator javobi, adminga xabar', async () => {
  const { sent, h } = setup();
  await h.handleBusinessMessage(msg({ text: 'Yetkazib berish <bormi>?' }));
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { chatId: 555, text: 'Operator tez orada javob beradi', opts: { business_connection_id: 'bc1' } });
  assert.equal(sent[1].chatId, '999');
  assert.equal(sent[1].opts.business_connection_id, undefined);
  assert.match(sent[1].text, /topilmadi/);
  assert.match(sent[1].text, /Yetkazib berish &lt;bormi&gt;\?/);
  assert.match(sent[1].text, /@ali/);
});

test('handler: operator javobi cooldown bilan, admin har safar oladi', async () => {
  const { sent, h, advance } = setup();
  await h.handleBusinessMessage(msg({ text: 'a' }));
  await h.handleBusinessMessage(msg({ text: 'b' }));
  assert.deepEqual(sent.map((s) => s.chatId), [555, '999', '999']);
  advance(301_000);
  await h.handleBusinessMessage(msg({ text: 'c' }));
  assert.deepEqual(sent.map((s) => s.chatId), [555, '999', '999', 555, '999']);
});

test('handler: qidiruv xatosida ham operator javobi va admin ogohlantiriladi', async () => {
  const { sent, h } = setup({ fail: true });
  await h.handleBusinessMessage(msg());
  assert.equal(sent[0].text, 'Operator tez orada javob beradi');
  assert.match(sent[1].text, /Qidiruv API ishlamadi/);
});

test('handler: biznes egasi, bot va matnsiz xabarlar e\'tiborsiz qoladi', async () => {
  const { sent, h } = setup({ products: normalizeResults(DB) });
  await h.handleBusinessMessage(msg({ from: { id: 777, is_bot: false, first_name: 'Egasi' } }));
  await h.handleBusinessMessage(msg({ sender_business_bot: { id: 1 }, from: customer }));
  await h.handleBusinessMessage(msg({ text: undefined, sticker: {} }));
  await h.handleBusinessMessage(msg({ business_connection_id: undefined }));
  assert.equal(sent.length, 0);
});

test('handler: rasm izohi ham qidiriladi', async () => {
  const { sent, h } = setup({ products: normalizeResults(DB).slice(0, 1) });
  await h.handleBusinessMessage(msg({ text: undefined, caption: 'shu bormi' }));
  assert.equal(sent.length, 1);
});

test('handler: tugma rad etilsa havola matnda yuboriladi', async () => {
  const err = Object.assign(new Error('x'), { error_code: 400, description: 'Bad Request: BUTTON_TYPE_INVALID' });
  const { sent, h } = setup({ products: normalizeResults(DB).slice(0, 1), apiError: err });
  await h.handleBusinessMessage(msg());
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /href="https:\/\/t\.me\/shokoladchi_bot\?start=product_1">Buyurtma berish/);
});
