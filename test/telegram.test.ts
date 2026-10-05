import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TelegramClient } from "../src/integrations/telegram.js";
import { createLogger } from "../src/logger.js";
import { StateStore, createDefaultState } from "../src/state.js";

interface FakeReply {
  status: number;
  body: unknown;
}

interface RecordedRequest {
  path: string;
  body: Record<string, unknown>;
}

async function startFakeBotApi(
  reply: (path: string, body: Record<string, unknown>, calls: number) => Promise<FakeReply> | FakeReply
): Promise<{ baseUrl: string; requests: RecordedRequest[]; close: () => Promise<void> }> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      const path = request.url ?? "";
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({ path, body });
      void Promise.resolve(reply(path, body, requests.length)).then((result) => {
        response.writeHead(result.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(result.body));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("beklenen durum olusmadi");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a Telegram HTML rejection is resent as plain text instead of failing the message", async () => {
  const dir = mkdtempSync(join(tmpdir(), "telegram-html-"));
  const api = await startFakeBotApi((path, body) => {
    if (path === "/sendMessage" && body.parse_mode === "HTML") {
      return {
        status: 400,
        body: { ok: false, error_code: 400, description: "Bad Request: can't parse entities: Unsupported start tag \"x\"" }
      };
    }
    return { status: 200, body: { ok: true, result: {} } };
  });

  try {
    const stateStore = new StateStore(join(dir, "state.json"), createDefaultState());
    const client = new TelegramClient("token", "42", stateStore, createLogger("error"), api.baseUrl);
    await client.sendMessage("42", "<b>a &amp; b</b> <x>");

    const sends = api.requests.filter((request) => request.path === "/sendMessage");
    assert.equal(sends.length, 2, "HTML reddi sonrasi ikinci gonderim");
    assert.equal(sends[0]?.body.parse_mode, "HTML");
    assert.equal(sends[1]?.body.parse_mode, undefined, "ikinci gonderim duz metin");
    assert.equal(sends[1]?.body.text, "a & b ");
  } finally {
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a silent send asks Telegram not to ring the phone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "telegram-silent-"));
  const api = await startFakeBotApi(() => ({ status: 200, body: { ok: true, result: {} } }));

  try {
    const stateStore = new StateStore(join(dir, "state.json"), createDefaultState());
    const client = new TelegramClient("token", "42", stateStore, createLogger("error"), api.baseUrl);
    await client.sendToConfiguredChat("gece", { silent: true });
    await client.sendToConfiguredChat("gunduz");

    assert.equal(api.requests[0]?.body.disable_notification, true);
    assert.equal(api.requests[1]?.body.disable_notification, undefined, "varsayilan sesli");
  } finally {
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("other Telegram errors still propagate from sendMessage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "telegram-err-"));
  const api = await startFakeBotApi(() => ({
    status: 400,
    body: { ok: false, error_code: 400, description: "Bad Request: chat not found" }
  }));

  try {
    const stateStore = new StateStore(join(dir, "state.json"), createDefaultState());
    const client = new TelegramClient("token", "42", stateStore, createLogger("error"), api.baseUrl);
    await assert.rejects(client.sendMessage("42", "merhaba"), /HTTP 400/);
    assert.equal(api.requests.length, 1);
  } finally {
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing message handler does not block the update offset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "telegram-offset-"));
  const api = await startFakeBotApi(async (path, _body, calls) => {
    if (path.startsWith("/getUpdates")) {
      if (calls === 1) {
        return {
          status: 200,
          body: { ok: true, result: [{ update_id: 500, message: { message_id: 1, text: "/hava", chat: { id: 42 } } }] }
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { status: 200, body: { ok: true, result: [] } };
    }
    return { status: 200, body: { ok: true, result: true } };
  });

  try {
    const stateStore = new StateStore(join(dir, "state.json"), createDefaultState());
    const client = new TelegramClient("token", "42", stateStore, createLogger("error"), api.baseUrl);
    let handled = 0;
    client.startLongPolling(async () => {
      handled += 1;
      throw new Error("isleyici patladi");
    });

    const polls = () => api.requests.filter((request) => request.path.startsWith("/getUpdates"));
    await waitFor(() => polls().length >= 2, 2_000);
    client.stop();
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(handled, 1, "mesaj bir kez islendi, yeniden islenmedi");
    assert.equal(stateStore.get().telegram.offset, 500, "hataya ragmen guncelleme onaylandi");
    assert.match(polls()[1]?.path ?? "", /offset=501/, "sonraki yoklama onaylanmis offset ile");
  } finally {
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
