import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError, TransportError } from "../src/http.js";
import { describeUserFacingError, serviceLabel } from "../src/user-error.js";

test("errors are translated into actionable Turkish for the chat", () => {
  assert.equal(
    describeUserFacingError(new HttpError("HTTP 429 from https://openrouter.ai", 429, "{}", "https://openrouter.ai")),
    "Yapay zeka servisi (OpenRouter) istek sınırına takıldı (HTTP 429). Birazdan tekrar dene."
  );
  assert.match(
    describeUserFacingError(new HttpError("HTTP 402 from https://openrouter.ai", 402, "", "https://openrouter.ai")),
    /HTTP 402.*kredi yetersiz/
  );
  assert.match(
    describeUserFacingError(new HttpError("HTTP 503 from https://api.telegram.org", 503, "", "https://api.telegram.org")),
    /^Telegram geçici olarak hatalı \(HTTP 503\)/
  );
  assert.equal(
    describeUserFacingError(new TransportError("timeout", "https://ensemble-api.open-meteo.com", 25_000)),
    "Hava durumu servisi (Open-Meteo) yanıt vermedi (zaman aşımı, 25 sn). Birazdan tekrar dene."
  );
  assert.equal(describeUserFacingError("düz metin"), "düz metin");
});

test("an OpenRouter 400/404 points at the model setting, other cases do not", () => {
  for (const status of [400, 404]) {
    assert.match(
      describeUserFacingError(new HttpError(`HTTP ${status} from https://openrouter.ai`, status, "{}", "https://openrouter.ai")),
      /OPENROUTER_MODEL/
    );
  }
  assert.doesNotMatch(
    describeUserFacingError(new HttpError("HTTP 404 from https://api.telegram.org", 404, "", "https://api.telegram.org")),
    /OPENROUTER_MODEL/
  );
  assert.doesNotMatch(
    describeUserFacingError(new HttpError("HTTP 429 from https://openrouter.ai", 429, "{}", "https://openrouter.ai")),
    /OPENROUTER_MODEL/
  );
});

test("service labels map origins to names the user knows", () => {
  assert.equal(serviceLabel("https://openrouter.ai"), "Yapay zeka servisi (OpenRouter)");
  assert.equal(serviceLabel("https://api.open-meteo.com"), "Hava durumu servisi (Open-Meteo)");
  assert.equal(serviceLabel("https://api.telegram.org"), "Telegram");
});
