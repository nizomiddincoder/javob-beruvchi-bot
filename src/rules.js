import { readFileSync, existsSync } from 'node:fs';

/**
 * Tayyor javoblar (javoblar.json): mijoz xabarida kalit so'z bo'lsa — shu qoidaning javobi yuboriladi.
 *
 * {
 *   "qoidalar": [
 *     { "nomi": "Yetkazib berish", "kalit_sozlar": ["dostavka", "yetkazib"], "javob": "Toshkent bo'ylab ..." }
 *   ]
 * }
 *
 * Moslash: katta-kichik harf, kirill/lotin yozuvi va apostrof farqi hisobga olinmaydi.
 * Kalit so'z xabardagi so'z boshiga mos kelsa yetarli ("dostavka" -> "dostavkasi", "dostavka bormi").
 * 3 harfgacha qisqa kalit so'zlar faqat butun so'z bo'lsa mos keladi.
 */

const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', қ: 'q',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ў: 'o', ф: 'f', х: 'x', ҳ: 'h', ц: 's',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Matnni solishtirish uchun: kichik harf, lotin, apostrofsiz, so'zlar bitta bo'sh joy bilan */
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .split('')
    .map((ch) => CYR[ch] ?? ch)
    .join('')
    .replace(/[‘’ʻʼ`']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ');
}

const MAX_ANSWER = 4000;

/** JSON'ni tekshiradi; xato bo'lsa aniq sababini aytadi */
export function parseRules(data) {
  const list = data?.qoidalar;
  if (!Array.isArray(list)) throw new Error('"qoidalar" ro\'yxati topilmadi');
  return list.map((r, i) => {
    const where = `qoidalar[${i}]${r?.nomi ? ` ("${r.nomi}")` : ''}`;
    if (!r || typeof r !== 'object') throw new Error(`${where}: obyekt bo'lishi kerak`);
    if (typeof r.javob !== 'string' || !r.javob.trim()) throw new Error(`${where}: "javob" bo'sh`);
    if (r.javob.length > MAX_ANSWER) throw new Error(`${where}: "javob" ${MAX_ANSWER} belgidan uzun`);
    if (!Array.isArray(r.kalit_sozlar) || !r.kalit_sozlar.length) throw new Error(`${where}: "kalit_sozlar" bo'sh`);
    const keys = [...new Set(r.kalit_sozlar.map(normalize).filter(Boolean))];
    if (!keys.length) throw new Error(`${where}: "kalit_sozlar" da so'z yo'q`);
    return { id: i, name: String(r.nomi || `qoida ${i + 1}`), keys, answer: r.javob.trim() };
  });
}

export function loadRulesFile(path) {
  if (!existsSync(path)) return [];
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`javoblar.json o'qilmadi: ${e.message}`);
  }
  try {
    return parseRules(data);
  } catch (e) {
    throw new Error(`javoblar.json xato: ${e.message}`);
  }
}

function keyMatches(text, key) {
  const padded = ` ${text} `;
  // Qisqa so'z — faqat butun so'z; uzunroq — so'z boshi (qo'shimchalar bilan ham mos keladi)
  return key.length <= 3 ? padded.includes(` ${key} `) : padded.includes(` ${key}`);
}

// Mijoz buyurtma bermoqchi ekanini bildiruvchi so'zlar (so'z boshi bo'yicha: "buyurtma" -> "buyurtmani")
const ORDER_WORDS = ['buyurtm', 'zakaz', 'olmoqchi', 'sotib ol', 'xarid', 'oformit', 'купить', 'хочу взять'].map(normalize);

/** "Buyurtma bermoqchiman", "zakaz qilsam bo'ladimi", "заказать" ... */
export function isOrderIntent(text) {
  const t = normalize(text);
  return !!t && ORDER_WORDS.some((w) => ` ${t} `.includes(` ${w}`));
}

/** Xabarga mos qoidalar (fayldagi tartibda, eng ko'pi bilan `limit` ta) */
export function matchRules(rules, text, limit = 3) {
  const t = normalize(text);
  if (!t) return [];
  return rules.filter((r) => r.keys.some((k) => keyMatches(t, k))).slice(0, limit);
}
