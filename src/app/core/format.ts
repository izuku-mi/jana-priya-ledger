/** Indian grouping: 2,45,500. */
export const group = (n: number) => {
  const neg = n < 0;
  const x = String(Math.round(Math.abs(n)));
  const last = x.slice(-3);
  const rest = x.slice(0, -3);
  const s = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last : last;
  return (neg ? '−' : '') + s;
};

/** ₹2,45,500 and −₹3,500 (true minus sign). */
export const inr = (n: number) => (n < 0 ? '−₹' + group(-n) : '₹' + group(n));

/** Short form for chart labels: 3.4L, 38k. */
export const short = (n: number) => (n >= 100000 ? (n / 100000).toFixed(1) + 'L' : n >= 1000 ? Math.round(n / 1000) + 'k' : n ? String(Math.round(n)) : '');

/** Parse what someone typed into a number field: digits only, empty → 0. */
export const parseCount = (v: string) => {
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
