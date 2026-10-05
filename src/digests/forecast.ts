export type MemberSeries = Array<Array<number | null> | undefined>;

export interface HourlyPoint {
  time: string;
  medianTemperature?: number;
  precipitationProbability?: number;
  precipitationMm?: number;
  precipitationMembers?: Array<number | null>;
  medianHumidity?: number;
  medianWindSpeed?: number;
  medianWindGusts?: number;
  windDirection?: number;
}

export interface PrecipitationAmount {
  low: number;
  median: number;
  high: number;
}

export interface PrecipitationWindow {
  startTime: string;
  endTime: string;
  peakProbability: number;
  probability?: number;
  amount?: PrecipitationAmount;
  totalMm: number;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower !== undefined && upper !== undefined ? (lower + upper) / 2 : undefined;
}

export function quantile(values: number[], p: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

export function memberValuesAt(series: MemberSeries, index: number): number[] {
  const values: number[] = [];
  for (const member of series) {
    const value = member?.[index];
    if (typeof value === "number" && Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values;
}

export interface HourlySeriesInput {
  times: string[];
  temperature: MemberSeries;
  precipitation: MemberSeries;
  humidity?: MemberSeries;
  windSpeed?: MemberSeries;
  windGusts?: MemberSeries;
  windDirection?: MemberSeries;
  wetThresholdMm?: number;
}

export function buildHourlySeries(input: HourlySeriesInput): HourlyPoint[] {
  const wetThresholdMm = input.wetThresholdMm ?? WET_HOUR_THRESHOLD_MM;

  return input.times.map((time, index) => {
    const temperatures = memberValuesAt(input.temperature, index);
    const precipitationIndex = index + 1;
    const precipitations = memberValuesAt(input.precipitation, precipitationIndex);
    const wetMembers = precipitations.filter((value) => value >= wetThresholdMm);

    const point: HourlyPoint = { time };

    const medianTemperature = median(temperatures);
    if (medianTemperature !== undefined) {
      point.medianTemperature = medianTemperature;
    }

    if (precipitations.length > 0) {
      point.precipitationProbability = Math.round((wetMembers.length / precipitations.length) * 100);
      const wetAmount = median(wetMembers);
      if (wetAmount !== undefined) {
        point.precipitationMm = wetAmount;
      }
      point.precipitationMembers = input.precipitation.map((member) => {
        const value = member?.[precipitationIndex];
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      });
    }

    const medianHumidity = median(memberValuesAt(input.humidity ?? [], index));
    if (medianHumidity !== undefined) {
      point.medianHumidity = medianHumidity;
    }

    const medianWindSpeed = median(memberValuesAt(input.windSpeed ?? [], index));
    if (medianWindSpeed !== undefined) {
      point.medianWindSpeed = medianWindSpeed;
    }

    const medianWindGusts = median(memberValuesAt(input.windGusts ?? [], index));
    if (medianWindGusts !== undefined) {
      point.medianWindGusts = medianWindGusts;
    }

    const direction = circularMean(memberValuesAt(input.windDirection ?? [], index));
    if (direction !== undefined) {
      point.windDirection = direction;
    }

    return point;
  });
}

export function circularMean(degrees: number[]): number | undefined {
  if (degrees.length === 0) {
    return undefined;
  }

  let sinSum = 0;
  let cosSum = 0;
  for (const degree of degrees) {
    const radian = (degree * Math.PI) / 180;
    sinSum += Math.sin(radian);
    cosSum += Math.cos(radian);
  }

  const resultantLength = Math.hypot(sinSum, cosSum) / degrees.length;
  if (resultantLength < MINIMUM_DIRECTION_AGREEMENT) {
    return undefined;
  }

  return ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360;
}

export const MINIMUM_DIRECTION_AGREEMENT = 0.15;

const COMPASS_POINTS = [
  "K", "KKD", "KD", "DKD",
  "D", "DGD", "GD", "GGD",
  "G", "GGB", "GB", "BGB",
  "B", "BKB", "KB", "KKB"
] as const;

export function describeWindDirection(degrees: number): string {
  const index = Math.round(((degrees % 360) + 360) % 360 / 22.5) % COMPASS_POINTS.length;
  return COMPASS_POINTS[index] ?? "K";
}

export interface WindDescription {
  label: string;
  advice?: string;
}

export const WIND_ADVICE_UMBRELLA_KMH = 50;
export const WIND_ADVICE_OPEN_AREA_KMH = 60;
export const WIND_ADVICE_DEBRIS_KMH = 75;

export function describeWindSpeed(kmh: number): WindDescription {
  const label = kmh < 12 ? "hafif" : kmh < 29 ? "orta" : kmh < 39 ? "sert" : kmh < 62 ? "kuvvetli" : "fırtına";
  if (kmh >= WIND_ADVICE_DEBRIS_KMH) {
    return { label, advice: "dışarıda savrulan cisim riski" };
  }
  if (kmh >= WIND_ADVICE_OPEN_AREA_KMH) {
    return { label, advice: "açık alanda dikkat" };
  }
  if (kmh >= WIND_ADVICE_UMBRELLA_KMH) {
    return { label, advice: "şemsiye zor durur" };
  }
  return { label };
}

export const WET_HOUR_THRESHOLD_MM = 0.2;
export const REPORTABLE_PROBABILITY_PERCENT = 50;

export function findPrecipitationWindows(
  points: HourlyPoint[],
  minimumProbability = REPORTABLE_PROBABILITY_PERCENT
): PrecipitationWindow[] {
  const spans: Array<{ first: number; last: number }> = [];
  let current: { first: number; last: number; gap: number } | undefined;

  for (const [index, point] of points.entries()) {
    const isWet = (point.precipitationProbability ?? 0) >= minimumProbability;
    if (isWet) {
      current = current ? { ...current, last: index, gap: 0 } : { first: index, last: index, gap: 0 };
      continue;
    }
    if (current) {
      current.gap += 1;
      if (current.gap > MAX_DRY_GAP_HOURS) {
        spans.push(current);
        current = undefined;
      }
    }
  }
  if (current) {
    spans.push(current);
  }

  return spans.map(({ first, last }) => buildWindow(points.slice(first, last + 1)));
}

function buildWindow(span: HourlyPoint[]): PrecipitationWindow {
  const first = span[0];
  const last = span[span.length - 1];
  const peakProbability = Math.max(0, ...span.map((point) => point.precipitationProbability ?? 0));
  const members = memberPrecipitation(span);
  const hourlySum = roundTo(span.reduce((sum, point) => sum + (point.precipitationMm ?? 0), 0), 1);

  return {
    startTime: first?.time ?? "",
    endTime: last?.time ?? "",
    peakProbability,
    ...(members ? { probability: Math.max(members.probability, peakProbability) } : {}),
    ...(members?.amount ? { amount: members.amount } : {}),
    totalMm: members?.amount?.median ?? hourlySum
  };
}

export const MAX_DRY_GAP_HOURS = 1;

export function memberPrecipitation(
  points: HourlyPoint[],
  wetThresholdMm = WET_HOUR_THRESHOLD_MM
): { probability: number; amount?: PrecipitationAmount } | undefined {
  const memberCount = Math.max(0, ...points.map((point) => point.precipitationMembers?.length ?? 0));
  if (memberCount === 0) {
    return undefined;
  }

  let reporting = 0;
  const wetTotals: number[] = [];
  for (let member = 0; member < memberCount; member += 1) {
    let total = 0;
    let wet = false;
    let reported = false;
    for (const point of points) {
      const value = point.precipitationMembers?.[member];
      if (typeof value !== "number") {
        continue;
      }
      reported = true;
      total += value;
      wet ||= value >= wetThresholdMm;
    }
    if (!reported) {
      continue;
    }
    reporting += 1;
    if (wet) {
      wetTotals.push(total);
    }
  }

  if (reporting === 0) {
    return undefined;
  }
  const probability = Math.round((wetTotals.length / reporting) * 100);
  if (wetTotals.length === 0) {
    return { probability };
  }

  return {
    probability,
    amount: {
      low: roundTo(quantile(wetTotals, 0.25) ?? 0, 1),
      median: roundTo(quantile(wetTotals, 0.5) ?? 0, 1),
      high: roundTo(quantile(wetTotals, 0.75) ?? 0, 1)
    }
  };
}

export interface PrecipitationSummary {
  windows: PrecipitationWindow[];
  peakProbability: number;
  total?: PrecipitationAmount;
  totalMm: number;
}

export function summarizePrecipitation(points: HourlyPoint[]): PrecipitationSummary {
  const windows = findPrecipitationWindows(points);
  const peakProbability = Math.max(0, ...points.map((point) => point.precipitationProbability ?? 0));
  const windowPoints = points.filter((point) =>
    windows.some((window) => point.time >= window.startTime && point.time <= window.endTime)
  );
  const total = windowPoints.length > 0 ? memberPrecipitation(windowPoints)?.amount : undefined;
  const totalMm = total?.median ?? roundTo(windows.reduce((sum, window) => sum + window.totalMm, 0), 1);
  return { windows, peakProbability, ...(total ? { total } : {}), totalMm };
}

export function pointsForDate(points: HourlyPoint[], dateKey: string): HourlyPoint[] {
  return points.filter((point) => point.time.startsWith(dateKey));
}

export const DAYLIGHT_START_HOUR = 7;
export const DAYLIGHT_END_HOUR = 21;

export function daylightPoints(
  points: HourlyPoint[],
  startHour = DAYLIGHT_START_HOUR,
  endHour = DAYLIGHT_END_HOUR
): HourlyPoint[] {
  return points.filter((point) => {
    const hour = Number.parseInt(point.time.slice(11, 13), 10);
    return !Number.isNaN(hour) && hour >= startHour && hour <= endHour;
  });
}

export function hourLabel(isoTime: string): string {
  return isoTime.slice(11, 16);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface UvDescription {
  label: string;
  emoji: string;
  advice?: string;
}

export function describeUvIndex(value: number): UvDescription {
  if (value < 3) {
    return { label: "düşük", emoji: "🟢" };
  }
  if (value < 6) {
    return { label: "orta", emoji: "🟡" };
  }
  if (value < 8) {
    return { label: "yüksek", emoji: "🟠", advice: "öğle saatlerinde gölge ve koruyucu" };
  }
  if (value < 11) {
    return { label: "çok yüksek", emoji: "🔴", advice: "11:00–16:00 arası doğrudan güneşten kaçının" };
  }
  return { label: "aşırı", emoji: "🟣", advice: "öğle saatlerinde dışarıda kalmayın" };
}

export function memberDailyExtremes(
  members: MemberSeries,
  times: string[],
  dateKey: string,
  hourRange?: { start: number; end: number }
): { maxima: number[]; minima: number[] } {
  const indices: number[] = [];
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
    indices.push(index);
  });

  const maxima: number[] = [];
  const minima: number[] = [];

  for (const member of members) {
    if (!member) {
      continue;
    }
    const values: number[] = [];
    for (const index of indices) {
      const value = member[index];
      if (typeof value === "number" && Number.isFinite(value)) {
        values.push(value);
      }
    }
    if (values.length > 0) {
      maxima.push(Math.max(...values));
      minima.push(Math.min(...values));
    }
  }

  return { maxima, minima };
}
