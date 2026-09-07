import { describe, expect, it } from "vitest";

import {
  daysInJalaliMonth,
  gregorianToJalali,
  isLeapJalaliYear,
  isValidJalaliDate,
  jalaliToGregorian,
} from "./jalali.js";

describe("jalaliToGregorian / gregorianToJalali round-trip", () => {
  it("round-trips the first day of every month across several years", () => {
    for (let year = 1390; year <= 1410; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const g = jalaliToGregorian(year, month, 1);
        expect(g).not.toBeNull();
        const back = gregorianToJalali(g!.year, g!.month, g!.day);
        expect(back).toEqual({ year, month, day: 1 });
      }
    }
  });

  it("round-trips the last day of every month, respecting each month's real length", () => {
    for (let year = 1395; year <= 1405; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const days = daysInJalaliMonth(year, month)!;
        const g = jalaliToGregorian(year, month, days);
        expect(g).not.toBeNull();
        const back = gregorianToJalali(g!.year, g!.month, g!.day);
        expect(back).toEqual({ year, month, day: days });
      }
    }
  });

  it("round-trips a long consecutive run of Gregorian days with no gaps or duplicates", () => {
    // Walk three full years of Gregorian dates; the Jalali sequence must be strictly
    // increasing by exactly one day at a time, including across every month/year rollover.
    let cursor = new Date(Date.UTC(2023, 0, 1));
    const end = new Date(Date.UTC(2026, 0, 1));
    let previous: { year: number; month: number; day: number } | null = null;

    while (cursor < end) {
      const jalali = gregorianToJalali(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + 1,
        cursor.getUTCDate(),
      );
      expect(jalali).not.toBeNull();
      expect(isValidJalaliDate(jalali!.year, jalali!.month, jalali!.day)).toBe(true);

      if (previous !== null) {
        const isNextDay =
          (jalali!.year === previous.year &&
            jalali!.month === previous.month &&
            jalali!.day === previous.day + 1) ||
          (jalali!.year === previous.year &&
            jalali!.month === previous.month + 1 &&
            jalali!.day === 1) ||
          (jalali!.year === previous.year + 1 &&
            jalali!.month === 1 &&
            jalali!.day === 1 &&
            previous.month === 12);
        expect(isNextDay).toBe(true);
      }
      previous = jalali;
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
  });
});

describe("Nowruz falls on March 20 or 21, never any other date", () => {
  it.each(Array.from({ length: 40 }, (_, i) => 1380 + i))("for Jalali year %i", (year) => {
    const nowruz = jalaliToGregorian(year, 1, 1);
    expect(nowruz).not.toBeNull();
    expect(nowruz!.month).toBe(3);
    expect([20, 21]).toContain(nowruz!.day);
  });
});

describe("known reference dates", () => {
  // These are widely and publicly documented Iranian New Year dates, used here as anchor
  // points so a systematic day-offset bug (which round-trip tests alone cannot catch, since
  // they'd still round-trip consistently even if shifted) is caught.
  it("1 Farvardin 1403 is 20 March 2024", () => {
    expect(jalaliToGregorian(1403, 1, 1)).toEqual({ year: 2024, month: 3, day: 20 });
  });

  it("1 Farvardin 1400 is 21 March 2021", () => {
    expect(jalaliToGregorian(1400, 1, 1)).toEqual({ year: 2021, month: 3, day: 21 });
  });
});

describe("leap years", () => {
  it("a leap Jalali year's 12th month (Esfand) has 30 days", () => {
    // Find a leap year within a small window rather than hard-coding which one, so this
    // test doesn't depend on a specific memorized leap-year fact.
    const leapYear = findYearWhere(1390, 1410, (y) => isLeapJalaliYear(y) === true);
    expect(leapYear).not.toBeNull();
    expect(daysInJalaliMonth(leapYear!, 12)).toBe(30);
  });

  it("a non-leap Jalali year's 12th month (Esfand) has 29 days", () => {
    const commonYear = findYearWhere(1390, 1410, (y) => isLeapJalaliYear(y) === false);
    expect(commonYear).not.toBeNull();
    expect(daysInJalaliMonth(commonYear!, 12)).toBe(29);
  });

  it("day 30 of Esfand is valid only in a leap year", () => {
    const leapYear = findYearWhere(1390, 1410, (y) => isLeapJalaliYear(y) === true)!;
    const commonYear = findYearWhere(1390, 1410, (y) => isLeapJalaliYear(y) === false)!;
    expect(isValidJalaliDate(leapYear, 12, 30)).toBe(true);
    expect(isValidJalaliDate(commonYear, 12, 30)).toBe(false);
  });

  it("leap years occur at a plausible frequency (roughly every 4 years)", () => {
    let leapCount = 0;
    for (let year = 1300; year <= 1400; year += 1) {
      if (isLeapJalaliYear(year) === true) leapCount += 1;
    }
    // ~100 years / 4 ≈ 25, with the calendar's known variance around that.
    expect(leapCount).toBeGreaterThan(20);
    expect(leapCount).toBeLessThan(30);
  });
});

describe("invalid dates", () => {
  it("rejects month 0 and month 13", () => {
    expect(isValidJalaliDate(1403, 0, 1)).toBe(false);
    expect(isValidJalaliDate(1403, 13, 1)).toBe(false);
  });

  it("rejects day 31 in a month that only has 30 days", () => {
    expect(isValidJalaliDate(1403, 7, 31)).toBe(false);
    expect(isValidJalaliDate(1403, 7, 30)).toBe(true);
  });

  it("rejects day 0 and negative days", () => {
    expect(isValidJalaliDate(1403, 1, 0)).toBe(false);
    expect(isValidJalaliDate(1403, 1, -1)).toBe(false);
  });

  it("rejects a non-integer component", () => {
    expect(isValidJalaliDate(1403, 1.5, 1)).toBe(false);
    expect(isValidJalaliDate(1403, 1, 1.5)).toBe(false);
  });

  it("jalaliToGregorian returns null for an invalid date rather than a best guess", () => {
    expect(jalaliToGregorian(1403, 13, 1)).toBeNull();
    expect(jalaliToGregorian(1403, 7, 31)).toBeNull();
  });

  it("fails closed for a Jalali year far outside the supported domain", () => {
    expect(jalaliToGregorian(999_999, 1, 1)).toBeNull();
    expect(isLeapJalaliYear(999_999)).toBeNull();
  });
});

function findYearWhere(
  from: number,
  to: number,
  predicate: (year: number) => boolean,
): number | null {
  for (let year = from; year <= to; year += 1) {
    if (predicate(year)) return year;
  }
  return null;
}
