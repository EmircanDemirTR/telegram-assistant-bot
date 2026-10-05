import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHourlySeries,
  circularMean,
  daylightPoints,
  describeUvIndex,
  describeWindDirection,
  describeWindSpeed,
  findPrecipitationWindows,
  hourLabel,
  memberDailyExtremes,
  memberPrecipitation,
  median,
  memberValuesAt,
  pointsForDate,
  quantile,
  summarizePrecipitation
} from "../src/digests/forecast.js";
import {
  buildDeterministicForecast,
  buildEnsembleDay,
  classifyEnsembleDay,
  collectMembers,
  summarizeConditions,
  uvPeak,
  weatherCodesFor
} from "../src/integrations/weather.js";

test("median ignores outliers that would drag a mean", () => {
  assert.equal(median([20, 21, 22, 23, 24]), 22);
  assert.equal(median([20, 21, 22, 23, 90]), 22, "tek uc uye medyani bozmaz");
  assert.equal(median([20, 22]), 21, "cift sayida uyede orta iki degerin ortalamasi");
  assert.equal(median([]), undefined);
});

test("quantile interpolates linearly and agrees with the median", () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2);
  assert.equal(quantile([1, 2, 3, 4], 0.5), median([1, 2, 3, 4]));
  assert.equal(quantile([10, 20], 0.75), 17.5);
  assert.equal(quantile([], 0.5), undefined);
  const maxima = [20, 20.5, 21, 21, 21.5, 21.5, 22, 22, 22.5, 30];
  assert.ok((quantile(maxima, 0.9) ?? 0) - (quantile(maxima, 0.1) ?? 0) < 3.5);
});

test("null members are skipped instead of counted as zero", () => {
  const series = [[21, null], [22, 23], undefined, [null, 24]];
  assert.deepEqual(memberValuesAt(series, 0), [21, 22]);
  assert.deepEqual(memberValuesAt(series, 1), [23, 24]);
});

test("consecutive wet hours collapse into one window", () => {
  const points = [
    { time: "2026-07-29T13:00", precipitationProbability: 20 },
    { time: "2026-07-29T14:00", precipitationProbability: 70, precipitationMm: 1 },
    { time: "2026-07-29T15:00", precipitationProbability: 80, precipitationMm: 2 },
    { time: "2026-07-29T16:00", precipitationProbability: 60, precipitationMm: 1 },
    { time: "2026-07-29T17:00", precipitationProbability: 10 }
  ];

  const windows = findPrecipitationWindows(points, 50);
  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.startTime, "2026-07-29T14:00");
  assert.equal(windows[0]?.endTime, "2026-07-29T16:00");
  assert.equal(windows[0]?.peakProbability, 80);
  assert.equal(windows[0]?.totalMm, 4);
});

test("degrees become compass points", () => {
  assert.equal(describeWindDirection(0), "K");
  assert.equal(describeWindDirection(360), "K");
  assert.equal(describeWindDirection(45), "KD");
  assert.equal(describeWindDirection(90), "D");
  assert.equal(describeWindDirection(180), "G");
  assert.equal(describeWindDirection(270), "B");
  assert.equal(describeWindDirection(315), "KB");
});

test("UV index maps to the WHO scale", () => {
  assert.equal(describeUvIndex(1.5).label, "düşük");
  assert.equal(describeUvIndex(4.2).label, "orta");
  assert.equal(describeUvIndex(6.8).label, "yüksek");
  assert.equal(describeUvIndex(9.1).label, "çok yüksek");
  assert.equal(describeUvIndex(11.5).label, "aşırı");
});
