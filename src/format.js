/** Javob topilmaganda mijozga (savol adminga yuboriladi) */
export const OPERATOR_REPLY = '✅ Tushunarli! Hozir sizga aniqini bilib beraman ⏳';
export const ORDER_BUTTON = 'Buyurtma berish';

/** Mijoz buyurtma bermoqchi, lekin mahsulot nomini yozmagan */
export const ORDER_PROMPT = [
  '🛒 Albatta! Qaysi mahsulotni buyurtma qilmoqchisiz?',
  '',
  '✍️ Nomini yozing — rasmi va narxini darhol yuboraman.',
  "👇 Yoki to'g'ridan-to'g'ri buyurtma bering:",
].join('\n');

/** Mijoz yozganda salomlashish (oddiy matn, HTML emas — ismni tozalash shart emas) */
export function greetingText(from) {
  const name = (from?.first_name || from?.username || '').trim();
  return [
    `Assalomu alaykum${name ? `, ${name}` : ''}! 👋`,
    '',
    '🍫 Shokoladchiga xush kelibsiz!',
    '😊 Sizga qanday yordam bera olaman?',
  ].join('\n');
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 125000 -> "125 000 so'm" */
export function formatPrice(amount) {
  if (amount == null || !Number.isFinite(amount)) return null;
  const n = Math.round(amount);
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${s} so'm`;
}

export function orderUrl(botUsername, productId) {
  return `https://t.me/${botUsername}?start=product_${productId}`;
}

// Rasm izohi (caption) Telegram'da 1024 belgigacha; tavsifni shunga sig'diramiz
const MAX_DESCRIPTION = 600;

function shorten(s, max) {
  const t = String(s || '').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Bitta mahsulot kartochkasi (HTML): nomi, tavsifi, narxi, mavjudligi */
export function productText(p) {
  const lines = [`<b>${escapeHtml(p.name)}</b>`];
  if (p.description) lines.push('', escapeHtml(shorten(p.description, MAX_DESCRIPTION)), '');
  const price = formatPrice(p.price);
  if (price) lines.push(`💰 Narxi: ${price}`);
  if (p.available === true) lines.push('✅ Mavjud');
  else if (p.available === false) lines.push('❌ Hozircha mavjud emas');
  return lines.join('\n');
}

/**
 * Bir nechta mahsulot — bitta ro'yxat (HTML):
 * 1. <b>Kinder</b> — 25 000 so'm ✅
 */
export function productListText(products) {
  const lines = products.map((p, i) => {
    const price = formatPrice(p.price);
    const status = p.available === true ? ' ✅' : p.available === false ? ' ❌ hozircha yo\'q' : '';
    return `${i + 1}. <b>${escapeHtml(p.name)}</b>${price ? ` — ${price}` : ''}${status}`;
  });
  return ['🍫 <b>Topilgan mahsulotlar:</b>', '', ...lines, '', '🛒 Buyurtma berish uchun pastdagi tugmani bosing 👇'].join('\n');
}

/** Buyurtma botining o'zi (ro'yxat ostidagi umumiy tugma uchun) */
export function botUrl(botUsername) {
  return `https://t.me/${botUsername}`;
}

const MAX_FORWARD_TEXT = 3000;

/** Adminga: mijoz xabari va kimdan kelgani */
export function adminText({ from, text, searchFailed }) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'Mijoz';
  const who = [
    `<a href="tg://user?id=${from?.id}">${escapeHtml(name)}</a>`,
    from?.username ? `@${escapeHtml(from.username)}` : null,
    `ID: <code>${from?.id}</code>`,
  ]
    .filter(Boolean)
    .join(' · ');
  const body = text.length > MAX_FORWARD_TEXT ? `${text.slice(0, MAX_FORWARD_TEXT)}…` : text;
  const title = searchFailed
    ? '⚠️ Qidiruv API ishlamadi — mijozga javob bering'
    : '🔔 Mijoz xabariga mos mahsulot topilmadi';
  return `${title}\n\n👤 ${who}\n💬 ${escapeHtml(body)}`;
}
