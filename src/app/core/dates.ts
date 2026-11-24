/** Dates are ISO strings 'YYYY-MM-DD', handled in UTC so time zones never shift a day. */

export const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const parseIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const todayIso = () => {
  const n = new Date();
  return toIso(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
};

export const addDays = (s: string, n: number) => {
  const d = parseIso(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};

export const addMonths = (s: string, n: number) => {
  const d = parseIso(s);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};

export const dayOfWeek = (s: string) => parseIso(s).getUTCDay();

export const daysBetween = (a: string, b: string) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);

export const eachDay = (start: string, end: string) => {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
};

export type PeriodKind = 'week' | 'month' | 'year';

export interface Bucket {
  key: string;
  start: string;
  end: string;
  label: string;
}

export interface Period {
  kind: PeriodKind;
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  buckets: Bucket[];
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const monthShort = (m: number) => MONTHS_EN[m];
export const dayShort = (s: string) => DAYS_EN[dayOfWeek(s)];

/** "Sun 22 Nov" */
export const fmtDay = (s: string, withYear = false) => {
  const d = parseIso(s);
  return `${DAYS_EN[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS_EN[d.getUTCMonth()]}${withYear ? ' ' + d.getUTCFullYear() : ''}`;
};

/** "22 Nov" */
export const fmtShort = (s: string) => {
  const d = parseIso(s);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS_EN[d.getUTCMonth()]}`;
};

/**
 * The whole period containing `anchor`, and the whole previous period.
 * Comparisons are whole period vs whole period; days not entered count as 0.
 */
export function periodOf(kind: PeriodKind, anchor: string, weekStart: number, yearStartMonth: number): Period {
  if (kind === 'week') {
    const start = addDays(anchor, -((dayOfWeek(anchor) - weekStart + 7) % 7));
    const end = addDays(start, 6);
    return {
      kind, start, end, prevStart: addDays(start, -7), prevEnd: addDays(start, -1),
      buckets: eachDay(start, end).map((d) => ({ key: d, start: d, end: d, label: `${dayShort(d)}\n${parseIso(d).getUTCDate()}` })),
    };
  }
  if (kind === 'month') {
    const a = parseIso(anchor);
    const start = toIso(new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)));
    const end = addDays(addMonths(start, 1), -1);
    const prevStart = addMonths(start, -1);
    return {
      kind, start, end, prevStart, prevEnd: addDays(start, -1),
      buckets: eachDay(start, end).map((d) => {
        const n = parseIso(d).getUTCDate();
        return { key: d, start: d, end: d, label: n === 1 || n % 5 === 0 ? String(n) : '' };
      }),
    };
  }
  const a = parseIso(anchor);
  const y = a.getUTCMonth() >= yearStartMonth ? a.getUTCFullYear() : a.getUTCFullYear() - 1;
  const start = toIso(new Date(Date.UTC(y, yearStartMonth, 1)));
  const end = addDays(addMonths(start, 12), -1);
  const buckets: Bucket[] = [];
  for (let k = 0; k < 12; k++) {
    const s = addMonths(start, k);
    buckets.push({ key: s, start: s, end: addDays(addMonths(s, 1), -1), label: MONTHS_EN[parseIso(s).getUTCMonth()] });
  }
  return { kind, start, end, prevStart: addMonths(start, -12), prevEnd: addDays(start, -1), buckets };
}
