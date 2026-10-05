import { HttpError, TransportError } from "./http.js";

/**
 * Hatayı kullanıcıya gösterilecek kısa Türkçe cümleye çevirir.
 */
export function describeUserFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof TransportError) {
    const label = serviceLabel(error.origin);
    if (error.kind === "timeout") {
      return `${label} yanıt vermedi (zaman aşımı, ${Math.round(error.timeoutMs / 1000)} sn). Birazdan tekrar dene.`;
    }
    return `${label} erişilemedi (ağ hatası${error.code ? `, ${error.code}` : ""}). Birazdan tekrar dene.`;
  }

  if (error instanceof HttpError) {
    return describeHttpStatus(serviceLabel(error.origin), error.status);
  }

  if (message.includes("OpenRouter response did not include message content")) {
    return "Yapay zeka servisi boş yanıt döndürdü; tekrar dene.";
  }
  if (message.includes("OpenRouter API key is missing")) {
    return "OpenRouter anahtarı yapılandırılmamış. .env dosyasına OPENROUTER_API_KEY ekleyiniz.";
  }

  return message.slice(0, 300) || "Bilinmeyen bir hata oluştu.";
}

function describeHttpStatus(label: string, status: number): string {
  if (status === 401 || status === 403) {
    return `${label} isteği reddetti (HTTP ${status}): anahtar veya yetki sorunu.`;
  }
  if (status === 402) {
    return `${label} isteği reddetti (HTTP 402): bakiye veya kredi yetersiz.`;
  }
  if (status === 404) {
    return `${label} istenen kaynağı bulamadı (HTTP 404).`;
  }
  if (status === 429) {
    return `${label} istek sınırına takıldı (HTTP 429). Birazdan tekrar dene.`;
  }
  if (status >= 500) {
    return `${label} geçici olarak hatalı (HTTP ${status}). Birazdan tekrar dene.`;
  }
  return `${label} isteği reddetti (HTTP ${status}).`;
}

const SERVICE_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/openrouter\.ai$/, "Yapay zeka servisi (OpenRouter)"],
  [/open-meteo\.com$/, "Hava durumu servisi (Open-Meteo)"],
  [/api\.telegram\.org$/, "Telegram"]
];

export function serviceLabel(origin: string): string {
  let host = origin;
  try {
    host = new URL(origin).hostname;
  } catch {
    // origin degilse
  }
  for (const [pattern, label] of SERVICE_LABELS) {
    if (pattern.test(host)) {
      return label;
    }
  }
  return host || "Dış servis";
}
