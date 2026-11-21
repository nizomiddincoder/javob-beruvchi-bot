import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemPrompt, buildUserContent, createAnalyzer, parseAnalysis } from '../src/ai.js';
import { loadConfig } from '../src/config.js';
import { OPERATOR_REPLY, ORDER_PROMPT } from '../src/format.js';
import { createHandlers } from '../src/handlers.js';

const ENV = {
  BOT_TOKEN: '1:a',
  SEARCH_API_URL: 'https://api.example.com',
  SEARCH_API_KEY: 'k',
  ADMIN_CHAT_ID: '999',
  BUYURTMA_BOT_USERNAME: 'shokoladchi_bot',
};

const FAQ = [{ id: 0, name: 'Yetkazib berish', keys: ['dostavka'], answer: 'Toshkent bo\'ylab 20 000 so\'m.' }];

// --- ai.js ---

test('config: Claude ixtiyoriy, standart model', () => {
  assert.equal(loadConfig(ENV).anthropicApiKey, null);
  const c = loadConfig({ ...ENV, ANTHROPIC_API_KEY: ' sk-test ', CLAUDE_MODEL: 'claude-haiku-5-5' });
  assert.equal(c.anthropicApiKey, 'sk-test');
  assert.equal(c.claudeModel, 'claude-haiku-5-5');
  assert.equal(loadConfig({ ...ENV, ANTHROPIC_API_KEY: 'x' }).claudeModel, 'claude-opus-5-5');
});

test('parseAnalysis: tozalaydi va cheklaydi', () => {
  const a = parseAnalysis(JSON.stringify({
    intent: 'nimadir', product_queries: [' kinder ', 'kinder', '', 5, 'a', 'b', 'c', 'd'], reply: '  ok  ', needs_operator: 'ha',
  }));
  assert.deepEqual(a, { intent: 'other', productQueries: ['kinder', 'a', 'b', 'c'], reply: 'ok', needsOperator: false });
  assert.throws(() => parseAnalysis('not json'));
});

test('prompt: do\'kon ma\'lumotlari va yozishma tarixi', () => {
  assert.match(buildSystemPrompt(FAQ), /- Yetkazib berish: Toshkent bo'ylab 20 000 so'm\./);
  assert.match(buildSystemPrompt([]), /hozircha ma'lumot kiritilmagan/);
  assert.equal(
    buildUserContent('2 ta shundan', [{ role: 'customer', text: 'kinder bormi' }, { role: 'bot', text: 'mahsulotlar yuborildi: Kinder' }]),
    'Oldingi yozishma:\nMijoz: kinder bormi\nBot: mahsulotlar yuborildi: Kinder\n\nMijozning yangi xabari:\n2 ta shundan',
  );
});

test('createAnalyzer: so\'rov parametrlari va javobni o\'qish', async () => {
  let req;
  const client = {
    messages: {
      create: async (params) => {
        req = params;
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"intent":"product","product_queries":["kinder"],"reply":"","needs_operator":false}' }] };
      },
    },
  };
  const analyze = createAnalyzer({ model: 'claude-opus-5-5', client });
  const a = await analyze({ text: 'kinder bormi', history: [], faqRules: FAQ });
  assert.deepEqual(a, { intent: 'product', productQueries: ['kinder'], reply: '', needsOperator: false });
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.deepEqual(req.output_config.format.schema.required, ['intent', 'product_queries', 'reply', 'needs_operator']);
  assert.deepEqual(req.system[0].cache_control, { type: 'ephemeral' });
  assert.match(req.system[0].text, /Yetkazib berish/);
  assert.equal(req.messages[0].role, 'user');
  assert.match(req.messages[0].content, /kinder bormi/);
});

test('createAnalyzer: matn bo\'lmasa xato', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } };
  await assert.rejects(() => createAnalyzer({ model: 'm', client })({ text: 'x' }), /refusal/);
});

// --- handler + Claude ---

const KINDER = { id: '1', name: 'Kinder', price: 25000, available: true, image: null, description: '' };
const TWIX = { id: '2', name: 'Twix', price: 7000, available: true, image: null, description: '' };

function setup({ analysis = null, analyzeError = null, catalog = { kinder: [KINDER], twix: [TWIX] } } = {}) {
  const sent = [];
  const searches = [];
  const calls = [];
  const api = { sendMessage: async (chatId, text, opts) => sent.push({ chatId, text, opts }) };
  const silent = { info() {}, warn() {}, error() {} };
  const h = createHandlers({
    api,
    searchProducts: async (q) => {
      searches.push(q);
      return catalog[q.toLowerCase()] ?? [];
    },
    config: loadConfig(ENV),
    getRules: () => FAQ,
    analyze: async (input) => {
      calls.push(input);
      if (analyzeError) throw analyzeError;
      return typeof analysis === 'function' ? analysis(input) : analysis;
    },
    greet: false,
    logger: silent,
  });
  return { sent, searches, calls, h };
}

const msg = (text) => ({ business_connection_id: 'bc', chat: { id: 5, type: 'private' }, from: { id: 5, first_name: 'Ali' }, text });
const A = (o) => ({ intent: 'other', productQueries: [], reply: '', needsOperator: false, ...o });

test('Claude: mahsulot nomlari qidiriladi, natija bitta ro\'yxat; adminga xabar yo\'q', async () => {
  const { sent, searches, h } = setup({ analysis: A({ intent: 'product', productQueries: ['kinder', 'twix'] }) });
  await h.handleBusinessMessage(msg('Assalomu alaykum, menga kinder bilan twix kerak edi, bormi?'));
  assert.deepEqual(searches, ['kinder', 'twix']);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /1\. <b>Kinder<\/b>[\s\S]*2\. <b>Twix<\/b>/);
});

test('Claude: savolga do\'kon ma\'lumotidan javob; adminga xabar yo\'q', async () => {
  const { sent, h, calls } = setup({ analysis: A({ intent: 'question', reply: 'Toshkent bo\'ylab 20 000 so\'m 🚚' }) });
  await h.handleBusinessMessage(msg('dastavka bormi'));
  assert.deepEqual(sent.map((s) => [s.chatId, s.text]), [[5, 'Toshkent bo\'ylab 20 000 so\'m 🚚']]);
  assert.equal(sent[0].opts.business_connection_id, 'bc');
  assert.deepEqual(calls[0].faqRules, FAQ);
});

test('Claude: javob berdi, lekin operator kerak — adminga ham boradi, "Tushunarli" yo\'q', async () => {
  const { sent, h } = setup({ analysis: A({ intent: 'question', reply: 'Aniqlab beramiz 🙏', needsOperator: true }) });
  await h.handleBusinessMessage(msg('tort buyurtma qilsa bo\'ladimi 5 kg'));
  assert.deepEqual(sent.map((s) => s.chatId), [5, '999']);
  assert.equal(sent[0].text, 'Aniqlab beramiz 🙏');
});

test('Claude: hech narsa — "Tushunarli" va adminga', async () => {
  const { sent, h } = setup({ analysis: A({ intent: 'question', needsOperator: true }) });
  await h.handleBusinessMessage(msg('qachon ochilasizlar'));
  assert.deepEqual(sent.map((s) => s.text.slice(0, 20)), [OPERATOR_REPLY.slice(0, 20), sent[1].text.slice(0, 20)]);
  assert.equal(sent[1].chatId, '999');
});

test('Claude: mahsulot topilmasa — "Tushunarli" va adminga', async () => {
  const { sent, h } = setup({ analysis: A({ intent: 'product', productQueries: ['raffaello'] }) });
  await h.handleBusinessMessage(msg('raffaello bormi'));
  assert.equal(sent[0].text, OPERATOR_REPLY);
  assert.equal(sent[1].chatId, '999');
});

test('Claude: buyurtma, mahsulot nomisiz — nomini so\'raydi', async () => {
  const { sent, h } = setup({ analysis: A({ intent: 'order' }) });
  await h.handleBusinessMessage(msg('zakaz bermoqchi edim'));
  assert.deepEqual(sent.map((s) => s.text), [ORDER_PROMPT]);
});

test('Claude: "rahmat" — javob yoki jim, adminga yo\'q', async () => {
  const r1 = setup({ analysis: A({ intent: 'greeting', reply: 'Arzimaydi 😊' }) });
  await r1.h.handleBusinessMessage(msg('rahmat'));
  assert.deepEqual(r1.sent.map((s) => s.text), ['Arzimaydi 😊']);
  const r2 = setup({ analysis: A({ intent: 'greeting' }) });
  await r2.h.handleBusinessMessage(msg('ok'));
  assert.equal(r2.sent.length, 0);
});

test('Claude: oldingi yozishma keyingi tahlilga beriladi', async () => {
  const { h, calls } = setup({
    analysis: (input) => (input.history.length ? A({ intent: 'order', productQueries: ['kinder'] }) : A({ intent: 'product', productQueries: ['kinder'] })),
  });
  await h.handleBusinessMessage(msg('kinder bormi'));
  await h.handleBusinessMessage(msg('shundan 2 ta olaman'));
  assert.deepEqual(calls[0].history, []);
  assert.deepEqual(calls[1].history, [
    { role: 'customer', text: 'kinder bormi' },
    { role: 'bot', text: "mahsulotlar yuborildi: Kinder (25000 so'm)" },
  ]);
});

test('Claude ishlamasa — oddiy qoidalar bilan javob (butun matn qidiriladi)', async () => {
  const { sent, searches, h } = setup({ analyzeError: new Error('timeout') });
  await h.handleBusinessMessage(msg('kinder'));
  assert.deepEqual(searches, ['kinder']);
  assert.match(sent[0].text, /Kinder/);
});
