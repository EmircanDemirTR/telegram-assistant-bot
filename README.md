# 🤖 Telegram Kişisel Asistan Botu

Günlük hayatınızı kolaylaştıran kişisel Telegram botu: anlık hava durumu, güncel haber bültenleri ve yapay zeka sohbet desteği. Kendi bilgisayarınızda ya da sunucunuzda çalışır; ayarlarınız ve sohbetleriniz sizde kalır.

---

## ✨ Özellikler

- 🌤️ **/hava**: Bugün ve yarının ayrıntılı hava durumu (yağış olasılığı ve saatleri, sıcaklık, rüzgar, UV indeksi). [Open-Meteo](https://open-meteo.com/) kullanır: tamamen ücretsiz, API anahtarı gerekmez.
- 📰 **/haber**: Türkiye ve dünyadan öne çıkan güncel gelişmeler (RSS akışlarından derlenir).
- 💻 **/teknoloji**: Teknoloji, yazılım ve bilim dünyasından son gelişmeler.
- 💬 **AI Sohbet**: Komut dışında yazdığınız her mesaja Türkçe yanıt veren akıllı asistan (OpenRouter ile, isteğe bağlı).
- ⏰ **Otomatik Bülten**: Her gün 09:00 ve 20:30'da hava durumu ve haberleri kendiliğinden Telegram'a gönderir.
- 📱 **Kolay Menü**: Telegram komut menüsü otomatik oluşturulur (`/` yazdığınızda komutlar listelenir).

---

## 🧭 Başlamadan Önce

- Bot, **sizin bilgisayarınızda çalışan bir programdır.** Çalıştığı sürece mesajlara yanıt verir ve bültenleri gönderir. Terminali kapattığınızda ya da bilgisayar kapandığında/uyku moduna geçtiğinde bot da durur. 7/24 çalışmasını istiyorsanız sürekli açık bir bilgisayar ya da sunucu gerekir (Docker yöntemi bunun için uygundur).
- Çalışması için **iki bilgi zorunludur:** Telegram bot token'ı ve Telegram Chat ID'niz. İkisini de aşağıda nasıl alacağınız anlatılıyor.
- 💰 Telegram, hava durumu ve haberler **ücretsizdir.** Yalnızca isteğe bağlı yapay zeka özelliği (OpenRouter) kullanıma göre ücretlidir.

---

## 🚀 Kurulum

### 1. Gereksinimler

- **Node.js 22 veya üzeri.** [nodejs.org](https://nodejs.org/) adresinden "LTS" sürümünü indirip kurun. Kurulumdan sonra terminali kapatıp yeniden açın ve sürümü kontrol edin:
  ```bash
  node -v
  ```
  `v22.x.x` ya da daha büyük bir sayı görmelisiniz.
- *(İsteğe bağlı)* [Git](https://git-scm.com/downloads): kodu indirmek için. Kurmak istemezseniz ZIP olarak da indirebilirsiniz.
- *(İsteğe bağlı)* [Docker Desktop](https://www.docker.com/products/docker-desktop/): yalnızca "Yöntem B" için.

### 2. Kodu İndirme

**Git ile:**

```bash
git clone https://github.com/EmircanDemirTR/telegram-assistant-bot.git
cd telegram-assistant-bot
```

**ZIP ile:** Bu sayfadaki yeşil **Code** düğmesi → **Download ZIP**. İndirdiğiniz dosyayı bir klasöre çıkarın.

Bundan sonraki tüm komutları **projenin klasöründe** (içinde `package.json` dosyası olan klasör) çalıştırmalısınız.

> 💡 **Terminali o klasörde açmanın kolay yolları:** VS Code kullanıyorsanız *File → Open Folder* ile klasörü açın, sonra *Terminal → New Terminal*. Windows'ta klasörü Dosya Gezgini'nde açıp adres çubuğuna `powershell` yazıp Enter'a basmanız da yeterlidir.

### 3. Telegram Botu Oluşturma

1. Telegram'da **[@BotFather](https://t.me/BotFather)** botunu açın ve `/start`, ardından `/newbot` yazın.
2. Botunuza bir isim (örnek: `Asistanım`) ve kullanıcı adı verin. Kullanıcı adı benzersiz olmalı ve **`bot` ile bitmelidir** (örnek: `ahmet_asistan_bot`).
3. BotFather'ın verdiği `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ` biçimindeki **HTTP API Token** değerini kopyalayın.
4. Telegram'da **[@userinfobot](https://t.me/userinfobot)** botuna mesaj atın; size `Id: 123456789` gibi bir yanıt verir. Bu sayı sizin **Chat ID**'nizdir.

> 🔐 **Token, botunuzun şifresidir.** Kimseyle paylaşmayın; ekran görüntülerinde ya da GitHub'a yüklediğiniz dosyalarda görünmesin. Yanlışlıkla paylaşırsanız BotFather'a `/revoke` yazarak yenisini alın.

### 4. Yapılandırma (`.env` dosyası)

Proje klasöründe `.env.example` dosyasını `.env` adıyla kopyalayın:

```bash
# Linux / macOS:
cp .env.example .env

# Windows PowerShell:
Copy-Item .env.example .env
```

`.env` dosyasını bir metin düzenleyiciyle (VS Code, Not Defteri...) açın ve **iki zorunlu** değeri kendi bilgilerinizle değiştirin:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
TELEGRAM_CHAT_ID=123456789
```

- Değerleri olduğu gibi yapıştırın; `=` işaretinin etrafında boşluk bırakmayın. Dosyadaki `your_..._here` yazılarını silip yerine gerçek değerleri yazmalısınız.
- `TELEGRAM_CHAT_ID` **yalnızca rakamlardan** oluşur. Bot yalnızca bu sohbete yanıt verir (başkaları botunuzu bulsa bile kullanamaz) ve bültenleri buraya gönderir.
- Dosyanın adı tam olarak `.env` olmalıdır (`.env.txt` değil). Adı nokta ile başladığı için bazı sistemlerde gizli görünebilir.

#### İsteğe bağlı ayarlar

| Ayar | Ne işe yarar? | Varsayılan |
|---|---|---|
| `LOCATION_NAME` | Mesajlarda görünen şehir adı | `İstanbul` |
| `LATITUDE`, `LONGITUDE` | Hava durumunun alınacağı konum. Google Haritalar'da konuma sağ tıklayıp koordinatları kopyalayın. **Ondalık ayırıcı nokta olmalıdır** (`39.9334`) | İstanbul |
| `TIMEZONE` | Saat dilimi (bülten saatleri buna göre çalışır) | `Europe/Istanbul` |
| `OPENROUTER_API_KEY` | Yapay zeka özelliklerini açar (aşağıya bakın) | boş (kapalı) |
| `OPENROUTER_MODEL` | Kullanılacak yapay zeka modeli | `google/gemini-3.8-flash` |
| `LOG_LEVEL` | Günlük ayrıntısı: `debug`, `info`, `warn`, `error` | `info` |

#### 🧠 Yapay zekayı açma (isteğe bağlı)

Yapay zeka olmadan da `/hava`, `/haber` ve `/teknoloji` çalışır (haberler ham liste olarak gelir). Serbest sohbet ve **yapay zekanın seçip özetlediği haber bültenleri** için:

1. [openrouter.ai](https://openrouter.ai/) üzerinde hesap açın.
2. **Credits** sayfasından hesabınıza kredi yükleyin (kullanım başına ödeme; birkaç dolar uzun süre yeter).
3. [Keys](https://openrouter.ai/settings/keys) sayfasında **Create Key** deyin (isterseniz anahtara bir harcama limiti koyun) ve anahtarı `.env` içindeki `OPENROUTER_API_KEY=` satırına yapıştırın.

💰 Yaklaşık maliyet: günde iki bülten ve biraz sohbetle ayda 1-2 $ düzeyinde (kullanımınıza göre değişir).

---

## ▶️ Çalıştırma

### Yöntem A: Node.js ile (en kolay)

```bash
# 1. Paketleri yükleyin (yalnızca ilk seferde)
npm install

# 2. Botu başlatın
npm run dev
```

Her şey doğruysa terminalde şuna benzer bir satır görürsünüz:

```text
{"ts":"...","level":"info","msg":"✅ Bot basariyla calisiyor! Telegram'da botunuza /start yazin. Durdurmak icin Ctrl+C.", ...}
```

Şimdi Telegram'da botunuza gidip `/start` yazın.

- **Durdurmak için:** terminalde `Ctrl + C`.
- `.env` dosyasında bir şey değiştirirseniz botu durdurup yeniden başlatın.
- Bot, terminal penceresi açık kaldığı sürece çalışır.

Projeyi derleyip üretim modunda çalıştırmak için:

```bash
npm run build
npm start
```

### Yöntem B: Docker ile (arka planda)

Docker Desktop'ın açık olduğundan ve `.env` dosyanızı hazırladığınızdan emin olun, sonra:

```bash
docker compose up -d
docker compose logs -f
```

Günlükte yukarıdaki `✅ Bot basariyla calisiyor!` satırını görmelisiniz (`logs -f` izlemesinden `Ctrl + C` ile çıkabilirsiniz, bot çalışmaya devam eder). Günlükte ❌ ile başlayan bir hata görüyor ve bot sürekli yeniden başlıyorsa `.env` ayarlarınızı kontrol edin.

| İş | Komut |
|---|---|
| Günlükleri izlemek | `docker compose logs -f` |
| Botu durdurmak | `docker compose down` |
| Kodu güncelledikten sonra yeniden kurmak | `docker compose up -d --build` |

Botun hafızası (okuduğu mesajların sırası, gönderdiği haberler, sohbet geçmişi) `data/` klasöründe tutulur. Silerseniz bot daha önce gönderdiği haberleri unutur.

---

## 💬 Botu Test Etme

Telegram'da BotFather'da verdiğiniz kullanıcı adıyla botunuzu bulun, **Başlat**'a basın (ya da `/start` yazın):

| Komut | Açıklama |
|---|---|
| `/start` | Karşılama mesajı ve komut listesi |
| `/hava` | Bugün ve yarın için ayrıntılı hava durumu raporu |
| `/haber` | Güncel haber bülteni |
| `/teknoloji` | Teknoloji ve bilim bülteni |
| `/yardim` | Kullanılabilir komutları listeler |
| *(Düz metin)* | Yapay zeka asistanı ile serbest sohbet (OpenRouter anahtarı varsa) |

> ℹ️ Yapay zeka açıkken `/haber` ve `/teknoloji` yanıtı birkaç on saniye sürebilir; bu sırada bot "yazıyor…" gösterir.

## ⏰ Otomatik Bülten

Bot çalıştığı sürece her gün **09:00** ve **20:30**'da (`TIMEZONE` saat diliminde) hava durumu ve haber özetini size kendiliğinden gönderir.

- Bot o saatte kapalıysa o günün bülteni atlanır; sonradan telafi edilmez.
- Telegram kuralı gereği, botun size mesaj atabilmesi için botunuza **bir kez `/start` yazmış olmanız** gerekir.
- Bülteni beklemeden denemek için `/hava` ve `/haber` komutlarını kullanın.

---

## 🛠️ Kendi İhtiyacınıza Göre Değiştirme

| Ne yapmak istiyorsunuz? | Nereden? |
|---|---|
| Bülten saatlerini değiştirmek | `src/constants.ts` → `BRIEFING_SCHEDULE` |
| Haber kaynaklarını eklemek/çıkarmak | `src/constants.ts` → `NEWS_RSS_SOURCES`, `TECH_SCIENCE_RSS_SOURCES` |
| Yeni komut eklemek | `src/jobs.ts` → `BOT_COMMANDS` listesi |
| Yapay zekanın kişiliğini değiştirmek | `src/jobs.ts` → `assistantSystemPrompt` |

```text
src/main.ts          → başlangıç noktası (ayar kontrolü, Telegram bağlantısı, zamanlayıcı)
src/jobs.ts          → komutlar ve sabah/akşam bültenleri
src/integrations/    → Telegram, OpenRouter, hava durumu ve RSS bağlantıları
src/digests/         → hava durumu ve haber bültenlerinin hazırlanması
test/                → otomatik testler
```

Değişiklikten sonra: `npm run dev` kullanıyorsanız bot kendiliğinden yeniden başlar; Docker'da `docker compose up -d --build` çalıştırın. Hata yapıp yapmadığınızı denetlemek için `npm run typecheck` ve `npm test` komutlarını kullanabilirsiniz.

---

## 🔒 Güvenlik Notları

- `.env` dosyası `.gitignore` içindedir, yani GitHub'a yüklenmez. Yine de **token'ı ve API anahtarını** hiçbir yere (sohbet, ekran görüntüsü, forum, GitHub) yapıştırmayın. Hata ararken günlük (log) paylaşacaksanız önce içinde token/anahtar olmadığına bakın.
- Token ya da OpenRouter anahtarı sızdıysa hemen yenileyin: Telegram'da BotFather → `/revoke`; OpenRouter'da [Keys](https://openrouter.ai/settings/keys) sayfasında anahtarı silin.
- Bot yalnızca `TELEGRAM_CHAT_ID` ile eşleşen sohbete yanıt verir; böylece başkaları botunuzu bulsa bile OpenRouter krediniz harcanmaz.

---

## ❓ Sık Karşılaşılan Sorunlar (S.S.S.)

**`node` veya `npm` komutu bulunamadı**: Node.js'i kurduktan sonra terminali kapatıp yeniden açın.

**Windows PowerShell'de "running scripts is disabled on this system" hatası**: PowerShell'de `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` komutunu çalıştırıp işlemi tekrar deneyin. Alternatif olarak komutları PowerShell yerine "Komut İstemi"nde (cmd) çalıştırın.

**"Node.js sürümünüz çok eski"**: [nodejs.org](https://nodejs.org/) üzerinden Node.js 22 (LTS) veya daha yenisini kurun.

**"❌ Bot başlatılamadı … TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID eksik veya geçersiz"**: `.env.example` dosyasını yalnızca kopyalamak yetmez; içindeki `your_..._here` yazılarını gerçek token ve Chat ID ile değiştirmelisiniz. `.env` dosyasının `package.json` ile **aynı klasörde** olduğunu ve komutu o klasörde çalıştırdığınızı da kontrol edin.

**"❌ Telegram bot token'ınızı kabul etmedi (HTTP 401)"**: Token eksik ya da yanlış kopyalanmış, başka bir botun token'ı veya `/revoke` ile iptal edilmiş olabilir. BotFather → `/mybots` → botunuz → **API Token** bölümünden yeniden kopyalayın.

**Bot mesajlarıma yanıt vermiyor**:
1. Terminalde `✅ Bot basariyla calisiyor!` satırı var mı, bot hâlâ açık mı?
2. Mesajı, `TELEGRAM_CHAT_ID` olarak yazdığınız hesaptan mı gönderiyorsunuz? Günlükte `yetkisiz chat id'den mesaj geldi` satırını görüyorsanız, satırdaki `chatId` değeri sizin gerçek Chat ID'nizdir: onu `.env` dosyasına yazıp botu yeniden başlatın.
3. Bot başka bir yerde (başka terminal, Docker, sunucu) de çalışıyor olabilir. Aşağıdaki 409 hatasına bakın.

**"Conflict: terminated by other getUpdates request (409)"**: Bot aynı anda başka bir terminal penceresinde, Docker'da ya da sunucuda açık kalmış. Diğer çalışan kopyayı durdurun.

**Sabah/akşam bülteni gelmiyor**: Bot o saatte açık mıydı (bilgisayar uyku modundaysa bot da durur)? Botunuza en az bir kez `/start` yazdınız mı? `TIMEZONE` doğru mu?

**Yapay zeka sohbeti hata veriyor**: Hata mesajı nedeni söyler. `401`/`403` → `OPENROUTER_API_KEY` yanlış; `402` → OpenRouter krediniz bitmiş; `404` ya da `400` → `OPENROUTER_MODEL` artık geçerli değil, [güncel bir model](https://openrouter.ai/models) seçin; `429` → istek sınırına takıldınız, biraz bekleyin.

**Hava durumu yanlış şehri gösteriyor**: `LATITUDE` ve `LONGITUDE` değerlerini kontrol edin (virgül değil nokta kullanın), sonra botu yeniden başlatın.

**Haberlerin altında "⚠️ Bazı kaynaklar yanıt vermedi"**: Normaldir; haber sitelerinden biri o an erişilemiyor. Bot kalan kaynaklarla devam eder.

**Testleri çalıştırma**: `npm test`
