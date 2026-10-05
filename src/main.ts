import { findConfigProblems, loadConfig } from "./config.js";
import { HttpError } from "./http.js";
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

// Node.js yerleşik .env okuyucusu. process.loadEnvFile Node.js v20.12+ / v21.7+ ile gelir;
// eski bir Node'da sessizce atlanırsa .env okunmaz ve "token eksik" gibi yanıltıcı bir hata görülür.
function loadDotEnvFile(): void {
  if (typeof process.loadEnvFile !== "function") {
    console.error(`\n❌ HATA: Node.js sürümünüz (${process.version}) çok eski.`);
    console.error("👉 https://nodejs.org adresinden Node.js 22 (LTS) veya daha yenisini kurup tekrar deneyin.\n");
    process.exit(1);
  }

  try {
    process.loadEnvFile();
  } catch (error) {
    // .env dosyası yoksa sorun değil: Docker gibi ortamlarda değişkenler dışarıdan verilir.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`\n❌ HATA: .env dosyası okunamadı: ${(error as Error).message}\n`);
      process.exit(1);
    }
  }
}

loadDotEnvFile();

function exitWithRejectedToken(status: number): never {
  console.error(`\n❌ HATA: Telegram bot token'ınızı kabul etmedi (HTTP ${status}).`);
  console.error("👉 .env dosyasındaki TELEGRAM_BOT_TOKEN değerini BotFather'dan aldığınız token ile karşılaştırın:");
  console.error("   tamamı kopyalanmış olmalı (eksik ya da fazla karakter, başka bir botun token'ı veya iptal edilmiş bir token olabilir).");
  console.error("   Token'ı yeniden görmek için: @BotFather → /mybots → botunuzu seçin → API Token\n");
  process.exit(1);
}

async function main(): Promise<void> {
  const bootstrapLogger = createLogger();
  const config = loadConfig(process.env, bootstrapLogger);
  const logger = createLogger(config.logLevel);

  logger.info("telegram assistant bot baslatiliyor...", { timezone: config.timezone });

  const problems = findConfigProblems(config);
  if (problems.length > 0) {
    console.error("\n❌ Bot başlatılamadı. .env dosyanızdaki şu ayarları düzeltin:\n");
    for (const problem of problems) {
      console.error(`  • ${problem}`);
    }
    console.error("\n📖 Ayrıntılı adımlar için README.md dosyasındaki \"Yapılandırma\" bölümüne bakın.\n");
    process.exit(1);
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
    // Telegram token'ı reddettiyse bot hiçbir şey yapamaz: yazım hatasını hemen ve açıkça göster.
    if (error instanceof HttpError && (error.status === 401 || error.status === 404)) {
      exitWithRejectedToken(error.status);
    }
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

  logger.info("✅ Bot basariyla calisiyor! Telegram'da botunuza /start yazin. Durdurmak icin Ctrl+C.", {
    chatId: config.telegram.chatId,
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
