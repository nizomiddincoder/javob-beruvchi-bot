import { Bot, GrammyError, HttpError } from 'grammy';
import { loadConfig } from './config.js';
import { createHandlers } from './handlers.js';
import { createPhotoSource } from './images.js';
import { loadRulesFile } from './rules.js';
import { fileURLToPath } from 'node:url';
import { createSearch } from './search.js';

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`Sozlama xatosi: ${e.message}`);
  process.exit(1);
}

const bot = new Bot(config.botToken);

const searchProducts = createSearch({
  apiUrl: config.searchApiUrl,
  apiKey: config.searchApiKey,
  timeoutMs: config.searchTimeoutMs,
  maxResults: config.maxResults,
});

// Rasmlar faqat qidiruv API serveridan yuklab olinadi
const photos = createPhotoSource({ allowedOrigin: new URL(config.searchApiUrl).origin });

// Tayyor javoblar: loyiha ildizidagi javoblar.json (xato bo'lsa servis ishga tushmaydi — xato logda ko'rinadi)
let rules;
try {
  rules = loadRulesFile(fileURLToPath(new URL('../javoblar.json', import.meta.url)));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
console.log(`Tayyor javoblar: ${rules.length} ta qoida`);

const { handleBusinessMessage } = createHandlers({ api: bot.api, searchProducts, config, photos, getRules: () => rules });

// Mijoz biznes akkauntga yozgan xabar
bot.on('business_message', (ctx) => handleBusinessMessage(ctx.businessMessage));

// Biznes akkaunt ulandi / uzildi — faqat log (sozlashni tekshirish uchun)
bot.on('business_connection', (ctx) => {
  const c = ctx.businessConnection;
  const canReply = c.rights?.can_reply ?? c.can_reply ?? false;
  console.log(
    `Biznes ulanish: user ${c.user.id}, ${c.is_enabled ? 'yoqildi' : 'o\'chirildi'}, javob berish huquqi: ${canReply ? 'bor' : 'YO\'Q'}`,
  );
});

// Botning o'ziga shaxsiy yozilganda: chat ID ni ko'rsatadi (ADMIN_CHAT_ID ni topish uchun)
bot.on('message', async (ctx) => {
  const text = ctx.message.text ?? '';
  if (/^\/(start|id)(@\w+)?(\s|$)/.test(text)) {
    await ctx.reply(
      `Bu bot Telegram Business orqali mijozlarga avtomatik javob beradi.\n\nShu chat ID: <code>${ctx.chat.id}</code>`,
      { parse_mode: 'HTML' },
    );
  }
});

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error(`Telegram xatosi: ${e.description}`);
  else if (e instanceof HttpError) console.error(`Telegram'ga ulanib bo'lmadi: ${e.message}`);
  else console.error('Kutilmagan xato:', e);
});

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

await bot.start({
  allowed_updates: ['message', 'business_message', 'business_connection'],
  onStart: (me) => {
    console.log(`@${me.username} ishga tushdi (long polling)`);
    if (me.username.toLowerCase() === config.orderBotUsername.toLowerCase()) {
      console.warn(
        'DIQQAT: BOT_TOKEN buyurtma botiniki bilan bir xil. Bu servis uchun alohida bot yarating, aks holda ikki servis bir-biriga xalaqit beradi.',
      );
    }
  },
});
