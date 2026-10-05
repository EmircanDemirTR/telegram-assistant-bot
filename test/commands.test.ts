import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommandMenu, findCommand, helpText } from "../src/jobs.js";

test("/start, which Telegram sends on the first Start press, is a known command", async () => {
  const start = findCommand("/start");
  assert.ok(start, "/start tanımlı olmalı");
  const reply = await start.run({ deps: {} as never, chatId: "1", command: "/start" });
  assert.match(reply, /Merhaba/);
  assert.match(reply, /\/hava/);
});

test("/help is an alias of /yardim", () => {
  assert.equal(findCommand("/help"), findCommand("/yardim"));
});

test("the Telegram menu lists the user commands but not /start", () => {
  const names = buildCommandMenu().map((entry) => entry.command);
  assert.deepEqual(names, ["hava", "haber", "teknoloji", "yardim"]);
});

test("the help text lists every menu command", () => {
  const text = helpText();
  for (const entry of buildCommandMenu()) {
    assert.ok(text.includes(`/${entry.command}`), `/${entry.command} yardım metninde olmalı`);
  }
});
