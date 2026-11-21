import { OPERATOR_REPLY, ORDER_BUTTON, adminText, orderUrl, productText } from './format.js';

/**
 * business_message ishlovchisi. Telegram API va qidiruv tashqaridan beriladi — test qilish oson.
 *
 * @param {object} deps
 * @param {{ sendMessage: Function }} deps.api       grammY bot.api (yoki test uchun soxta obyekt)
 * @param {Function} deps.searchProducts             (text) => Promise<Product[]>
 * @param {object} deps.config                       loadConfig() natijasi
 */
export function createHandlers({ api, searchProducts, config, logger = console, now = () => Date.now() }) {
  // Bir mijozga "Operator tez orada javob beradi" ni ketma-ket ko'p marta yubormaslik uchun
  const lastOperatorReply = new Map();

  function operatorReplyAllowed(chatId) {
    const cooldownMs = config.operatorReplyCooldownSec * 1000;
    if (!cooldownMs) return true;
    const t = now();
    const last = lastOperatorReply.get(chatId);
    if (last !== undefined && t - last < cooldownMs) return false;
    lastOperatorReply.set(chatId, t);
    if (lastOperatorReply.size > 5000) {
      for (const [id, ts] of lastOperatorReply) if (t - ts >= cooldownMs) lastOperatorReply.delete(id);
    }
    return true;
  }

  async function sendProduct(chatId, businessConnectionId, p) {
    const url = orderUrl(config.orderBotUsername, p.id);
    const base = { business_connection_id: businessConnectionId, parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    try {
      await api.sendMessage(chatId, productText(p), {
        ...base,
        reply_markup: { inline_keyboard: [[{ text: ORDER_BUTTON, url }]] },
      });
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

    logger.info(`chat ${chatId}: mahsulot topilmadi${searchFailed ? ' (qidiruv xatosi)' : ''}`);
    if (operatorReplyAllowed(chatId)) {
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
