/**
 * Mahsulot qidiruvi — faqat tashqi qidiruv API orqali (GET {SEARCH_API_URL}/search?q=...).
 * Bazaga to'g'ridan-to'g'ri ulanilmaydi.
 *
 * Kutilgan javob: [{ "id": 12, "name": "Kinder Bueno", "price": 12500, "available": true }, ...]
 */

export class SearchError extends Error {}

// Mijoz xabaridagi mahsulotga aloqasi yo'q so'zlar ("salom, kinder bormi?" -> "kinder")
const STOPWORDS = new Set(
  [
    // o'zbekcha
    'salom', 'assalomu', 'assalom', 'alaykum', 'aleykum', 'hayrli', 'xayrli', 'kun', 'kech', 'tong', 'qalay',
    'yaxshimisiz', 'bormi', 'bor', "yo'q", 'yoq', 'narxi', 'narx', 'narhi', 'qancha', 'qanchadan', 'qanchaga',
    'necha', 'nechpul', 'nechi', 'kerak', 'kere', 'menga', 'sizda', 'sizlarda', 'iltimos', 'rahmat',
    'raxmat', 'nima', 'qachon', 'qayerda', 'qayerdan', 'uchun', 'bilan', 'ekan', 'edi', 'mumkinmi', 'mumkin',
    'olsam', 'olmoqchiman', 'olaman', 'beraman', 'berasizmi', 'bering', 'buyurtma', 'dostavka', 'yetkazib',
    'yetkazish', 'yana', 'hamma', 'qaysi', 'sotasizmi', 'sotiladimi', 'shu', 'ham', 'dona', 'aka', 'opa',
    // buyurtma / xohish so'zlari ("kinder buyurtma qilmoqchiman" -> "kinder")
    'buyurtmaga', 'buyurtmani', 'zakaz', 'zakazga', 'qilmoqchiman', 'qilmoqchi', 'qilaman', 'qilsam',
    'qilsa', 'qilib', 'bermoqchiman', 'bermoqchi', 'olmoqchi', 'olib', 'sotib', 'xarid', 'kerakmi', 'xohlayman',
    'hohlayman', 'istayman', "bo'ladimi", 'boladimi', 'bizga', 'bering', 'yuboring', 'jonatib', "jo'nating",
    // ruscha
    'привет', 'здравствуйте', 'добрый', 'день', 'вечер', 'утро', 'есть', 'сколько', 'стоит', 'цена', 'цены',
    'нужно', 'нужен', 'нужна', 'можно', 'пожалуйста', 'спасибо', 'вас', 'это', 'хочу', 'купить', 'заказать',
    'доставка', 'какие', 'какой', 'почем', 'почём', 'заказ', 'заказа', 'взять', 'мне', 'нам', 'хотим',
  ].map((w) => w.replace(/[‘’ʻʼ`]/g, "'")),
);

const MAX_QUERY_LENGTH = 100;
const MAX_WORD_QUERIES = 4;

function normalizeApostrophes(s) {
  return s.replace(/[‘’ʻʼ`]/g, "'");
}

/** Xabardan qidiruv uchun so'zlar (3+ harf, stop-so'zlarsiz, takrorsiz) */
export function keywords(text) {
  const words = normalizeApostrophes(String(text || '').toLowerCase())
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

/**
 * Qidiruv bosqichlari: avval butun matn, keyin kalit so'zlar birga, keyin har bir so'z alohida.
 * Biror bosqichda natija chiqsa — keyingisiga o'tilmaydi. Oxirgi bosqich so'zlari natijalari birlashtiriladi
 * ("snickers va twix bormi" -> snickers + twix).
 */
export function buildQueries(text) {
  const full = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
  if (!full) return [];
  const kw = keywords(full);
  const stages = [[full]];
  if (kw.length) stages.push([kw.join(' ')]);
  if (kw.length > 1) stages.push(kw.slice(0, MAX_WORD_QUERIES));
  // Bir xil so'rovni ikki marta yubormaslik
  const seen = new Set();
  return stages
    .map((stage) =>
      stage.filter((q) => {
        const key = q.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    )
    .filter((stage) => stage.length);
}

/** "/uploads/a.webp" -> "https://api.example.com/uploads/a.webp"; faqat http(s) */
function absoluteImageUrl(raw, baseUrl) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim(), baseUrl);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * API javobini tekshirib, toza ro'yxatga aylantiradi. Noto'g'ri yozuvlar tashlab yuboriladi.
 * Ixtiyoriy maydonlar: image (to'liq yoki "/uploads/..." ko'rinishidagi manzil), description.
 */
export function normalizeResults(data, baseUrl = 'http://localhost') {
  const list = Array.isArray(data) ? data : data?.items ?? data?.results ?? data?.products ?? [];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const id = typeof it.id === 'number' ? String(it.id) : typeof it.id === 'string' ? it.id.trim() : '';
    // Telegram start parametri: faqat A-Z a-z 0-9 _ -, "product_" bilan birga 64 belgigacha
    if (!/^[A-Za-z0-9_-]{1,56}$/.test(id)) continue;
    const name = typeof it.name === 'string' ? it.name.trim() : '';
    if (!name) continue;
    const priceNum = typeof it.price === 'number' ? it.price : typeof it.price === 'string' ? Number(it.price) : NaN;
    out.push({
      id,
      name,
      price: Number.isFinite(priceNum) ? priceNum : null,
      available: typeof it.available === 'boolean' ? it.available : null,
      image: absoluteImageUrl(it.image, baseUrl),
      description: typeof it.description === 'string' ? it.description.trim() : '',
    });
  }
  return out;
}

export function createSearch({ apiUrl, apiKey, timeoutMs, maxResults, fetchImpl = globalThis.fetch }) {
  // SEARCH_API_URL bazaviy manzil; agar oxirida /search bo'lsa — qayta qo'shilmaydi
  const endpoint = /\/search$/i.test(apiUrl) ? apiUrl : `${apiUrl}/search`;

  async function query(q) {
    const url = new URL(endpoint);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(maxResults));
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new SearchError(`Qidiruv API'ga ulanib bo'lmadi: ${e?.name === 'TimeoutError' ? 'vaqt tugadi' : e?.message}`);
    }
    if (!res.ok) throw new SearchError(`Qidiruv API ${res.status} qaytardi`);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new SearchError('Qidiruv API JSON qaytarmadi');
    }
    return normalizeResults(data, endpoint);
  }

  /** Mijoz matni bo'yicha mahsulotlar (maxResults tagacha, takrorsiz) */
  return async function searchProducts(text) {
    const found = new Map();
    for (const stage of buildQueries(text)) {
      for (const q of stage) {
        for (const p of await query(q)) {
          if (!found.has(p.id)) found.set(p.id, p);
        }
        if (found.size >= maxResults) break;
      }
      if (found.size) break;
    }
    return [...found.values()].slice(0, maxResults);
  };
}
