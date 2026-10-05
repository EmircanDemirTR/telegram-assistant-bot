import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseEnv } from "node:util";
import { findConfigProblems, loadConfig } from "../src/config.js";
import {
  DEFAULT_BRIEFING_LATITUDE,
  DEFAULT_BRIEFING_LOCATION_NAME,
  DEFAULT_BRIEFING_LONGITUDE,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_TIMEZONE
} from "../src/constants.js";

// .env.example, öğrencinin ilk kopyaladığı dosyadır; kodla çelişmemeli.
// (OpenRouter bir modeli kaldırınca eski adın bu dosyada sessizce kalması tam da böyle bir çelişkidir.)
const example = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));
const config = loadConfig(example);

test(".env.example defaults match the defaults in the code", () => {
  assert.equal(config.openRouter.model, DEFAULT_OPENROUTER_MODEL);
  assert.equal(config.briefing.locationName, DEFAULT_BRIEFING_LOCATION_NAME);
  assert.equal(config.briefing.latitude, DEFAULT_BRIEFING_LATITUDE);
  assert.equal(config.briefing.longitude, DEFAULT_BRIEFING_LONGITUDE);
  assert.equal(config.timezone, DEFAULT_TIMEZONE);
});

test("an untouched .env.example is rejected, so a template value never runs as a real one", () => {
  const problems = findConfigProblems(config).join("\n");
  assert.match(problems, /TELEGRAM_BOT_TOKEN/);
  assert.match(problems, /TELEGRAM_CHAT_ID/);
});

test(".env.example ships without a real API key", () => {
  assert.equal(example.OPENROUTER_API_KEY ?? "", "");
});
