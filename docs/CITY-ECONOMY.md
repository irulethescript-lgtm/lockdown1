# Lockdown city economy

## Running

Use Node 22+ and `npm ci`, then `npm start`. SQLite migrations are additive and run on startup. `DB_PATH` selects an isolated database; `PORT` defaults to 3000. Back up the database using SQLite's backup mechanism before deploying. The default repository includes a database and WAL files; local previews should use an external `DB_PATH`.

`npm test` runs the existing integration suite and `tests/economy.test.js` against temporary databases. No provider credentials are required. Stocks are simulated locally, not connected to a financial provider.

## Delivered systems

- The supplied city illustration, interactive district links, zoom/pan, and existing daily item finds. Shared navy/neon styling follows the supplied property reference. All 14 home types have local JPEG artwork. `public/img/properties/SOURCES.md` records image origins.
- The 14 standard property prices, base happiness and daily upkeep. Existing `starter`, `townhouse`, `villa`, `penthouse`, and `estate` ownership keys remain valid. Their displayed types are now Shack, Apartment, Villa, Penthouse and Mansion. Existing furnishings and storage are retained.
- Every listed upgrade tier and staff level, with property eligibility. Upgrade tiers replace lower tiers and cost the full listed price; interior happiness rounds to the nearest integer. Property happiness matches all supplied fully upgraded values without staff and 5,025 for a fully staffed/upgraded Private Island. Furnishings retain their separate legacy bonus.
- Estate-agent purchase/sale, player sale listings, immutable prepaid rental contracts, landlord extension offers, 100-day remaining-occupancy limit, 03:30 UTC lease expiry, unpaid rental debt transfer, daily upkeep, happiness penalties, and staff/moving restrictions.
- Property vault capacities, transaction logs, retained funds on moving, consensual spouse invitations, shared residence, spouse payment of upkeep, and explicit revocable vault access (off by default). Rented vaults are inaccessible. Occupied homes cannot be sold.
- Pool gym gains, shooting-range damage, additional medical regeneration, airstrip/pilot free travel with a 30% duration reduction and at least 15 cargo slots. Round-trip perks persist independently of current residence. ELT, property-broker and property-law discounts; resident lingerie-company fee waiver.
- All 35 stocks, 50-point Stock Ticker, minute quotes, no buying fee, 0.1% selling fee, purchase lots, newest-first aggregate sales, individual sales, merge positions, private realized P/L and fee accounting, status restrictions, passive maturity, exponential active blocks, claim-gated dividends, event notifications and MCS's 10-block/1,000-energy cap. Additional blocks join the next dividend cycle; reductions restart the reduced cycle. Duplicate claims cannot pay twice.
- HRG awards uniformly random standard property deeds (13 equally likely types); deeds wait for redemption if that type is already owned. Item dividends use the existing inventory catalog. TCC picks from the seven clothing cache types; BAG claims remain unavailable because its undocumented pack was retired.
- All 39 company startup types/costs/sizes; director/employee level gates; application editing, withdrawal, expiry, rejection cooldown and ten-application limit; employee positions/pay; 72-hour training restriction; stat-based effectiveness and settled/inactivity effects; company vault, product price, stock ordering, advertising, sequential upgrades, education gates, daily reports/payroll/trains/job points, Sunday ranking, transfer and sellback.
- Company job points persist by type. Lockdown's explicit **Extra Shift** special unlocks at 3 stars and spends one point for one energy, up to 100 points per UTC day after the recruit period.
- Business/property education course IDs from the request are enrollable. IST/WSU affect education costs/time; TCP/TGP affect company sales/advertising; WLT grants private travel.

## Clock and accounting

Economy actions run inside serialized SQLite transactions and validate ownership and balances on the server. A background tick every minute settles company closings, property fees/lease expiry, and stock readiness. Stored clocks make catch-up repeatable after restart. Company replay processes at most 365 closing days per tick and continues on subsequent ticks.

Upkeep and active dividends follow UTC midnight. Passive stocks require seven full elapsed days. Lease durations resolve to a 03:30 UTC boundary without exceeding 100 days; this can shorten the last partial day. Extra happiness from EVL lasts until the next UTC quarter-hour reset; it is separate from the normal residence cap. Daily upkeep is settled before changing staffing. Upfront rental acceptance settles old landlord upkeep from landlord funds, never from tenant debt.

## Explicit adaptations and remaining parity gaps

This implements Lockdown's economy, not a complete Torn server reproduction. Torn does not publish its stock pricing, company revenue/ranking algorithms, role-specific production formulas, or all effectiveness factors. Lockdown uses a bounded random quote change each minute, an explicit workforce/product-demand model, and revenue-based Sunday star targets (at most one rank gained per week). Company role stat requirements, warehouse sizes, advertising multipliers, and new education costs/durations are Lockdown balancing values.

The request references but does not enumerate the 12 unique estates or the company-specific Specials List. Those historical unique properties and Torn's full per-company special catalog are not included. Extra Shift is a labeled Lockdown special, not a claim to reproduce that catalog.

The legacy ownership schema supports one home of each type per player. It does not yet support multiple separate instances of the same type. Existing five-home saves are preserved and revalued to the new standard tiers; they are not charged retroactively for the change.

Passive stocks referring to systems that this repository does not implement (virus programming, company hacking, newspaper advertisement billing, racing skill, interest-bearing investment accounts, mission credits and detective flight delays) mature and show their entitlement, but those downstream effects are not implemented here. SYS, IIL, MSG, YAZ, TCM, TCI and LOS therefore need those underlying systems to provide the full Torn benefit. BAG's weapon-specific special ammunition quantities likewise require an ammunition system; its claim is unavailable and leaves the dividend entitlement intact. IOU's separate class-action chance is not implemented.

Company education bonuses are supported, but the full Torn merit/addiction system, type-specific production catalogs, all role restrictions, company trades with escrow, and years-long customer loyalty are not reproduced. Transfers currently gift a company to an eligible employee. Company popularity is relative to current weekly revenue, which resets with Sunday's ranking.

Medical facilities add the requested extra 1% of maximum health per five-minute tick with a doctor. The existing game's recovery model is retained; this does not introduce Torn's separate 5% baseline regeneration.

## Catalog and map cleanup

Map destination signs and Quick Links use the same routes. The 73 portable legacy items without Lock down item details are removed from active catalogs, shops, inventory displays, equipment and player trading. Historical saved rows remain inert. Returning trips skip retired cargo while delivering supported items. Property furnishings and travel souvenirs retain their separate catalogs.
