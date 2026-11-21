import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InputFile } from 'grammy';
import sharp from 'sharp';
import { loadConfig } from '../src/config.js';
import { formatPrice, productText } from '../src/format.js';
import { createHandlers } from '../src/handlers.js';
import { createPhotoSource } from '../src/images.js';
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
    { id: '12', name: 'Kinder', price: 12500, available: true, image: null, description: '' },
    { id: '4', name: 'Milka', price: 9000, available: null, image: null, description: '' },
  ]);
});

test('normalizeResults: rasm manzili to\'liq qilinadi, xavfli manzillar olib tashlanadi', () => {
  const base = 'https://api.example.com/search';
  const [a, b, c] = normalizeResults(
    [
      { id: 1, name: 'A', image: '/uploads/products/a.webp', description: '  Mazali  ' },
      { id: 2, name: 'B', image: 'https://cdn.example.com/b.jpg' },
      { id: 3, name: 'C', image: 'javascript:alert(1)' },
    ],
    base,
  );
  assert.equal(a.image, 'https://api.example.com/uploads/products/a.webp');
  assert.equal(a.description, 'Mazali');
  assert.equal(b.image, 'https://cdn.example.com/b.jpg');
  assert.equal(c.image, null);
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
    "<b>A &lt;b&gt;&amp;</b>\n💰 Narxi: 1 500 so'm\n❌ Hozircha mavjud emas",
  );
  assert.equal(
    productText({ name: 'B', description: 'Sutli shokolad', price: 2000, available: true }),
    "<b>B</b>\n\nSutli shokolad\n\n💰 Narxi: 2 000 so'm\n✅ Mavjud",
  );
  // Uzun tavsif rasm izohi chegarasiga (1024) sig'adi
  const long = productText({ name: 'C'.repeat(100), description: 'so\'z '.repeat(500), price: 1, available: true });
  assert.ok(long.length < 1024, String(long.length));
});

test('images: WebP yuklab olinib JPEG\'ga o\'giriladi, file_id eslab qolinadi', async () => {
  const webp = await sharp({ create: { width: 50, height: 40, channels: 4, background: '#a0522d80' } }).webp().toBuffer();
  let downloads = 0;
  const src = createPhotoSource({
    allowedOrigin: 'https://api.example.com',
    fetchImpl: async () => {
      downloads++;
      return { ok: true, status: 200, arrayBuffer: async () => webp };
    },
  });
  const url = 'https://api.example.com/uploads/a.webp';
  const file = await src.get(url);
  assert.ok(file instanceof InputFile);
  const meta = await sharp(file.fileData).metadata();
  assert.equal(meta.format, 'jpeg');
  src.remember(url, { photo: [{ file_id: 'small' }, { file_id: 'big' }] });
  assert.equal(await src.get(url), 'big');
  assert.equal(downloads, 1);
  await assert.rejects(() => src.get('https://evil.example.com/x.webp'), /boshqa serverda/);
});

// --- handlers ---

function setup({ products = [], fail = false, apiError = null, photos = null, photoError = null } = {}) {
  const sent = [];
  let t = 0;
  const api = {
    sendMessage: async (chatId, text, opts = {}) => {
      if (apiError && opts.reply_markup) throw apiError;
      sent.push({ chatId, text, opts });
    },
    sendPhoto: async (chatId, photo, opts = {}) => {
      if (photoError) throw photoError;
      sent.push({ chatId, photo, opts });
      return { photo: [{ file_id: `fid-${sent.length}` }] };
    },
    sendMediaGroup: async (chatId, media, opts = {}) => {
      if (photoError) throw photoError;
      sent.push({ chatId, media, opts });
      return media.map((_, i) => ({ photo: [{ file_id: `album-${i}` }] }));
    },
  };
  const searchProducts = async () => {
    if (fail) throw new Error('down');
    return products;
  };
  const silent = { info() {}, warn() {}, error() {} };
  const h = createHandlers({ api, searchProducts, config: loadConfig(ENV), photos, logger: silent, now: () => t });
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

const ONE_BOT_BUTTON = [[{ text: 'Buyurtma berish', url: 'https://t.me/shokoladchi_bot' }]];

test('handler: bir nechta mahsulot — bitta ro\'yxat xabari va bitta tugma (botga)', async () => {
  const { sent, h } = setup({ products: normalizeResults(DB) });
  await h.handleBusinessMessage(msg());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, 555);
  assert.equal(sent[0].opts.business_connection_id, 'bc1');
  assert.match(sent[0].text, /1\. <b>Kinder Bueno<\/b> — 12 500 so'm ✅/);
  assert.match(sent[0].text, /2\. <b>Snickers 50g<\/b> — 8 000 so'm ❌ hozircha yo'q/);
  assert.match(sent[0].text, /3\. <b>Twix<\/b> — 7 000 so'm ✅/);
  assert.deepEqual(sent[0].opts.reply_markup.inline_keyboard, ONE_BOT_BUTTON);
});

test('handler: bitta mahsulot — kartochka va "Buyurtma berish" tugmasi', async () => {
  const { sent, h } = setup({ products: normalizeResults(DB).slice(0, 1) });
  await h.handleBusinessMessage(msg());
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /<b>Kinder Bueno<\/b>\n💰 Narxi: 12 500 so'm\n✅ Mavjud/);
  assert.deepEqual(sent[0].opts.reply_markup.inline_keyboard, [
    [{ text: 'Buyurtma berish', url: 'https://t.me/shokoladchi_bot?start=product_1' }],
  ]);
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

function fakePhotos() {
  const log = { remembered: [], forgotten: [] };
  return {
    log,
    get: async (url) => `file-for-${url}`,
    remember: (url, msg) => log.remembered.push([url, msg?.photo?.at(-1)?.file_id]),
    forget: (url) => log.forgotten.push(url),
  };
}

const WITH_IMAGE = [
  { id: '7', name: 'Kinder Bueno', description: 'Yong\'oqli', price: 12500, available: true, image: 'https://api.example.com/uploads/k.webp' },
  { id: '8', name: 'Rasmsiz', description: '', price: 1000, available: true, image: null },
];

test('handler: bitta rasmli mahsulot — rasm + kartochka + tugma bitta xabarda', async () => {
  const photos = fakePhotos();
  const { sent, h } = setup({ products: WITH_IMAGE.slice(0, 1), photos });
  await h.handleBusinessMessage(msg());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].photo, 'file-for-https://api.example.com/uploads/k.webp');
  assert.equal(sent[0].opts.business_connection_id, 'bc1');
  assert.match(sent[0].opts.caption, /Kinder Bueno[\s\S]*Yong'oqli[\s\S]*12 500 so'm/);
  assert.equal(sent[0].opts.reply_markup.inline_keyboard[0][0].url, 'https://t.me/shokoladchi_bot?start=product_7');
  assert.deepEqual(photos.log.remembered, [['https://api.example.com/uploads/k.webp', 'fid-1']]);
});

test('handler: 2 ta mahsulot, 1 ta rasm — rasm ostida ro\'yxat va tugmalar', async () => {
  const photos = fakePhotos();
  const { sent, h } = setup({ products: WITH_IMAGE, photos });
  await h.handleBusinessMessage(msg());
  assert.equal(sent.length, 1);
  assert.match(sent[0].opts.caption, /1\. <b>Kinder Bueno<\/b>[\s\S]*2\. <b>Rasmsiz<\/b>/);
  assert.deepEqual(sent[0].opts.reply_markup.inline_keyboard, ONE_BOT_BUTTON);
});

const ALBUM = ['1', '2', '3'].map((id) => ({
  id, name: `Kinder ${id}`, description: '', price: 1000 * Number(id), available: true, image: `https://api.example.com/uploads/${id}.webp`,
}));

test('handler: bir nechta rasm — albom, keyin ro\'yxat va tugmalar', async () => {
  const photos = fakePhotos();
  const { sent, h } = setup({ products: ALBUM, photos });
  await h.handleBusinessMessage(msg());
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].media.map((m) => m.media), ALBUM.map((p) => `file-for-${p.image}`));
  assert.ok(sent[0].media.every((m) => m.type === 'photo'));
  assert.equal(sent[0].opts.business_connection_id, 'bc1');
  assert.match(sent[1].text, /1\. <b>Kinder 1<\/b>[\s\S]*3\. <b>Kinder 3<\/b> — 3 000 so'm/);
  assert.deepEqual(sent[1].opts.reply_markup.inline_keyboard, ONE_BOT_BUTTON);
  assert.deepEqual(photos.log.remembered.map((r) => r[1]), ['album-0', 'album-1', 'album-2']);
});

test('handler: albom yuborilmasa ham ro\'yxat va tugmalar boradi; yuklanmagan rasm tashlab ketiladi', async () => {
  const photos = fakePhotos();
  const err = Object.assign(new Error('x'), { error_code: 400, description: 'Bad Request: MEDIA_INVALID' });
  const r1 = setup({ products: ALBUM, photos, photoError: err });
  await r1.h.handleBusinessMessage(msg());
  assert.equal(r1.sent.length, 1);
  assert.match(r1.sent[0].text, /Topilgan mahsulotlar/);
  assert.deepEqual(r1.sent[0].opts.reply_markup.inline_keyboard, ONE_BOT_BUTTON);

  const broken = { ...fakePhotos(), get: async (url) => { if (url.endsWith('2.webp')) throw new Error('404'); return `ok-${url}`; } };
  const r2 = setup({ products: ALBUM, photos: broken });
  await r2.h.handleBusinessMessage(msg());
  assert.equal(r2.sent[0].media.length, 2);
  assert.deepEqual(r2.sent[1].opts.reply_markup.inline_keyboard, ONE_BOT_BUTTON);
});

test('handler: rasm yuborilmasa matn + tugma yuboriladi', async () => {
  const photos = fakePhotos();
  const err = Object.assign(new Error('x'), { error_code: 400, description: 'Bad Request: IMAGE_PROCESS_FAILED' });
  const { sent, h } = setup({ products: WITH_IMAGE.slice(0, 1), photos, photoError: err });
  await h.handleBusinessMessage(msg());
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Kinder Bueno/);
  assert.equal(sent[0].opts.reply_markup.inline_keyboard[0][0].text, 'Buyurtma berish');
  assert.deepEqual(photos.log.forgotten, ['https://api.example.com/uploads/k.webp']);
});

test('handler: tugma rad etilsa havola matnda yuboriladi', async () => {
  const err = Object.assign(new Error('x'), { error_code: 400, description: 'Bad Request: BUTTON_TYPE_INVALID' });
  const { sent, h } = setup({ products: normalizeResults(DB).slice(0, 1), apiError: err });
  await h.handleBusinessMessage(msg());
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /href="https:\/\/t\.me\/shokoladchi_bot\?start=product_1">Buyurtma berish/);
});
