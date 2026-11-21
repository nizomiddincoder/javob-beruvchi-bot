import { OPERATOR_REPLY, ORDER_BUTTON, adminText, orderUrl, productText } from './format.js';
import { matchRules } from './rules.js';

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
  logger = console,
  now = () => Date.now(),
}) {
  // Bir mijozga bir xil tayyor javobni (operator javobi yoki qoida) ketma-ket ko'p marta yubormaslik uchun
  const lastReply = new Map();

  function replyAllowed(chatId, key) {
    const cooldownMs = config.operatorReplyCooldownSec * 1000;
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

  async function sendProduct(chatId, businessConnectionId, p) {
    const url = orderUrl(config.orderBotUsername, p.id);
    const reply_markup = { inline_keyboard: [[{ text: ORDER_BUTTON, url }]] };

    // Rasm bo'lsa — rasm + izoh + tugma. Rasm yuborilmasa — pastdagi matnli variant
    if (p.image && photos) {
      try {
        const photo = await photos.get(p.image);
        const sent = await api.sendPhoto(chatId, photo, {
          business_connection_id: businessConnectionId,
          caption: productText(p),
          parse_mode: 'HTML',
          reply_markup,
        });
        photos.remember(p.image, sent);
        return;
      } catch (e) {
        photos.forget(p.image);
        logger.warn(`Rasm yuborilmadi (mahsulot ${p.id}): ${e?.description ?? e?.message ?? e}. Matn yuboriladi`);
      }
    }

    const base = { business_connection_id: businessConnectionId, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    try {
      await api.sendMessage(chatId, productText(p), { ...base, reply_markup });
    } catch (e) {
      // Ehtiyot chorasi: tugma rad etilsa — havolani matn ichida yuboramiz
      if (e?.error_code === 400 && /button|markup|keyboard/i.test(e?.description ?? '')) {
        logger.warn(`Tugma rad etildi (${e.description}), havola matnda yuboriladi`);
        await api.sendMessage(chatId, `${productText(p)}\n\n<a href="${url}">${ORDER_BUTTON}</a>`, base);
      } else {
        throw e;
      }
    }
  }

  async function handleBusinessMessage(msg) {
    if (!msg?.business_connection_id || msg.chat?.type !== 'private') return;
    // Faqat mijoz yozgan xabarlar: biznes egasining o'zi yoki bot yozganlari javobsiz qoladi
    if (!msg.from || msg.from.is_bot || msg.from.id !== msg.chat.id || msg.sender_business_bot) return;

    const text = (msg.text ?? msg.caption ?? '').trim();
    if (!text) return; // stiker, ovozli xabar va h.k. — operator o'zi ko'radi

    const chatId = msg.chat.id;
    const bcId = msg.business_connection_id;

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
      for (const p of products) await sendProduct(chatId, bcId, p);
      return;
    }

    // 3. Qoida ham, mahsulot ham topilmadi — operator javobi
    if (rules.length) return;
    logger.info(`chat ${chatId}: javob topilmadi${searchFailed ? ' (qidiruv xatosi)' : ''}`);
    if (replyAllowed(chatId, 'operator')) {
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
