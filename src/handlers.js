import {
  OPERATOR_REPLY,
  ORDER_BUTTON,
  ORDER_PROMPT,
  adminText,
  botUrl,
  greetingText,
  escapeHtml,
  orderUrl,
  productListText,
  productText,
} from './format.js';
import { isOrderIntent, matchRules } from './rules.js';

/**
 * business_message ishlovchisi. Telegram API va qidiruv tashqaridan beriladi — test qilish oson.
 *
 * @param {object} deps
 * @param {{ sendMessage: Function }} deps.api       grammY bot.api (yoki test uchun soxta obyekt)
 * @param {Function} deps.searchProducts             (text) => Promise<Product[]>
 * @param {object} deps.config                       loadConfig() natijasi
 * @param {object} [deps.photos]                     createPhotoSource() — bo'lmasa rasmlar yuborilmaydi
 * @param {Function} [deps.getRules]                 () => qoidalar (javoblar.json)
 * @param {Function} [deps.analyze]                  createAnalyzer() — Claude; bo'lmasa oddiy qoidalar
 */
export function createHandlers({
  api,
  searchProducts,
  config,
  photos = null,
  getRules = () => [],
  analyze = null,
  greet = true,
  logger = console,
  now = () => Date.now(),
}) {
  // Bir mijozga bir xil tayyor javobni (operator javobi yoki qoida) ketma-ket ko'p marta yubormaslik uchun
  const lastReply = new Map();

  function replyAllowed(chatId, key, cooldownSec = config.operatorReplyCooldownSec) {
    const cooldownMs = cooldownSec * 1000;
    if (!cooldownMs) return true;
    const t = now();
    const mapKey = `${chatId}:${key}`;
    const last = lastReply.get(mapKey);
    if (last !== undefined && t - last < cooldownMs) return false;
    lastReply.set(mapKey, t);
    if (lastReply.size > 5000) {
      for (const [k, ts] of lastReply) if (t - ts >= cooldownMs) lastReply.delete(k);
    }
    return true;
  }

  const errText = (e) => e?.description ?? e?.message ?? e;

  /** Rasmlarni tayyorlaydi (yuklab olish/JPEG). Tayyorlanmaganlari tashlab yuboriladi */
  async function preparePhotos(products) {
    if (!photos) return [];
    const withImage = products.filter((p) => p.image).slice(0, 10);
    const results = await Promise.allSettled(withImage.map((p) => photos.get(p.image)));
    const ready = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') ready.push({ url: withImage[i].image, media: r.value });
      else logger.warn(`Rasm tayyorlanmadi (mahsulot ${withImage[i].id}): ${errText(r.reason)}`);
    });
    return ready;
  }

  /** Matn + tugmalar. Tugmalar rad etilsa — havolalar matn ichida */
  async function sendTextWithButtons(chatId, bcId, text, buttons) {
    const base = { business_connection_id: bcId, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    try {
      await api.sendMessage(chatId, text, { ...base, reply_markup: { inline_keyboard: buttons.map((b) => [b]) } });
    } catch (e) {
      if (e?.error_code === 400 && /button|markup|keyboard/i.test(e?.description ?? '')) {
        logger.warn(`Tugma rad etildi (${e.description}), havolalar matnda yuboriladi`);
        const links = buttons.map((b) => `<a href="${b.url}">${escapeHtml(b.text)}</a>`).join('\n');
        await api.sendMessage(chatId, `${text}\n\n${links}`, base);
      } else {
        throw e;
      }
    }
  }

  /**
   * Topilgan mahsulotlarni yuborish:
   * - bitta mahsulot: rasm + kartochka (nomi, tavsifi, narxi) + "Buyurtma berish" tugmasi;
   * - bir nechta: rasmlar albom bo'lib, ostidan ro'yxat (nomi, narxi, mavjudligi) va bitta "Buyurtma berish"
   *   tugmasi (buyurtma botini ochadi).
   * Telegram albomga tugma qo'shishga ruxsat bermaydi, shuning uchun ro'yxat albomdan keyingi xabarda.
   */
  async function sendProducts(chatId, bcId, products) {
    const single = products.length === 1;
    const text = single ? productText(products[0]) : productListText(products);
    // Bitta tugma: bitta mahsulot bo'lsa — o'sha mahsulotga, ro'yxat bo'lsa — buyurtma botiga
    const buttons = [
      { text: ORDER_BUTTON, url: single ? orderUrl(config.orderBotUsername, products[0].id) : botUrl(config.orderBotUsername) },
    ];

    const ready = await preparePhotos(products);

    // Bitta rasm va matn rasm izohiga sig'sa — hammasi bitta xabarda
    if (ready.length === 1 && text.length <= 1000) {
      try {
        const sent = await api.sendPhoto(chatId, ready[0].media, {
          business_connection_id: bcId,
          caption: text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons.map((b) => [b]) },
        });
        photos.remember(ready[0].url, sent);
        return;
      } catch (e) {
        photos.forget(ready[0].url);
        logger.warn(`Rasm yuborilmadi: ${errText(e)}. Matn yuboriladi`);
      }
    } else if (ready.length === 1) {
      try {
        photos.remember(ready[0].url, await api.sendPhoto(chatId, ready[0].media, { business_connection_id: bcId }));
      } catch (e) {
        photos.forget(ready[0].url);
        logger.warn(`Rasm yuborilmadi: ${errText(e)}`);
      }
    } else if (ready.length > 1) {
      try {
        const sent = await api.sendMediaGroup(
          chatId,
          ready.map((r) => ({ type: 'photo', media: r.media })),
          { business_connection_id: bcId },
        );
        ready.forEach((r, i) => photos.remember(r.url, sent?.[i]));
      } catch (e) {
        ready.forEach((r) => photos.forget(r.url));
        logger.warn(`Albom yuborilmadi: ${errText(e)}. Faqat ro'yxat yuboriladi`);
      }
    }

    await sendTextWithButtons(chatId, bcId, text, buttons);
  }

  async function handleBusinessMessage(msg) {
    if (!msg?.business_connection_id || msg.chat?.type !== 'private') return;
    // Faqat mijoz yozgan xabarlar: biznes egasining o'zi yoki bot yozganlari javobsiz qoladi
    if (!msg.from || msg.from.is_bot || msg.from.id !== msg.chat.id || msg.sender_business_bot) return;

    const text = (msg.text ?? msg.caption ?? '').trim();
    if (!text) return; // stiker, ovozli xabar va h.k. — operator o'zi ko'radi

    const chatId = msg.chat.id;
    const bcId = msg.business_connection_id;

    // 0. Salomlashish: "Assalomu alaykum, {ism}! ..." (bir mijozga GREETING_COOLDOWN_SECONDS da bir marta)
    let greeted = false;
    if (greet && replyAllowed(chatId, 'greeting', config.greetingCooldownSec)) {
      await api.sendMessage(chatId, greetingText(msg.from), { business_connection_id: bcId });
      greeted = true;
    }

    const ctx = { msg, text, chatId, bcId, greeted };
    const previous = historyOf(chatId);
    remember(chatId, 'customer', text);

    // Claude ulangan bo'lsa — xabarni Claude tahlil qiladi. Claude ishlamasa — oddiy qoidalar
    if (analyze) {
      let analysis = null;
      try {
        analysis = await analyze({ text, history: previous, faqRules: getRules() });
      } catch (e) {
        logger.error(`Claude tahlili ishlamadi (chat ${chatId}): ${errText(e)}. Oddiy qoidalar ishlatiladi`);
      }
      if (analysis) return handleWithAnalysis(ctx, analysis);
    }
    return handleWithRules(ctx);
  }

  // --- Yozishma tarixi (Claude oldingi xabarlarni tushunishi uchun; faqat xotirada) ---
  const history = new Map();
  const MAX_HISTORY = 8;

  function historyOf(chatId) {
    return history.get(chatId) ?? [];
  }

  function remember(chatId, role, text) {
    if (!analyze) return;
    const list = [...historyOf(chatId), { role, text: String(text).slice(0, 500) }].slice(-MAX_HISTORY);
    history.delete(chatId); // eng oxirgi faol chat — Map oxiriga
    history.set(chatId, list);
    if (history.size > 2000) history.delete(history.keys().next().value);
  }

  const productsSummary = (products) =>
    `mahsulotlar yuborildi: ${products.map((p) => `${p.name}${p.price != null ? ` (${p.price} so'm)` : ''}`).join(', ')}`;

  // --- Umumiy javoblar ---

  async function sendFound(ctx, products) {
    logger.info(`chat ${ctx.chatId}: ${products.length} ta mahsulot yuborilmoqda`);
    await sendProducts(ctx.chatId, ctx.bcId, products);
    remember(ctx.chatId, 'bot', productsSummary(products));
  }

  /** "Buyurtma bermoqchiman", lekin mahsulot nomi yo'q — nomini so'raymiz + buyurtma botiga tugma */
  async function sendOrderPrompt(ctx) {
    if (!replyAllowed(ctx.chatId, 'order')) return;
    logger.info(`chat ${ctx.chatId}: buyurtma niyati, mahsulot nomi so'raldi`);
    await sendTextWithButtons(ctx.chatId, ctx.bcId, ORDER_PROMPT, [{ text: ORDER_BUTTON, url: botUrl(config.orderBotUsername) }]);
    remember(ctx.chatId, 'bot', 'qaysi mahsulotni buyurtma qilmoqchi ekanini so\'radi');
  }

  async function sendText(ctx, text) {
    await api.sendMessage(ctx.chatId, text, { business_connection_id: ctx.bcId, link_preview_options: { is_disabled: true } });
    remember(ctx.chatId, 'bot', text);
  }

  /** Javob topilmadi: mijozga "Tushunarli! Hozir aniqini bilib beraman", savol — adminga */
  async function notAnswered(ctx, { searchFailed = false, ackCustomer = true } = {}) {
    logger.info(`chat ${ctx.chatId}: javob topilmadi${searchFailed ? ' (qidiruv xatosi)' : ''}`);
    // Hozirgina salomlashib "qanday yordam bera olaman?" deb so'ralgan bo'lsa — bu javob ortiqcha
    if (ackCustomer && !ctx.greeted && replyAllowed(ctx.chatId, 'operator')) {
      try {
        await api.sendMessage(ctx.chatId, OPERATOR_REPLY, { business_connection_id: ctx.bcId });
        remember(ctx.chatId, 'bot', OPERATOR_REPLY);
      } catch (e) {
        logger.error(`Mijozga javob yuborilmadi (chat ${ctx.chatId}): ${errText(e)}`);
      }
    }
    await api.sendMessage(config.adminChatId, adminText({ from: ctx.msg.from, text: ctx.text, searchFailed }), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  // --- Claude tahlili bo'yicha ---

  /** Claude topgan nomlar bo'yicha qidiruv: natijalar birlashtiriladi */
  async function searchMany(queries) {
    const found = new Map();
    let failed = false;
    for (const q of queries) {
      try {
        for (const p of await searchProducts(q)) if (!found.has(p.id)) found.set(p.id, p);
      } catch (e) {
        failed = true;
        logger.error(`Qidiruv xatosi ("${q}"): ${errText(e)}`);
      }
      if (found.size >= config.maxResults) break;
    }
    return { products: [...found.values()].slice(0, config.maxResults), failed };
  }

  async function handleWithAnalysis(ctx, a) {
    logger.info(`chat ${ctx.chatId}: Claude — ${a.intent}, qidiruv: [${a.productQueries.join(', ')}]${a.needsOperator ? ', operator kerak' : ''}`);
    let answered = false;

    // Salomlashgan bo'lsak, Claude'ning "salom"ga javobi ortiqcha
    if (a.reply && !(ctx.greeted && a.intent === 'greeting')) {
      if (a.orderButton) {
        // "Ha, albatta bor! Qandaylari kerak? ... o'zingiz ko'rib buyurtma berishingiz mumkin 👇" + tugma
        await sendTextWithButtons(ctx.chatId, ctx.bcId, escapeHtml(a.reply), [
          { text: ORDER_BUTTON, url: botUrl(config.orderBotUsername) },
        ]);
        remember(ctx.chatId, 'bot', a.reply);
      } else {
        await sendText(ctx, a.reply);
      }
      answered = true;
    }

    let searchFailed = false;
    if (a.productQueries.length) {
      const { products, failed } = await searchMany(a.productQueries);
      searchFailed = failed;
      if (products.length) {
        await sendFound(ctx, products);
        answered = true;
      }
    }

    if (!answered && (a.intent === 'order' || a.orderButton) && !searchFailed) {
      await sendOrderPrompt(ctx);
      answered = true;
    }

    // Salomlashish / rahmat — javob shart emas, adminga ham yubormaymiz
    if (!answered && a.intent === 'greeting' && !a.needsOperator) return;

    if (!answered || a.needsOperator || searchFailed) {
      await notAnswered(ctx, { searchFailed, ackCustomer: !answered });
    }
  }

  // --- Claude'siz: oddiy qoidalar ---

  async function handleWithRules(ctx) {
    // 1. Tayyor javoblar (javoblar.json): yetkazib berish, manzil, ish vaqti va h.k.
    const rules = matchRules(getRules(), ctx.text);
    for (const r of rules) {
      if (!replyAllowed(ctx.chatId, `rule:${r.id}`)) continue;
      logger.info(`chat ${ctx.chatId}: qoida "${r.name}"`);
      await sendText(ctx, r.answer);
    }

    // 2. Mahsulot qidiruvi
    let products = [];
    let searchFailed = false;
    try {
      products = await searchProducts(ctx.text);
    } catch (e) {
      searchFailed = true;
      logger.error(`Qidiruv xatosi (chat ${ctx.chatId}): ${errText(e)}`);
    }

    if (products.length) return sendFound(ctx, products);
    if (rules.length) return;

    // 3. Buyurtma niyati, mahsulot nomisiz
    if (!searchFailed && isOrderIntent(ctx.text)) return sendOrderPrompt(ctx);

    // 4. Hech narsa topilmadi
    return notAnswered(ctx, { searchFailed });
  }

  return { handleBusinessMessage };
}
