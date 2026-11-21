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
 */
export function createHandlers({
  api,
  searchProducts,
  config,
  photos = null,
  getRules = () => [],
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

    // 1. Tayyor javoblar (javoblar.json): yetkazib berish, manzil, ish vaqti va h.k.
    const rules = matchRules(getRules(), text);
    for (const r of rules) {
      if (!replyAllowed(chatId, `rule:${r.id}`)) continue;
      logger.info(`chat ${chatId}: qoida "${r.name}"`);
      await api.sendMessage(chatId, r.answer, { business_connection_id: bcId, link_preview_options: { is_disabled: true } });
    }

    // 2. Mahsulot qidiruvi
    let products = [];
    let searchFailed = false;
    try {
      products = await searchProducts(text);
    } catch (e) {
      searchFailed = true;
      logger.error(`Qidiruv xatosi (chat ${chatId}): ${e?.message ?? e}`);
    }

    if (products.length) {
      logger.info(`chat ${chatId}: ${products.length} ta mahsulot yuborilmoqda`);
      await sendProducts(chatId, bcId, products);
      return;
    }

    if (rules.length) return;

    // 3. "Buyurtma bermoqchiman", lekin mahsulot nomi yo'q — nomini so'raymiz + buyurtma botiga tugma
    if (!searchFailed && isOrderIntent(text)) {
      if (replyAllowed(chatId, 'order')) {
        logger.info(`chat ${chatId}: buyurtma niyati, mahsulot nomi so'raldi`);
        await sendTextWithButtons(chatId, bcId, ORDER_PROMPT, [{ text: ORDER_BUTTON, url: botUrl(config.orderBotUsername) }]);
      }
      return;
    }

    // 4. Hech narsa topilmadi — "Tushunarli! Hozir aniqini bilib beraman" va savol adminga
    logger.info(`chat ${chatId}: javob topilmadi${searchFailed ? ' (qidiruv xatosi)' : ''}`);
    // Hozirgina salomlashib "qanday yordam bera olaman?" deb so'ralgan bo'lsa — bu javob ortiqcha
    if (!greeted && replyAllowed(chatId, 'operator')) {
      try {
        await api.sendMessage(chatId, OPERATOR_REPLY, { business_connection_id: bcId });
      } catch (e) {
        logger.error(`Mijozga javob yuborilmadi (chat ${chatId}): ${e?.description ?? e?.message ?? e}`);
      }
    }
    await api.sendMessage(config.adminChatId, adminText({ from: msg.from, text, searchFailed }), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  return { handleBusinessMessage };
}
