import assert from "node:assert/strict";
import { test } from "node:test";
import { findConfigProblems, loadConfig } from "../src/config.js";
import { DEFAULT_BRIEFING_LATITUDE, DEFAULT_BRIEFING_LONGITUDE } from "../src/constants.js";
import type { Logger } from "../src/logger.js";

const VALID_ENV = {
  TELEGRAM_BOT_TOKEN: "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ",
  TELEGRAM_CHAT_ID: "987654321"
};

function problemsFor(env: NodeJS.ProcessEnv): string[] {
  return findConfigProblems(loadConfig({ ...VALID_ENV, ...env }));
}

function captureLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const logger: Logger = {
    debug() {},
    info() {},
    warn: (message) => {
      warnings.push(message);
    },
    error() {}
  };
  return { logger, warnings };
}

test("a complete configuration has no problems", () => {
  assert.deepEqual(problemsFor({}), []);
});

test("a missing or template bot token is reported", () => {
  for (const token of [undefined, "", "your_telegram_bot_token_here", "iki-nokta-yok"]) {
    const problems = problemsFor({ TELEGRAM_BOT_TOKEN: token });
    assert.equal(problems.length, 1, `token=${String(token)}`);
    assert.match(problems[0] ?? "", /TELEGRAM_BOT_TOKEN/);
  }
});

test("the chat id is required and must be numeric: empty, template and @username values are rejected", () => {
  for (const chatId of [undefined, "", "your_chat_id_here", "@kullanici", "12ab"]) {
    const problems = problemsFor({ TELEGRAM_CHAT_ID: chatId });
    assert.equal(problems.length, 1, `chatId=${String(chatId)}`);
    assert.match(problems[0] ?? "", /TELEGRAM_CHAT_ID/);
  }
});

test("negative group chat ids are accepted", () => {
  assert.deepEqual(problemsFor({ TELEGRAM_CHAT_ID: "-1001234567890" }), []);
});

test("an unknown timezone is reported", () => {
  const problems = problemsFor({ TIMEZONE: "Turkey/Istanbul" });
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /TIMEZONE/);
});

test("coordinates accept a Turkish decimal comma instead of silently truncating it", () => {
  const config = loadConfig({ ...VALID_ENV, LATITUDE: "39,9334", LONGITUDE: " 32.8597 " });
  assert.equal(config.briefing.latitude, 39.9334);
  assert.equal(config.briefing.longitude, 32.8597);
});

test("invalid coordinates fall back to the default location and warn", () => {
  const { logger, warnings } = captureLogger();
  const config = loadConfig({ ...VALID_ENV, LATITUDE: "kuzey", LONGITUDE: "400" }, logger);
  assert.equal(config.briefing.latitude, DEFAULT_BRIEFING_LATITUDE);
  assert.equal(config.briefing.longitude, DEFAULT_BRIEFING_LONGITUDE);
  assert.equal(warnings.length, 2);
});

test("unset coordinates use the default location without warning", () => {
  const { logger, warnings } = captureLogger();
  const config = loadConfig(VALID_ENV, logger);
  assert.equal(config.briefing.latitude, DEFAULT_BRIEFING_LATITUDE);
  assert.equal(config.briefing.longitude, DEFAULT_BRIEFING_LONGITUDE);
  assert.deepEqual(warnings, []);
});
