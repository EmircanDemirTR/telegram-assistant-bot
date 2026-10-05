import {
  DEFAULT_AIR_QUALITY_API_URL,
  DEFAULT_ENSEMBLE_API_URL,
  DEFAULT_WEATHER_API_URL
} from "../constants.js";
import {
  DAYLIGHT_END_HOUR,
  DAYLIGHT_START_HOUR,
  buildHourlySeries,
  circularMean,
  daylightPoints,
  describeUvIndex,
  describeWindDirection,
  describeWindSpeed,
  hourLabel,
  median,
  memberDailyExtremes,
  memberValuesAt,
  pointsForDate,
  quantile,
  summarizePrecipitation,
  type HourlyPoint,
  type MemberSeries,
  type PrecipitationAmount,
  type PrecipitationWindow
} from "../digests/forecast.js";
import { bold, escapeHtml, link } from "../format.js";
import { fetchJson } from "../http.js";
import { errorMeta, type Logger } from "../logger.js";
import { formatDateOnly, toDateKey } from "../time.js";
import type { BriefingConfig } from "../types.js";

export interface DailyForecast {
  dateKey: string;
  locationName: string;
  minTemperature: number;
  maxTemperature: number;
  precipitationProbability?: number;
  precipitationWindows: PrecipitationWindow[];
  summary: string;
  emoji: string;
  source: "ensemble" | "deterministic";
  models: string[];
  memberCount?: number;
  temperatureSpread?: number;
  totalPrecipitationMm?: number;
  totalPrecipitation?: PrecipitationAmount;
  uvIndexMax?: number;
  uvPeakHour?: string;
  uvPeakWindow?: { start: string; end: string };
  hourly: HourlyPoint[];
  humidityMin?: number;
  humidityMax?: number;
  windSpeed?: number;
  windGustsMax?: number;
  windGustsPeakHour?: string;
  windDirection?: number;
}

export type HourlyBlock = Record<string, Array<number | null> | string[] | undefined>;
type UvSummary = Pick<DailyForecast, "uvPeakHour" | "uvPeakWindow"> & { uvIndexMax: number };

interface OpenMeteoResponse {
  hourly?: HourlyBlock;
  daily?: Record<string, Array<number | null> | string[] | undefined>;
  error?: boolean;
  reason?: string;
}

const ENSEMBLE_HOURLY_FIELDS = [
  "temperature_2m",
  "precipitation",
  "weather_code",
  "relative_humidity_2m",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m"
] as const;

const DETERMINISTIC_DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
  "relative_humidity_2m_min",
  "relative_humidity_2m_max",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "wind_direction_10m_dominant"
] as const;

export const FORECAST_DAY_COUNT = 2;

export interface WeatherClientOptions {
  logger?: Logger;
  forecastUrl?: string;
  ensembleUrl?: string;
  airQualityUrl?: string;
}

export class WeatherClient {
  private readonly logger?: Logger;
  private readonly apiUrl: string;
  private readonly ensembleApiUrl: string;
  private readonly airQualityApiUrl: string;

  constructor(
    private readonly config: BriefingConfig,
    options: WeatherClientOptions = {}
  ) {
    this.logger = options.logger;
    this.apiUrl = options.forecastUrl ?? DEFAULT_WEATHER_API_URL;
    this.ensembleApiUrl = options.ensembleUrl ?? DEFAULT_ENSEMBLE_API_URL;
    this.airQualityApiUrl = options.airQualityUrl ?? DEFAULT_AIR_QUALITY_API_URL;
  }

  async forecast(timezone: string, dateKeys: string[]): Promise<DailyForecast[]> {
    if (dateKeys.length === 0) {
      return [];
    }

    const [days, uvByDate] = await Promise.all([
      this.baseForecast(timezone, dateKeys),
      this.uvIndex(timezone, dateKeys).catch((error: unknown) => {
        this.logger?.warn("weather uv fetch failed; forecast goes without UV", errorMeta(error));
        return undefined;
      })
    ]);

    return days.map((day) => {
      const uv = uvByDate?.get(day.dateKey);
      return uv ? { ...day, ...uv } : day;
    });
  }

  private async baseForecast(timezone: string, dateKeys: string[]): Promise<DailyForecast[]> {
    if (this.config.useEnsemble) {
      try {
        const forecasts = await this.ensembleForecast(timezone, dateKeys);
        if (forecasts.length > 0) {
          return forecasts;
        }
        this.logger?.warn("weather ensemble returned no days; using deterministic fallback", { dateKeys });
      } catch (error) {
        this.logger?.warn("weather ensemble failed; using deterministic fallback", errorMeta(error));
      }
    }

    return this.deterministicForecast(timezone, dateKeys);
  }

  private async uvIndex(timezone: string, dateKeys: string[]): Promise<Map<string, UvSummary>> {
    const url = new URL(this.airQualityApiUrl);
    url.searchParams.set("latitude", String(this.config.latitude));
    url.searchParams.set("longitude", String(this.config.longitude));
    url.searchParams.set("daily", "uv_index_max");
    url.searchParams.set("hourly", "uv_index");
    url.searchParams.set("timezone", timezone);
    url.searchParams.set("forecast_days", String(dateKeys.length));

    const response = await fetchJson<OpenMeteoResponse>(url.toString(), {
      timeoutMs: 12_000,
      retries: 1
    });

    const dailyTimes = (response.daily?.time as string[] | undefined) ?? [];
    const dailyMaxValues = (response.daily?.uv_index_max as Array<number | null> | undefined) ?? [];
    const hourlyTimes = (response.hourly?.time as string[] | undefined) ?? [];
    const hourlyValues = (response.hourly?.uv_index as Array<number | null> | undefined) ?? [];

    const result = new Map<string, UvSummary>();

    for (const dateKey of dateKeys) {
      const dailyIndex = dailyTimes.indexOf(dateKey);
      const dailyMax = dailyIndex >= 0 ? dailyMaxValues[dailyIndex] : undefined;
      if (typeof dailyMax !== "number" || !Number.isFinite(dailyMax)) {
        continue;
      }

      const dayHours: Array<{ time: string; value: number }> = [];
      hourlyTimes.forEach((time, index) => {
        const value = hourlyValues[index];
        if (time.startsWith(dateKey) && typeof value === "number" && Number.isFinite(value)) {
          dayHours.push({ time, value });
        }
      });

      result.set(dateKey, {
        uvIndexMax: roundTo(dailyMax, 1),
        ...uvPeak(dayHours)
      });
    }

    return result;
  }

  private async ensembleForecast(
    timezone: string,
    dateKeys: string[],
    models: string[] = this.ensembleModels()
  ): Promise<DailyForecast[]> {
    const url = new URL(this.ensembleApiUrl);
    url.searchParams.set("latitude", String(this.config.latitude));
    url.searchParams.set("longitude", String(this.config.longitude));
    url.searchParams.set("hourly", ENSEMBLE_HOURLY_FIELDS.join(","));
    url.searchParams.set("timezone", timezone);
    url.searchParams.set("forecast_days", String(dateKeys.length + 1));
    url.searchParams.set("models", models.join(","));

    const response = await fetchJson<OpenMeteoResponse>(url.toString(), {
      timeoutMs: 25_000,
      retries: 1
    });

    if (response.error) {
      throw new Error(`Open-Meteo ensemble reddetti: ${response.reason ?? "sebep bildirilmedi"}`);
    }

    const hourly = response.hourly ?? {};
    const times = (hourly.time as string[] | undefined) ?? [];
    if (times.length === 0) {
      return [];
    }

    const temperatureMembers = collectMembers(hourly, "temperature_2m", models);
    const windGustMembers = collectMembers(hourly, "wind_gusts_10m", models);
    const allPoints = buildHourlySeries({
      times,
      temperature: temperatureMembers,
      precipitation: collectMembers(hourly, "precipitation", models),
      humidity: collectMembers(hourly, "relative_humidity_2m", models),
      windSpeed: collectMembers(hourly, "wind_speed_10m", models),
      windGusts: windGustMembers,
      windDirection: collectMembers(hourly, "wind_direction_10m", models)
    });
    const weatherCodeMembers = collectMembers(hourly, "weather_code", models);

    const availableDates = [...new Set(times.map((time) => time.slice(0, 10)))];
    const matched = dateKeys.filter((dateKey) => availableDates.includes(dateKey));
    const effectiveKeys = matched.length > 0 ? matched : availableDates.slice(0, dateKeys.length);

    const days: DailyForecast[] = [];
    for (const dateKey of effectiveKeys) {
      const day = buildEnsembleDay({
        dateKey,
        times,
        allPoints,
        temperatureMembers,
        weatherCodeMembers,
        windGustMembers,
        models,
        locationName: this.config.locationName
      });
      if (day) {
        days.push(day);
      }
    }

    return days;
  }

  private async deterministicForecast(timezone: string, dateKeys: string[]): Promise<DailyForecast[]> {
    const models = this.deterministicModels();
    const url = new URL(this.apiUrl);
    url.searchParams.set("latitude", String(this.config.latitude));
    url.searchParams.set("longitude", String(this.config.longitude));
    url.searchParams.set("daily", DETERMINISTIC_DAILY_FIELDS.join(","));
    url.searchParams.set("timezone", timezone);
    url.searchParams.set("forecast_days", String(dateKeys.length));
    url.searchParams.set("models", models.join(","));

    const response = await fetchJson<OpenMeteoResponse>(url.toString(), {
      timeoutMs: 15_000,
      retries: 1
    });

    if (response.error) {
      throw new Error(`Open-Meteo isteği reddedildi: ${response.reason ?? "sebep bildirilmedi"}`);
    }

    const daily = (response.daily ?? {}) as Record<string, Array<number | null> | string[] | undefined>;
    const dailyTimes = (daily.time as string[] | undefined) ?? [];

    const days: DailyForecast[] = [];
    dateKeys.forEach((dateKey, position) => {
      const index = dailyTimes.length > 0 ? dailyTimes.indexOf(dateKey) : position;
      if (index < 0) {
        return;
      }

      const day = buildDeterministicForecast(
        daily as Record<string, Array<number | null> | undefined>,
        models,
        this.config.locationName,
        dateKey,
        index
      );
      if (day) {
        days.push(day);
      }
    });

    return days;
  }

  private ensembleModels(): string[] {
    return dedupe(this.config.ensembleModels);
  }

  private deterministicModels(): string[] {
    return dedupe([this.config.weatherModel, this.config.weatherFallbackModel].filter((item): item is string => Boolean(item)));
  }
}

export function collectMembers(hourly: HourlyBlock, field: string, models: string[]): MemberSeries {
  const patterns = models.map(
    (model) => new RegExp(`^${escapeRegExp(field)}(_member\\d+)?_${escapeRegExp(model)}(_.*)?$`)
  );
  patterns.push(new RegExp(`^${escapeRegExp(field)}(_member\\d+)?$`));

  const members: MemberSeries = [];
  for (const [key, values] of Object.entries(hourly)) {
    if (key === "time" || !Array.isArray(values)) {
      continue;
    }
    if (patterns.some((pattern) => pattern.test(key))) {
      members.push(values as Array<number | null>);
    }
  }
  return members;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildEnsembleDay(input: {
  dateKey: string;
  times: string[];
  allPoints: HourlyPoint[];
  temperatureMembers: MemberSeries;
  weatherCodeMembers: MemberSeries;
  windGustMembers?: MemberSeries;
  models: string[];
  locationName: string;
}): DailyForecast | undefined {
  const { dateKey, times, allPoints, temperatureMembers, weatherCodeMembers, models, locationName } = input;
  const points = pointsForDate(allPoints, dateKey);

  const { maxima, minima } = memberDailyExtremes(temperatureMembers, times, dateKey);
  const maxTemperature = median(maxima);
  const minTemperature = median(minima);

  if (maxTemperature === undefined || minTemperature === undefined || points.length === 0) {
    return undefined;
  }

  const temperatureSpread =
    maxima.length >= 2 ? (quantile(maxima, 0.9) ?? 0) - (quantile(maxima, 0.1) ?? 0) : undefined;

  const precipitation = summarizePrecipitation(points);
  const windows = precipitation.windows;

  const condition = classifyEnsembleDay({
    dayCodes: weatherCodesFor(weatherCodeMembers, times, dateKey),
    daylightCodes: weatherCodesFor(weatherCodeMembers, times, dateKey, {
      start: DAYLIGHT_START_HOUR,
      end: DAYLIGHT_END_HOUR
    }),
    wetDaytime: windows.some(overlapsDaylight),
    totalMm: precipitation.totalMm
  });

  return {
    dateKey,
    locationName,
    minTemperature: Math.round(minTemperature),
    maxTemperature: Math.round(maxTemperature),
    ...(precipitation.peakProbability > 0 ? { precipitationProbability: precipitation.peakProbability } : {}),
    ...(precipitation.totalMm > 0 ? { totalPrecipitationMm: precipitation.totalMm } : {}),
    ...(precipitation.total ? { totalPrecipitation: precipitation.total } : {}),
    precipitationWindows: windows,
    summary: condition.summary,
    emoji: condition.emoji,
    source: "ensemble",
    models,
    memberCount: temperatureMembers.length,
    hourly: points,
    ...(temperatureSpread !== undefined ? { temperatureSpread: roundTo(temperatureSpread, 1) } : {}),
    ...summarizeConditions(points)
  };
}

export function summarizeConditions(points: HourlyPoint[]): Pick<
  DailyForecast,
  | "humidityMin"
  | "humidityMax"
  | "windSpeed"
  | "windGustsMax"
  | "windGustsPeakHour"
  | "windDirection"
> {
  const daylight = daylightPoints(points, DAYLIGHT_START_HOUR, DAYLIGHT_END_HOUR);
  const window = daylight.length > 0 ? daylight : points;

  const humidities = window
    .filter((point): point is HourlyPoint & { medianHumidity: number } => point.medianHumidity !== undefined)
    .map((point) => point.medianHumidity);
  const windSpeeds = window
    .map((point) => point.medianWindSpeed)
    .filter((value): value is number => value !== undefined);
  const gustPoints = window.filter(
    (point): point is HourlyPoint & { medianWindGusts: number } => point.medianWindGusts !== undefined
  );
  const directions = window
    .map((point) => point.windDirection)
    .filter((value): value is number => value !== undefined);

  const typicalWind = median(windSpeeds);
  const peakGust = gustPoints.length > 0
    ? gustPoints.reduce((best, point) => (point.medianWindGusts > best.medianWindGusts ? point : best))
    : undefined;
  const dominantDirection = circularMean(directions);

  return {
    ...(humidities.length > 0
      ? { humidityMin: Math.round(Math.min(...humidities)), humidityMax: Math.round(Math.max(...humidities)) }
      : {}),
    ...(typicalWind !== undefined ? { windSpeed: Math.round(typicalWind) } : {}),
    ...(peakGust
      ? {
          windGustsMax: Math.round(peakGust.medianWindGusts),
          windGustsPeakHour: peakGust.time
        }
      : {}),
    ...(dominantDirection !== undefined ? { windDirection: Math.round(dominantDirection) } : {})
  };
}

export function weatherCodesFor(
  members: MemberSeries,
  times: string[],
  dateKey: string,
  hourRange?: { start: number; end: number }
): number[] {
  const codes: number[] = [];
  times.forEach((time, index) => {
    if (!time.startsWith(dateKey)) {
      return;
    }
    if (hourRange) {
      const hour = Number.parseInt(time.slice(11, 13), 10);
      if (Number.isNaN(hour) || hour < hourRange.start || hour > hourRange.end) {
        return;
      }
    }
    codes.push(...memberValuesAt(members, index));
  });
  return codes;
}

function overlapsDaylight(window: PrecipitationWindow): boolean {
  const startHour = Number.parseInt(window.startTime.slice(11, 13), 10);
  const endHour = Number.parseInt(window.endTime.slice(11, 13), 10);
  return startHour <= DAYLIGHT_END_HOUR && endHour >= DAYLIGHT_START_HOUR;
}

const CONDITIONS = {
  clear: { summary: "açık", emoji: "☀️" },
  mostlyClear: { summary: "az bulutlu", emoji: "🌤️" },
  partlyCloudy: { summary: "parçalı bulutlu", emoji: "⛅" },
  overcast: { summary: "kapalı", emoji: "☁️" },
  fog: { summary: "sisli", emoji: "🌫️" },
  drizzle: { summary: "çiseleyen yağmur", emoji: "🌦️" },
  lightRain: { summary: "hafif yağmurlu", emoji: "🌦️" },
  rain: { summary: "yağmurlu", emoji: "🌧️" },
  heavyRain: { summary: "kuvvetli yağmurlu", emoji: "🌧️" },
  showers: { summary: "sağanak yağışlı", emoji: "🌦️" },
  snow: { summary: "karlı", emoji: "🌨️" },
  snowShowers: { summary: "kar sağanaklı", emoji: "🌨️" },
  thunder: { summary: "gök gürültülü sağanak", emoji: "⛈️" },
  unknown: { summary: "değişken", emoji: "🌡️" }
} as const satisfies Record<string, { summary: string; emoji: string }>;

type Condition = { summary: string; emoji: string };

type CodeFamily =
  | "clear"
  | "mostlyClear"
  | "partlyCloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "showers"
  | "snowShowers"
  | "thunder";

function codeFamily(code: number): CodeFamily | undefined {
  if (code === 0) return "clear";
  if (code === 1) return "mostlyClear";
  if (code === 2) return "partlyCloudy";
  if (code === 3) return "overcast";
  if (code >= 45 && code <= 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 85 && code <= 86) return "snowShowers";
  if (code >= 95 && code <= 99) return "thunder";
  return undefined;
}

const WET_FAMILIES: ReadonlySet<CodeFamily> = new Set(["drizzle", "rain", "snow", "showers", "snowShowers", "thunder"]);

function isWetCode(code: number): boolean {
  const family = codeFamily(code);
  return family !== undefined && WET_FAMILIES.has(family);
}

export const LIGHT_RAIN_MAX_MM = 5;
export const HEAVY_RAIN_MIN_MM = 20;
export const THUNDER_SHARE = 0.2;
export const MAJORITY_SHARE = 0.5;

export function classifyEnsembleDay(input: {
  dayCodes: number[];
  daylightCodes: number[];
  wetDaytime: boolean;
  totalMm?: number;
}): Condition {
  if (input.wetDaytime) {
    const counts = familyCounts(input.dayCodes.filter(isWetCode));
    const wetTotal = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const share = (...families: CodeFamily[]) =>
      wetTotal > 0 ? families.reduce((sum, family) => sum + (counts.get(family) ?? 0), 0) / wetTotal : 0;

    if (share("thunder") >= THUNDER_SHARE) {
      return CONDITIONS.thunder;
    }
    if (share("snow", "snowShowers") >= MAJORITY_SHARE) {
      return (counts.get("snowShowers") ?? 0) > (counts.get("snow") ?? 0) ? CONDITIONS.snowShowers : CONDITIONS.snow;
    }
    if (share("showers") >= MAJORITY_SHARE) {
      return CONDITIONS.showers;
    }
    const amount = input.totalMm;
    if (amount === undefined) {
      return CONDITIONS.rain;
    }
    if (amount >= HEAVY_RAIN_MIN_MM) {
      return CONDITIONS.heavyRain;
    }
    return amount < LIGHT_RAIN_MAX_MM ? CONDITIONS.lightRain : CONDITIONS.rain;
  }

  const counts = familyCounts(input.daylightCodes);
  const overcastVotes = [...counts.entries()]
    .filter(([family]) => family === "overcast" || WET_FAMILIES.has(family))
    .reduce((sum, [, count]) => sum + count, 0);
  const mostlyClear = counts.get("mostlyClear") ?? 0;
  const partlyCloudy = counts.get("partlyCloudy") ?? 0;
  const groups: Array<{ votes: number; condition: Condition }> = [
    { votes: counts.get("clear") ?? 0, condition: CONDITIONS.clear },
    {
      votes: mostlyClear + partlyCloudy,
      condition: partlyCloudy > mostlyClear ? CONDITIONS.partlyCloudy : CONDITIONS.mostlyClear
    },
    { votes: overcastVotes, condition: CONDITIONS.overcast },
    { votes: counts.get("fog") ?? 0, condition: CONDITIONS.fog }
  ];
  const best = groups.reduce((winner, group) => (group.votes > winner.votes ? group : winner));
  return best.votes > 0 ? best.condition : CONDITIONS.unknown;
}

function familyCounts(codes: number[]): Map<CodeFamily, number> {
  const counts = new Map<CodeFamily, number>();
  for (const code of codes) {
    const family = codeFamily(code);
    if (family) {
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
  }
  return counts;
}

export function buildDeterministicForecast(
  daily: Record<string, Array<number | null> | undefined>,
  models: string[],
  locationName: string,
  dateKey: string,
  index: number
): DailyForecast | undefined {
  const read = (field: string) => {
    for (const model of models) {
      const value = daily[`${field}_${model}`]?.[index];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    const direct = daily[field]?.[index];
    return typeof direct === "number" && Number.isFinite(direct) ? direct : undefined;
  };

  const min = read("temperature_2m_min");
  const max = read("temperature_2m_max");
  if (min === undefined || max === undefined) {
    return undefined;
  }

  const weatherCode = read("weather_code") ?? 0;
  const condition = wmoToCondition(weatherCode);

  return {
    dateKey,
    locationName,
    minTemperature: Math.round(min),
    maxTemperature: Math.round(max),
    precipitationProbability: read("precipitation_probability_max"),
    precipitationWindows: [],
    summary: condition.summary,
    emoji: condition.emoji,
    source: "deterministic",
    models,
    hourly: []
  };
}

function wmoToCondition(code: number): Condition {
  const family = codeFamily(code);
  if (!family) return CONDITIONS.unknown;
  return CONDITIONS[family] ?? CONDITIONS.unknown;
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const UV_PEAK_PLATEAU_RATIO = 0.9;

export function uvPeak(
  dayHours: Array<{ time: string; value: number }>
): Pick<DailyForecast, "uvPeakHour" | "uvPeakWindow"> {
  if (dayHours.length === 0) {
    return {};
  }
  const peak = dayHours.reduce((best, hour) => (hour.value > best.value ? hour : best));
  if (peak.value <= 0) {
    return {};
  }
  const plateau = dayHours.filter((hour) => hour.value >= peak.value * UV_PEAK_PLATEAU_RATIO);
  const first = plateau[0];
  const last = plateau[plateau.length - 1];
  return {
    uvPeakHour: peak.time,
    ...(first && last && first.time !== last.time ? { uvPeakWindow: { start: first.time, end: last.time } } : {})
  };
}

// Telegram Rapor Formatlama
export function formatForecast(
  forecasts: DailyForecast[],
  now: Date,
  timezone: string
): string {
  const first = forecasts[0];
  if (!first) {
    return "";
  }

  const blocks = forecasts.map((forecast) => {
    return [
      `${forecast.emoji} ${bold(dayLabel(forecast.dateKey, now, timezone))} · ${escapeHtml(forecast.summary)}`,
      ...forecastDetailLines(forecast)
    ].join("\n");
  });

  return [
    bold(`🌤️ Hava Durumu — ${first.locationName}`),
    "",
    blocks.join("\n\n"),
    "",
    `<i>${escapeHtml(forecastSourceLabel(first))}</i>`
  ].join("\n");
}

function dayLabel(dateKey: string, now: Date, timezone: string): string {
  const todayKey = toDateKey(now, timezone);
  const tomorrowKey = toDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000), timezone);
  if (dateKey === todayKey) return "Bugün";
  if (dateKey === tomorrowKey) return "Yarın";
  return formatDateOnly(dateKey, timezone);
}

function forecastDetailLines(forecast: DailyForecast): string[] {
  const lines: string[] = [];
  lines.push(`🌡️ Sıcaklık: ${forecast.minTemperature}°C … ${forecast.maxTemperature}°C`);

  if (forecast.precipitationWindows.length > 0) {
    for (const win of forecast.precipitationWindows) {
      const amountStr = win.totalMm > 0 ? ` (~${win.totalMm} mm)` : "";
      lines.push(`☔ Yağış: ${hourLabel(win.startTime)}–${hourLabel(win.endTime)} (%${win.peakProbability} olasılık${amountStr})`);
    }
  } else if (forecast.precipitationProbability && forecast.precipitationProbability > 0) {
    lines.push(`☔ Yağış İhtimali: %${forecast.precipitationProbability}`);
  }

  if (forecast.humidityMin !== undefined && forecast.humidityMax !== undefined) {
    lines.push(`💧 Nem: %${forecast.humidityMin}–%${forecast.humidityMax}`);
  }

  if (forecast.windSpeed !== undefined) {
    const desc = describeWindSpeed(forecast.windSpeed);
    const dir = forecast.windDirection !== undefined ? ` (${describeWindDirection(forecast.windDirection)})` : "";
    lines.push(`💨 Rüzgar: ${forecast.windSpeed} km/s ${desc.label}${dir}`);
  }

  if (forecast.uvIndexMax !== undefined && forecast.uvIndexMax >= 3) {
    const uvDesc = describeUvIndex(forecast.uvIndexMax);
    const peakStr = forecast.uvPeakHour ? ` (en yüksek ${hourLabel(forecast.uvPeakHour)})` : "";
    lines.push(`☀️ UV İndeksi: ${forecast.uvIndexMax} ${uvDesc.label} ${uvDesc.emoji}${peakStr}`);
  }

  return lines;
}

function forecastSourceLabel(forecast: DailyForecast): string {
  if (forecast.source === "ensemble") {
    return `Kaynak: Open-Meteo Çoklu Model Ensemble (${forecast.models.join(", ")})`;
  }
  return "Kaynak: Open-Meteo Tahmin Servisi";
}
