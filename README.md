# Telegram Business auto-reply boti

Mijoz biznes akkauntingizga yozganda bot uning matnini qidiruv API'ga yuboradi va:

- **mahsulot topilsa** — har bir mahsulotni alohida xabar qilib yuboradi: nomi, narxi, mavjudligi va
  `Buyurtma berish` tugmasi (`https://t.me/<BUYURTMA_BOT_USERNAME>?start=product_<ID>`);
- **hech narsa topilmasa** — mijozga "Operator tez orada javob beradi" deb yozadi va mijoz xabarini
  `ADMIN_CHAT_ID` ga yuboradi.

Bot bazaga ulanmaydi va AI ishlatmaydi — faqat `GET {SEARCH_API_URL}/search?q=...` (sarlavha: `X-API-Key`).

## Qanday ishlaydi

- Faqat mijoz yozgan matnli xabarlarga (yoki rasm izohiga) javob beradi. Biznes egasining o'zi yozgan
  xabarlar, stiker va ovozli xabarlar javobsiz qoladi.
- "Salom, kinder bormi?" kabi xabarlarda avval butun matn qidiriladi, topilmasa "salom", "bormi" kabi
  so'zlarsiz qayta qidiriladi, keyin har bir so'z alohida qidiriladi.
- Bitta xabarga eng ko'pi bilan `MAX_RESULTS` (standart 5) ta mahsulot yuboriladi.
- "Operator tez orada javob beradi" bir mijozga 5 daqiqada bir martadan ko'p yuborilmaydi
  (`OPERATOR_REPLY_COOLDOWN_SECONDS`). Adminga esa har bir topilmagan xabar boradi.
- Qidiruv API ishlamay qolsa ham mijozga operator javobi yuboriladi, adminga esa "Qidiruv API ishlamadi" deb boradi.

## Railway'ga qo'yish

### 1. Yangi bot yarating

1. [@BotFather](https://t.me/BotFather) → `/newbot` → token oling. **Buyurtma botining tokenini ishlatmang** —
   ikki servis bir token bilan ishlay olmaydi.
2. BotFather → `/mybots` → yangi bot → **Bot Settings → Business Mode → Turn on**.

### 2. Botni biznes akkauntga ulang (Telegram Premium kerak)

Telegram → **Settings → Telegram Business → Chatbots** → bot username'ini kiriting → qaysi chatlarga
ruxsat berishni tanlang va **"Reply to messages" (xabarlarga javob berish)** ruxsatini yoqing.

### 3. Railway servisini yarating

1. Bu papkani GitHub'ga alohida repozitoriy qilib joylang (buyurtma loyihasidan alohida).
2. Railway → **New Project → Deploy from GitHub repo** → shu repozitoriyni tanlang.
   Railway Node.js'ni o'zi aniqlaydi va `npm start` bilan ishga tushiradi. Domen kerak emas (bot long polling bilan ishlaydi).
3. Servis → **Variables → Raw Editor** → `.env.example` dagi nomlar bo'yicha qiymatlarni kiriting:
   `BOT_TOKEN`, `SEARCH_API_URL`, `SEARCH_API_KEY`, `ADMIN_CHAT_ID`, `BUYURTMA_BOT_USERNAME`.
   - `SEARCH_API_URL` — qidiruv API'ning manzili, oxirida `/search` siz. API shu Railway loyihasida bo'lsa,
     uning public domenini (`https://....up.railway.app`) yozing.
   - `SEARCH_API_KEY` — qidiruv API servisidagi `SEARCH_API_KEY` bilan bir xil qiymat.
4. **Settings → Replicas** — 1 ta bo'lsin (bir token bilan bir nechta nusxa ishlamaydi).

### 4. ADMIN_CHAT_ID ni topish

Deploydan keyin botga shaxsiy `/start` yozing — u sizning chat ID'ingizni ko'rsatadi. Guruhga yuborish
kerak bo'lsa, botni guruhga qo'shib `/id` yozing (ID `-100...` bilan boshlanadi). Qiymatni Railway
Variables'ga kiriting — servis o'zi qayta ishga tushadi.

> Shaxsiy chat bo'lsa, admin botga kamida bir marta `/start` yozgan bo'lishi shart, aks holda bot unga yoza olmaydi.

### 5. Tekshirish

Railway → **Deployments → View Logs** da quyidagilar chiqishi kerak:

```
@sizning_bot ishga tushdi (long polling)
Biznes ulanish: user ..., yoqildi, javob berish huquqi: bor
```

(Ikkinchi qator biznes akkauntni ulaganingizda yoki qayta ulaganingizda chiqadi.) Keyin boshqa akkauntdan
biznes akkauntingizga mahsulot nomini yozib ko'ring.

Agar loglarda `Sozlama xatosi: ...` chiqsa — qaysi o'zgaruvchi yetishmayotgani yozilgan bo'ladi.

## Lokal ishga tushirish

```powershell
npm install
npm test
```

Botni lokal ishga tushirish uchun environment variable'larni o'rnatib `npm start` qiling. Railway'dagi
nusxa ishlab turgan paytda bir xil token bilan lokal ishga tushirmang.
