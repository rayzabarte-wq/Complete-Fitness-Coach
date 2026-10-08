// Comparisons with public reference data. Only used when the person has
// given BENCHMARKING consent and filled in their profile.
//
// Body fat: healthy ranges by sex and age from Gallagher et al. (2000),
// "Healthy percentage body fat ranges: an approach for developing guidelines
// based on body mass index", American Journal of Clinical Nutrition 72(3).
// These are the ranges most consumer scales (Renpho included) are built on.
// BMI: WHO adult categories.

export type Sex = "MALE" | "FEMALE";

interface BandRow {
  minAge: number;
  maxAge: number;
  /** [under-fat below, healthy up to, overweight up to] — above = obese range. */
  cutoffs: [number, number, number];
}

const BODY_FAT: Record<Sex, BandRow[]> = {
  MALE: [
    { minAge: 20, maxAge: 39, cutoffs: [8, 20, 25] },
    { minAge: 40, maxAge: 59, cutoffs: [11, 22, 28] },
    { minAge: 60, maxAge: 79, cutoffs: [13, 25, 30] },
  ],
  FEMALE: [
    { minAge: 20, maxAge: 39, cutoffs: [21, 33, 39] },
    { minAge: 40, maxAge: 59, cutoffs: [23, 34, 40] },
    { minAge: 60, maxAge: 79, cutoffs: [24, 36, 42] },
  ],
};

export interface Benchmark {
  metric: "BODY_FAT_PCT" | "BMI";
  value: number;
  category: string;
  rangeText: string;
  source: string;
}

export function bodyFatBenchmark(sex: Sex, age: number, bodyFatPct: number): Benchmark | null {
  const row = BODY_FAT[sex].find((r) => age >= r.minAge && age <= r.maxAge);
  if (!row) return null;
  const [under, healthy, over] = row.cutoffs;
  const category =
    bodyFatPct < under ? "Below the healthy range" : bodyFatPct < healthy ? "Healthy range" : bodyFatPct < over ? "Above the healthy range" : "Well above the healthy range";
  const who = `${sex === "MALE" ? "men" : "women"} aged ${row.minAge}–${row.maxAge}`;
  return {
    metric: "BODY_FAT_PCT",
    value: Math.round(bodyFatPct * 10) / 10,
    category,
    rangeText: `Healthy for ${who}: ${under}% to under ${healthy}%`,
    source: "Gallagher et al. 2000, Am J Clin Nutr",
  };
}

export function bmiBenchmark(heightCm: number, weightKg: number): Benchmark {
  const bmi = weightKg / (heightCm / 100) ** 2;
  const category = bmi < 18.5 ? "Underweight" : bmi < 25 ? "Healthy weight" : bmi < 30 ? "Overweight" : "Obese";
  return {
    metric: "BMI",
    value: Math.round(bmi * 10) / 10,
    category,
    rangeText: "Healthy: 18.5–24.9. BMI doesn't separate muscle from fat, so read it alongside body fat.",
    source: "WHO adult BMI categories",
  };
}
