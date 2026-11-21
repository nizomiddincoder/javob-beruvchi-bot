import sharp from 'sharp';
import { InputFile } from 'grammy';

/**
 * Mahsulot rasmini Telegram'ga yuborish uchun tayyorlaydi.
 *
 * Buyurtma loyihasidagi rasmlar WebP formatida — Telegram ularni "rasm" sifatida ishonchli qabul qilmaydi.
 * Shuning uchun rasm yuklab olinadi, JPEG'ga o'giriladi va yuklanadi. Telegram qaytargan file_id
 * eslab qolinadi — keyingi safar o'sha rasm qayta yuklanmaydi.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_CACHE = 2000;

export function createPhotoSource({ allowedOrigin, timeoutMs = 10000, fetchImpl = globalThis.fetch }) {
  const fileIds = new Map();

  async function download(url) {
    if (new URL(url).origin !== allowedOrigin) throw new Error('rasm boshqa serverda');
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`rasm ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('rasm juda katta');
    return sharp(buf)
      .rotate()
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  return {
    /** file_id (avval yuborilgan bo'lsa) yoki yuklanadigan JPEG fayl */
    async get(url) {
      const cached = fileIds.get(url);
      if (cached) return cached;
      return new InputFile(await download(url), 'mahsulot.jpg');
    },
    /** sendPhoto javobidan file_id ni eslab qoladi */
    remember(url, sentMessage) {
      const fileId = sentMessage?.photo?.at(-1)?.file_id;
      if (!fileId) return;
      if (fileIds.size >= MAX_CACHE) fileIds.delete(fileIds.keys().next().value);
      fileIds.set(url, fileId);
    },
    forget(url) {
      fileIds.delete(url);
    },
  };
}
