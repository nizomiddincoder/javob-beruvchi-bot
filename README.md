# Telegram Business auto-reply boti

Mijoz biznes akkauntingizga yozganda bot uning matnini qidiruv API'ga yuboradi va:

- **bir nechta mahsulot topilsa** — rasmlarini albom qilib yuboradi, ostidan bitta xabarda ro'yxat
  (nomi, narxi, mavjudligi) va bitta `Buyurtma berish` tugmasi — u buyurtma botini ochadi
  (`https://t.me/<BUYURTMA_BOT_USERNAME>`). Telegram albomga tugma qo'shishga ruxsat bermaydi, shuning uchun
  ro'yxat albomdan keyingi xabarda keladi;
- **bitta mahsulot topilsa** — bitta xabar: rasmi, nomi, tavsifi, narxi, mavjudligi va `Buyurtma berish` tugmasi,
  u buyurtma botida shu mahsulotni ochadi (`https://t.me/<BUYURTMA_BOT_USERNAME>?start=product_<ID>`);
- **mijoz buyurtma bermoqchi, lekin mahsulot nomini yozmagan** ("buyurtma bermoqchiman", "zakaz qilsam") —
  mahsulot nomini so'raydi va buyurtma botiga `Buyurtma berish` tugmasini beradi;
- **hech narsa topilmasa** — mijozga "✅ Tushunarli! Hozir sizga aniqini bilib beraman ⏳" deb yozadi va
  mijoz xabarini `ADMIN_CHAT_ID` ga yuboradi.

Bot bazaga ulanmaydi va AI ishlatmaydi — faqat `GET {SEARCH_API_URL}/search?q=...` (sarlavha: `X-API-Key`).

## Qidiruv API javobi

```json
[{ "id": 12, "name": "Kinder Bueno", "price": 12500, "available": true,
   "image": "/uploads/products/abc.webp", "description": "Yong'oqli sutli shokolad" }]
```

`image` va `description` ixtiyoriy. `image` bo'lsa, mahsulot rasm bilan yuboriladi. Rasm qidiruv API
serveridan yuklab olinadi, JPEG'ga o'giriladi va Telegram'ga yuklanadi (WebP'ni Telegram rasm sifatida
yaxshi qabul qilmaydi). Rasm yoki albom yuborilmasa ham ro'yxat va tugmalar baribir yuboriladi.

## Tayyor javoblar (javoblar.json)

Yetkazib berish, manzil, ish vaqti, to'lov kabi savollarga bot `javoblar.json` dagi qoidalar bo'yicha javob beradi:

```json
{
  "qoidalar": [
    {
      "nomi": "Yetkazib berish",
      "kalit_sozlar": ["dostavka", "yetkazib", "доставка"],
      "javob": "Toshkent bo'ylab yetkazib beramiz. Narxi 20 000 so'm."
    }
  ]
}
```

- Mijoz xabarida kalit so'zlardan biri bo'lsa, `javob` yuboriladi. Katta-kichik harf, kirill/lotin yozuvi
  va apostrof farqi hisobga olinmaydi. "dostavka" kalit so'zi "Dostavkangiz bormi?" xabariga ham mos keladi.
- 3 harfgacha qisqa kalit so'zlar faqat alohida so'z bo'lib kelsa mos keladi.
- Bitta xabarga bir nechta qoida mos kelsa (eng ko'pi 3 ta), hammasi yuboriladi, keyin mahsulotlar.
- Qoida yoki mahsulot topilsa, "Tushunarli! Hozir sizga aniqini bilib beraman" yuborilmaydi va adminga xabar bormaydi.
- Faylni o'zgartirgach push qiling, Railway qayta deploy qiladi. Fayl xato bo'lsa, servis ishga tushmaydi va
  logda qaysi qoida xatoligi yoziladi (`npm test` ham buni tekshiradi).

## Salomlashish

Mijoz yozganda bot avval salomlashadi:

```
Assalomu alaykum, {ism}! 👋

🍫 Shokoladchiga xush kelibsiz!
😊 Sizga qanday yordam bera olaman?
```

`{ism}` — mijozning Telegram'dagi ismi (bo'lmasa username). Salomlashish bir mijozga 12 soatda bir marta
yuboriladi (`GREETING_COOLDOWN_SECONDS`, `0` — har bir xabarga). Salomlashilgan xabarda mahsulot ham, tayyor
javob ham topilmasa, "Tushunarli! Hozir sizga aniqini bilib beraman" yuborilmaydi, chunki bot hozirgina
"qanday yordam bera olaman?" deb so'radi (adminga xabar baribir boradi). Mijozning keyingi xabarlariga shu
javob beriladi. Matnlarni o'zgartirish: `src/format.js` → `greetingText`, `OPERATOR_REPLY`, `ORDER_PROMPT`.

## Qanday ishlaydi

- Faqat mijoz yozgan matnli xabarlarga (yoki rasm izohiga) javob beradi. Biznes egasining o'zi yozgan
  xabarlar, stiker va ovozli xabarlar javobsiz qoladi.
- "Salom, kinder bormi?" kabi xabarlarda avval butun matn qidiriladi, topilmasa "salom", "bormi" kabi
  so'zlarsiz qayta qidiriladi, keyin har bir so'z alohida qidiriladi.
- Ro'yxatda eng ko'pi bilan `MAX_RESULTS` (standart 5, ko'pi bilan 10) ta mahsulot bo'ladi.
- "Kinder buyurtma qilmoqchiman" kabi gaplardan buyurtma so'zlari olib tashlanib, mahsulot nomi qidiriladi.
- "Tushunarli! Hozir sizga aniqini bilib beraman", buyurtma so'rovi va har bir tayyor javob bir mijozga
  5 daqiqada bir martadan ko'p yuborilmaydi (`OPERATOR_REPLY_COOLDOWN_SECONDS`). Adminga esa har bir javobsiz
  qolgan xabar boradi.
- Qidiruv API ishlamay qolsa ham mijozga "Tushunarli! ..." javobi yuboriladi, adminga esa "Qidiruv API ishlamadi" deb boradi.

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
