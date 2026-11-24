# Jana Priya Ledger

Daily stock, sales, cash and profit ledger for Jana Priya Wines. An installable, offline Angular PWA.
Everything is stored in the browser (IndexedDB) on the phone that uses it; there is no server.

## Screens

| Route | What it does |
|---|---|
| `/dashboard` | Week / Month / Year sales against the whole previous period, cash vs UPI, stock value, top brands, alerts and notes |
| `/entry/:date` | The day's stock count. Opening = previous saved closing; closing follows opening + receipts − issues until typed. Fetch previous closing, cash and expenses, Save |
| `/inward/:date` | A delivery: brands, bottles, buy price, any number of named charges, invoice total and difference |
| `/stock` | Where the stock went, closing by day, days of stock left, bottles sold by day, stock not sold |
| `/pnl` | Sales → cost of goods → damages → shop costs → misc → net profit; cash out that is not a cost; cash check per day |
| `/settings` | Language, theme, year start month, week start day, brands and prices, backup / restore, import from the old app |

## How data is kept

- `sheets`: each day's form exactly as entered (`draft` or `saved`). This is the source of truth.
- On **Save**, the day's `movements` (RECEIPT / SALE / ISSUE), `balances` (closing per brand) and `cashDays` are rebuilt from the form.
  The dashboard, stock and P&L screens read only these, so unsaved edits never change the reports.
- `inwards`: deliveries. Saving one sets that day's Receipts and updates each brand's buy cost as a weighted average,
  with charges shared across the lines by value.
- A day can only be started once the day before it is saved (or marked "Shop was closed").
- Restore and import keep a safety copy of the current data (Settings → Undo last restore).

The calculations live in `src/app/core/ledger.ts` as plain functions and are covered by `ledger.spec.ts`,
including the 19 Nov 2026 paper sheet as a fixed check (sales ₹3,39,160, expected cash ₹2,46,078).

## Develop

Needs Node 22.22+ or 24 (`fnm use 24`).

```
npm install
npm start          # http://localhost:4200
npm test -- --watch=false
npm run build      # production build with the service worker, in dist/
```

The service worker only runs in a production build. To try offline mode, serve `dist/jana-priya-ledger/browser` over HTTP.
