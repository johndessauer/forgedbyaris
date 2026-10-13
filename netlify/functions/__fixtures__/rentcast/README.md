# RentCast fixtures

Used by `netlify/functions/rentcast-comps.js` in **mock** mode (`RENTCAST_MOCK=1`)
and **demo** mode (no `RENTCAST_API_KEY`), and by the unit tests.

- Shapes follow RentCast's documented example responses
  (developers.rentcast.io: Property Data, Property Valuation, Market Data, read Oct 12, 2026).
- Data is invented, centered on a Crown Point, IN subject (733 N Main St) so it
  matches the Property Search demo dataset. Not real sales.
- Dates are anchored to **2026-10-12**. In demo/mock mode the loader shifts every
  `*Date` / `date` field forward by (today − anchor), so the demo keeps showing
  "recent" sales instead of aging out of the 90-day window.

`properties-sold.json` is built to exercise every rule: 5 clean comps inside
1 mi / 90 days, one sold 114 days ago (days ladder), one 1.4 mi away (radius
ladder), a $4,500 non-arm's-length sale, a $/sqft outlier, a condo (type), and
a 5-bed 2,600 sqft house (beds/sqft). `avm-value.json` repeats one recorded
sale (615 N East St) as a listing, to exercise de-duplication.
