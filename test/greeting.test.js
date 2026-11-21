import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { OPERATOR_REPLY, ORDER_PROMPT, greetingText } from '../src/format.js';
import { createHandlers } from '../src/handlers.js';

const ENV = {
  BOT_TOKEN: '1:a',
  SEARCH_API_URL: 'https://api.example.com',
  SEARCH_API_KEY: 'k',
  ADMIN_CHAT_ID: '999',
  BUYURTMA_BOT_USERNAME: 'shokoladchi_bot',
};

const GREETING_ALI = "Assalomu alaykum, Ali! 👋\n\n🍫 Shokoladchiga xush kelibsiz!\n😊 Sizga qanday yordam bera olaman?";

test('greetingText: ism bilan, ismsiz', () => {
  assert.equal(greetingText({ id: 1, first_name: 'Ali', username: 'ali_99' }), GREETING_ALI);
  assert.match(greetingText({ id: 1, username: 'ali_99' }), /^Assalomu alaykum, ali_99! 👋/);
  assert.match(greetingText({ id: 1 }), /^Assalomu alaykum! 👋/);
});

function setup({ products = [], env = {} } = {}) {
  const sent = [];
  let t = 0;
  const api = { sendMessage: async (chatId, text, opts) => sent.push({ chatId, text, opts }) };
  const silent = { info() {}, warn() {}, error() {} };
  const h = createHandlers({
    api,
    searchProducts: async () => products,
    config: loadConfig({ ...ENV, ...env }),
    logger: silent,
    now: () => t,
  });
  return { sent, h, advance: (ms) => (t += ms) };
}

const msg = (text) => ({
  business_connection_id: 'bc',
  chat: { id: 5, type: 'private' },
  from: { id: 5, first_name: 'Ali' },
  text,
});

test('salomlashish: birinchi xabarga salom, operator javobi o\'rniga; adminga xabar boradi', async () => {
  const { sent, h } = setup();
  await h.handleBusinessMessage(msg('Salom'));
  assert.deepEqual(sent.map((s) => s.chatId), [5, '999']);
  assert.equal(sent[0].text, GREETING_ALI);
  assert.equal(sent[0].opts.business_connection_id, 'bc');
});

test('salomlashish: keyin mahsulotlar ro\'yxati', async () => {
  const { sent, h } = setup({ products: [{ id: '1', name: 'Kinder', price: 1000, available: true, image: null, description: '' }] });
  await h.handleBusinessMessage(msg('kinder bormi'));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].text, GREETING_ALI);
  assert.match(sent[1].text, /Kinder/);
});

test('salomlashish: 12 soatda bir marta; keyingi xabarga "Tushunarli! Hozir aniqini bilib beraman"', async () => {
  const { sent, h, advance } = setup();
  await h.handleBusinessMessage(msg('salom'));
  await h.handleBusinessMessage(msg('ertaga soat nechagacha ishlaysizlar'));
  const toCustomer = sent.filter((s) => s.chatId === 5).map((s) => s.text);
  assert.deepEqual(toCustomer, [GREETING_ALI, OPERATOR_REPLY]);
  advance(12 * 3600 * 1000);
  await h.handleBusinessMessage(msg('salom'));
  assert.equal(sent.filter((s) => s.text === GREETING_ALI).length, 2);
});

test('javob matni: emojili "Tushunarli"', () => {
  assert.equal(OPERATOR_REPLY, '✅ Tushunarli! Hozir sizga aniqini bilib beraman ⏳');
});

test('buyurtma niyati: mahsulot nomi bo\'lmasa — nomini so\'raydi va buyurtma botiga tugma', async () => {
  const { sent, h } = setup();
  await h.handleBusinessMessage(msg('salom'));
  const before = sent.length;
  await h.handleBusinessMessage(msg('Buyurtma bermoqchi edim'));
  const after = sent.slice(before);
  assert.equal(after.length, 1); // faqat mijozga; adminga xabar yo'q
  assert.equal(after[0].chatId, 5);
  assert.equal(after[0].text, ORDER_PROMPT);
  assert.equal(after[0].opts.business_connection_id, 'bc');
  assert.deepEqual(after[0].opts.reply_markup.inline_keyboard, [[{ text: 'Buyurtma berish', url: 'https://t.me/shokoladchi_bot' }]]);
});

test('buyurtma niyati: mahsulot nomi bo\'lsa — darhol mahsulot', async () => {
  const { sent, h } = setup({ products: [{ id: '1', name: 'Kinder', price: 1000, available: true, image: null, description: '' }] });
  await h.handleBusinessMessage(msg('salom'));
  const before = sent.length;
  await h.handleBusinessMessage(msg('Kinder buyurtma qilmoqchiman'));
  const after = sent.slice(before);
  assert.equal(after.length, 1);
  assert.match(after[0].text, /Kinder/);
  assert.notEqual(after[0].text, ORDER_PROMPT);
});

test('salomlashish: GREETING_COOLDOWN_SECONDS=0 — har bir xabarga', async () => {
  const { sent, h } = setup({ env: { GREETING_COOLDOWN_SECONDS: '0' } });
  await h.handleBusinessMessage(msg('a'));
  await h.handleBusinessMessage(msg('b'));
  assert.equal(sent.filter((s) => s.text === GREETING_ALI).length, 2);
});
