/**
 * Jalali (Persian) calendar utilities (MASTER_PROMPT §10).
 *
 * Internal timestamps stay UTC everywhere in this system (ARCHITECTURE §6); this module only
 * serves the display/input boundary, converting to and from Jalali on request. It never
 * changes the storage convention.
 *
 * The conversion goes through the Julian Day Number as a common intermediate, using the
 * standard Fliegel & Van Flandern Gregorian↔JDN formulas and the Borkowski 33-year-cycle
 * break-point algorithm for Jalali leap years — the same published, public-domain
 * astronomical-calendar mathematics widely used for accurate Gregorian↔Jalali conversion
 * (independently reimplemented here, not copied from any single project's source).
 *
 * `jalCal` is only valid for Jalali years in [-61, 3178) — comfortably wider than any year a
 * real-estate listing could plausibly need — so out-of-domain input fails closed (`null`)
 * rather than throwing or producing a wrong date.
 */

const div = (a: number, b: number): number => Math.trunc(a / b);
const mod = (a: number, b: number): number => a % b;

/** Cumulative break points of the 2820-year grand cycle (Borkowski's algorithm). */
const BREAKS: readonly number[] = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

interface JalCalResult {
  /** 0 means `jy` itself is a leap year; otherwise, years since the last leap year. */
  leap: number;
  /** The Gregorian year in which this Jalali year begins. */
  gy: number;
  /** The Gregorian day of March on which 1 Farvardin falls (20 or 21). */
  march: number;
}

function jalCal(jy: number): JalCalResult {
  const bl = BREAKS.length;
  const gy = jy + 621;

  if (jy < BREAKS[0]! || jy >= BREAKS[bl - 1]!) {
    throw new RangeError(`Jalali year ${String(jy)} is outside the supported range`);
  }

  let leapJ = -14;
  let jp = BREAKS[0]!;
  let jump = 0;
  let i = 1;
  for (; i < bl; i += 1) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;

  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

/** Gregorian calendar date → Julian Day Number. */
function gregorianToJdn(gy: number, gm: number, gd: number): number {
  const d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}

/** Julian Day Number → Gregorian calendar date. */
function jdnToGregorian(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export interface JalaliDate {
  year: number;
  month: number;
  day: number;
}

export interface GregorianDate {
  year: number;
  month: number;
  day: number;
}

export function isLeapJalaliYear(jy: number): boolean | null {
  try {
    return jalCal(jy).leap === 0;
  } catch {
    return null;
  }
}

export function daysInJalaliMonth(jy: number, jm: number): number | null {
  if (!Number.isInteger(jm) || jm < 1 || jm > 12) return null;
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const leap = isLeapJalaliYear(jy);
  if (leap === null) return null;
  return leap ? 30 : 29;
}

export function isValidJalaliDate(jy: number, jm: number, jd: number): boolean {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return false;
  const days = daysInJalaliMonth(jy, jm);
  if (days === null) return false;
  return jd >= 1 && jd <= days;
}

/** Converts a Jalali date to Gregorian. Returns `null` for an invalid date or a year outside
 *  `jalCal`'s supported domain — never throws, and never returns a best-guess date. */
export function jalaliToGregorian(jy: number, jm: number, jd: number): GregorianDate | null {
  if (!isValidJalaliDate(jy, jm, jd)) return null;
  try {
    const r = jalCal(jy);
    const jdn = gregorianToJdn(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
    const g = jdnToGregorian(jdn);
    return { year: g.gy, month: g.gm, day: g.gd };
  } catch {
    return null;
  }
}

/** Converts a Gregorian date to Jalali. Returns `null` only if the resulting Jalali year
 *  falls outside `jalCal`'s supported domain — effectively unreachable for any real calendar
 *  date, but handled rather than left to throw. */
export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate | null {
  try {
    const jdn = gregorianToJdn(gy, gm, gd);
    // Farvardin-1-of-`gy - 621` is used only as a starting estimate; the JDN it actually
    // falls in (this year's Farvardin, or still finishing out the previous Jalali year) is
    // resolved below by the sign and size of `k`.
    let jy = gy - 621;
    const r = jalCal(jy);
    const jdn1f = gregorianToJdn(r.gy, 3, r.march);
    let k = jdn - jdn1f;

    if (k >= 0) {
      if (k <= 185) {
        return { year: jy, month: 1 + div(k, 31), day: mod(k, 31) + 1 };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    return { year: jy, month: 7 + div(k, 30), day: mod(k, 30) + 1 };
  } catch {
    return null;
  }
}
