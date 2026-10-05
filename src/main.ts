import { loadConfig } from "./config.js";
import { createLogger, errorMeta } from "./logger.js";
import { loadState, saveStateAtomic, StateStore } from "./state.js";
import { TelegramClient } from "./integrations/telegram.js";
import { WeatherClient } from "./integrations/weather.js";
import { OpenRouterClient } from "./integrations/openrouter.js";
import {
  buildCommandMenu,
  createScheduledJobs,
  handleTelegramMessage,
  notifyJobFailure,
  type WorkerDependencies
} from "./jobs.js";
import { Scheduler } from "./scheduler.js";

// Node.js yerleşik .env okuyucusu (Node.js v20.6+)
try {
  process.loadEnvFile();
} catch {
  // .env dosyasi yoksa veya sistem env'leri kullaniliyorsa hata vermez
}

async function main(): Promise<void> {
  const bootstrapLogger = createLogger();
  const config = loadConfig(process.env, bootstrapLogger);
  const logger = createLogger(config.logLevel);

  logger.info("telegram assistant bot baslatiliyor...", { timezone: config.timezone });

  const token = config.telegram.botToken;
  if (!token || token.includes("your_telegram_bot_token") || !token.includes(":")) {
    logger.error("HATA: Gecersiz veya eksik TELEGRAM_BOT_TOKEN!");
    console.error("\n❌ HATA: Geçersiz veya eksik TELEGRAM_BOT_TOKEN!");
    console.error("👉 Lütfen .env dosyasını oluşturup BotFather'dan aldığınız gerçek token'ı ekleyin.");
    console.error("   Örnek: TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ\n");
    process.exit(1);
  }

  const chatId = config.telegram.chatId;
  if (!chatId || chatId.includes("your_chat_id")) {
    console.warn("\n⚠️ UYARI: TELEGRAM_CHAT_ID belirtilmemiş veya şablon değerinde bırakılmış.");
    console.warn("👉 Bot şu an gelen tüm Telegram kullanıcılarına yanıt verir.");
    console.warn("   Yalnızca size yanıt vermesi için .env dosyasına kendi Chat ID'nizi yazmanız önerilir.\n");
  }

  const state = await loadState(config.stateFile, logger);
  const stateStore = new StateStore(config.stateFile, state);
  await saveStateAtomic(config.stateFile, state);

  const telegram = new TelegramClient(config.telegram.botToken, config.telegram.chatId, stateStore, logger);
  const weather = new WeatherClient(config.briefing, { logger });
  const openRouter = new OpenRouterClient(config.openRouter);

  const dependencies: WorkerDependencies = {
    config,
    logger,
    stateStore,
    telegram,
    weather,
    openRouter
  };

  try {
    // Varsa eski webhook'u kaldir ve long polling moduna gec
    await telegram.deleteWebhook();
    // Telegram komut menusunu otomatik ayarla
    await telegram.setCommandMenu(buildCommandMenu());
  } catch (error) {
    logger.warn("telegram baslangic ayarlari uyarisi", errorMeta(error));
  }

  // Zamanlanmis gorevleri baslat (sabah & aksam bultenleri)
  const scheduler = new Scheduler(
    createScheduledJobs(dependencies),
    config.timezone,
    stateStore,
    logger,
    (jobId, error) => notifyJobFailure(dependencies, jobId, error)
  );
  scheduler.start();

  // Telegram long polling baslat
  telegram.startLongPolling((message) => handleTelegramMessage(dependencies, message));

  logger.info("✅ Bot basariyla calisiyor! Telegram'dan mesaj gonderebilirsiniz.", {
    chatId: config.telegram.chatId ?? "(tum chatlere acik)",
    aiStatus: openRouter.isConfigured() ? "aktif" : "pasif (anahtar yok)"
  });

  registerShutdown(scheduler, telegram, logger);
}

function registerShutdown(
  scheduler: Scheduler,
  telegram: TelegramClient,
  logger: ReturnType<typeof createLogger>
): void {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("bot kapatiliyor...", { signal });
    scheduler.stop();
    telegram.stop();
    process.exit(0);
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (error) => logger.error("unhandled rejection", errorMeta(error)));
}

void main().catch((error) => {
  const logger = createLogger("error");
  logger.error("bot baslatilamadi", errorMeta(error));
  process.exitCode = 1;
});
