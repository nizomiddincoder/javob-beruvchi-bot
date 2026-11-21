/**
 * Sozlamalar faqat environment variable'lardan o'qiladi. Kodda hech qanday maxfiy qiymat yo'q.
 */

const REQUIRED = ['BOT_TOKEN', 'SEARCH_API_URL', 'SEARCH_API_KEY', 'ADMIN_CHAT_ID', 'BUYURTMA_BOT_USERNAME'];

function intEnv(env, name, fallback, min, max) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} ${min}..${max} oralig'idagi butun son bo'lishi kerak`);
  }
  return n;
}

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((k) => !env[k]?.trim());
  if (missing.length) {
    throw new Error(`Quyidagi environment variable'lar o'rnatilmagan: ${missing.join(', ')}`);
  }

  const searchApiUrl = env.SEARCH_API_URL.trim().replace(/\/+$/, '');
  try {
    const u = new URL(searchApiUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
  } catch {
    throw new Error('SEARCH_API_URL to\'liq manzil bo\'lishi kerak, masalan: https://api.example.com');
  }

  const adminChatId = env.ADMIN_CHAT_ID.trim();
  if (!/^-?\d+$/.test(adminChatId)) {
    throw new Error('ADMIN_CHAT_ID raqam bo\'lishi kerak (guruh bo\'lsa -100... bilan boshlanadi)');
  }

  const orderBotUsername = env.BUYURTMA_BOT_USERNAME.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(orderBotUsername)) {
    throw new Error('BUYURTMA_BOT_USERNAME noto\'g\'ri (masalan: shokoladchi_bot)');
  }

  return {
    botToken: env.BOT_TOKEN.trim(),
    searchApiUrl,
    searchApiKey: env.SEARCH_API_KEY.trim(),
    adminChatId,
    orderBotUsername,
    // Ixtiyoriy sozlamalar (qiymat berilmasa — standart)
    maxResults: intEnv(env, 'MAX_RESULTS', 5, 1, 10),
    operatorReplyCooldownSec: intEnv(env, 'OPERATOR_REPLY_COOLDOWN_SECONDS', 300, 0, 86400),
    // Salomlashish bir mijozga necha soniyada bir marta (standart 12 soat; 0 — har bir xabarga)
    greetingCooldownSec: intEnv(env, 'GREETING_COOLDOWN_SECONDS', 43200, 0, 604800),
    searchTimeoutMs: intEnv(env, 'SEARCH_TIMEOUT_MS', 8000, 1000, 60000),
    // Claude API (ixtiyoriy): kalit bo'lsa — xabarlar Claude bilan tahlil qilinadi, bo'lmasa oddiy qoidalar
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    claudeModel: env.CLAUDE_MODEL?.trim() || 'claude-opus-5-5',
    claudeTimeoutMs: intEnv(env, 'CLAUDE_TIMEOUT_MS', 20000, 3000, 120000),
  };
}
