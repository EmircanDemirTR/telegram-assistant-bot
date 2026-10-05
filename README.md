# 🤖 Telegram Kişisel Asistan Botu

Günlük hayatınızı kolaylaştıran; anlık hava durumu tahminleri, güncel haber bültenleri ve yapay zeka sohbet desteği sunan kişisel Telegram botu.

---

## ✨ Özellikler

- 🌤️ **/hava**: Bugün ve yarının ayrıntılı hava durumu (yağış olasılığı ve saatleri, sıcaklık, rüzgar, UV indeksi - Open-Meteo ile tamamen ücretsiz, API anahtarı gerekmez).
- 📰 **/haber**: Türkiye ve dünyadan öne çıkan güncel gelişmeler (RSS akışlarından derlenir).
- 💻 **/teknoloji**: Teknoloji, yazılım ve bilim dünyasından son gelişmeler.
- 💬 **AI Sohbet**: Bot'a komut dışında herhangi bir mesaj yazdığınızda Türkçe yanıt veren akıllı asistan (OpenRouter desteği).
- ⏰ **Otomatik Brifing**: Sabah (09:00) ve akşam (20:30) hava durumu ve haberleri otomatik olarak Telegram'dan iletir.
- 📱 **Kolay Menü**: Telegram komut menüsü otomatik oluşturulur (`/` yazdığınızda komutlar listelenir).

---

## 🚀 3 Dakikada Kurulum

### 1. Gereksinimler
- Bilgisayarınızda veya sunucunuzda **Node.js (v20 veya üzeri)** ya da **Docker** kurulu olmalıdır.
  *(Node sürümünüzü kontrol etmek için: `node -v`)*

### 2. Telegram Botu Oluşturma
1. Telegram'da **[@BotFather](https://t.me/BotFather)** botunu açın ve `/start` ardından `/newbot` komutunu gönderin.
2. Botunuza bir isim (örnek: `Asistanım`) ve kullanıcı adı (sonu mutlaka `bot` ile biten benzersiz bir ad, örnek: `ahmet_asistan_bot`) verin.
3. BotFather'ın size verdiği `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ` biçimindeki **HTTP API Token** değerini kopyalayın.
4. Telegram'da **[@userinfobot](https://t.me/userinfobot)** botuna mesaj atarak kendi **Id** numaranızı (Chat ID) öğrenin.

### 3. Yapılandırma
Proje dizininde `.env.example` dosyasını `.env` olarak kopyalayın:

```bash
# Linux / macOS:
cp .env.example .env

# Windows PowerShell:
Copy-Item .env.example .env
```

`.env` dosyasını bir metin düzenleyiciyle açıp bilgilerinizi girin:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
TELEGRAM_CHAT_ID=123456789
```

> 💡 **İsteğe Bağlı (AI Sohbet):** Bot ile serbest sohbet etmek ve haberleri yapay zekaya özetletmek isterseniz [openrouter.ai](https://openrouter.ai/) adresinden bir API anahtarı alıp `OPENROUTER_API_KEY` alanına yapıştırabilirsiniz. Boş bırakırsanız bot hava durumu ve haberleri standart olarak iletmeye devam eder.

---

## ▶️ Çalıştırma

### Yöntem A: Node.js ile (En Kolay)

```bash
# 1. Paketleri yükleyin
npm install

# 2. Geliştirme modunda başlatın
npm run dev
```

Projeyi derleyip üretim modunda çalıştırmak için:
```bash
npm run build
npm start
```

### Yöntem B: Docker ile

```bash
docker compose up -d
```

Bot arka planda 7/24 çalışacaktır. Logları izlemek için:
```bash
docker compose logs -f
```

---

## 💬 Botu Test Etme ve Komutlar

Bot çalıştıktan sonra Telegram'da kendi botunuzu bulun ve `/start` yazın:

| Komut | Açıklama |
|---|---|
| `/hava` | Bugün ve yarın için ayrıntılı hava durumu raporu |
| `/haber` | Güncel haber bülteni |
| `/teknoloji` | Teknoloji ve bilim bülteni |
| `/yardim` | Kullanılabilir komutları listeler |
| *(Düz Metin)* | Yapay zeka asistanı ile serbest sohbet (OpenRouter anahtarı varsa) |

---

## ❓ Sık Karşılaşılan Sorunlar (S.S.S.)

- **"HATA: Geçersiz veya eksik TELEGRAM_BOT_TOKEN!"**: `.env` dosyasını oluşturduğunuzdan ve BotFather'dan aldığınız token'ı doğru yapıştırdığınızdan emin olun.
- **Bot mesajlarıma yanıt vermiyor**: `.env` dosyasındaki `TELEGRAM_CHAT_ID` değerinizin kendi Telegram ID'niz olduğundan emin olun. Eğer bu alanı boş bırakırsanız bot gelen tüm kullanıcılara yanıt verir.
- **"Conflict: terminated by other getUpdates request (409)"**: Bot aynı anda başka bir terminal penceresinde veya sunucuda açık kalmıştır. Diğer çalışan işlemi durdurun.
- **Birim Testlerini Çalıştırma**: Projedeki kodların doğruluğunu test etmek için `npm test` komutunu çalıştırabilirsiniz.
