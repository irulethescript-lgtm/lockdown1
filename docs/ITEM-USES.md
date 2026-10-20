# Item uses update

Item purposes come from the pinned 1,509-record Torn Stats snapshot in `data/tornstats-items.json`. Explicit `Effect:` text now appears on item cards instead of the old generic category effect or “no direct use” sentence. Availability is shown separately. Original descriptions, names, IDs, prices, images and saved inventory identities remain available.

## Playable uses

`middleware/item-uses.js` defines 124 activations, including 31 supported book effects and the book that repeats a previous effect. Existing weapons, needles and medical treatment continue through their respective services.

- Candy gives the stated happiness; alcohol gives the stated nerve; energy drinks give the stated energy. Booster cooldowns use the stated durations, stack while below 24 hours, and preserve items on rejected/full-resource actions. Energy and nerve can exceed normal maxima up to 1,000; happiness is capped at 99,999.
- Parachute, Skateboard, Boxing Gloves and Dumbbells permanently increase the appropriate saved base stat by 1%. Gold eggs increase all battle stats by 1%; Brown eggs increase working stats by 1%. They do not turn temporary multipliers into permanent stats.
- Erotic DVDs, hotel coupons, jail lawyers, the specified resource eggs, White eggs, Book of Carols and tissues implement their stated effects. Unsupported eggs with unspecified rewards remain unavailable.
- Supported drugs apply their explicit resource/stat effects. The prior one-hour Lockdown drug cooldown remains for these drugs; exact Torn overdose rates, addiction increments and unspecified negative side effects have not been reproduced. Opium retains its separate existing treatment rules. Temporary drug boosts expire without rewriting base stats.
- Grenade/medical/drug packs provide the stated possible contents and quantities. Six-packs and treat tins give six of one eligible item; goodie bags give 30 candy/alcohol/drink items. Choices are uniform Lockdown draws; Torn's unpublished loot probabilities/premium reward pools are not claimed. Unknown cache contents and ranked-war bonuses are not invented.
- Donator packs credit 60 points and 31 days of displayed donator status. No additional premium perks are implied. Casino passes add exactly 50 tokens, subject to the existing 75-token wallet limit, from both inventory and casino actions. Lottery vouchers add 100 tickets to Lockdown's existing daily draw; Torn's weekly draw has not replaced it.
- Books permit one current book, persist the 31-day interval, enforce once-per-book reading unless Ladso Eye is owned, and award capped permanent gains once. Implemented effects cover battle stats, gym gains, crime and active-action experience, battle hospitalization, crime jail time, travel, selected regeneration, consumable/medical cooldowns, candy/drink multipliers and maximum energy. Books requiring absent systems have no activation button. Background job XP is not affected by the leveling XP book.
- Sports Sneakers improve speed gym gains by 5%. The largest owned suitcase adds 1/2/3 slots without stacking. Razor and Magnifying Glass add 5% criminal experience to the existing Pickpocket and Forge Documents actions; other crime tools remain contextual.
- Business-class tickets activate for the next return trip, reduce flight time by 70%, and provide 15 base cargo slots before suitcase/book bonuses. The return preserves the departure duration.
- Piggy banks accept cash and return it when broken, consuming the bank. Funded banks cannot be listed or dropped. Cosmetic clothing/jewelry can be worn/removed without stat bonuses or consumption. Mirrors report the selected outfit.
- Fruitcake, Cake Frosting and Lock Picking Kit combine into Special Fruitcake. The resulting cake removes the holder's jail time; a new targeted sending system is not included.
- Selected pranks and Strippogram Vouchers accept a player ID and apply their stated happiness change. Lockdown treats valid home targets as successful; Torn's unpublished prank success odds are not claimed.

Happiness above the property maximum and Blue Egg life overflow are retained until the next quarter-hour boundary. That life-overflow reset is a Lockdown timing choice. Book regeneration is accounted only for ticks inside the reading interval, retaining fractional energy bonuses.

All item consumption, rewards, timers, cash and progress updates use the existing serialized database transaction. Failed reward writes roll back consumption.

## Contextual items and remaining systems

Adhesive Plastic (#1321) is a forgery ingredient; it is no longer described as useless. Exact Torn forgery projects/recipes and production have **not** been implemented. Admin Portrait '09 (#471) is a genuine collectible with no activation effect; collecting/trading is its purpose.

Racing, museum exchanges, full Crimes 2.0/organized-crime item requirements, parcels, virus programming, seasonal events, unavailable book effects, special boss artifacts and unknown loot pools remain incomplete. Cards distinguish their reference purpose from current availability rather than granting invented stat bonuses. Owning an item marked as requiring an unavailable feature does not silently activate that feature.

Direct Torn and Torn Wiki access returned HTTP 403 during this update. The accessible Torn Stats catalog and existing pinned snapshot supplied the item descriptions. This release does not claim complete Torn parity or live verification of every Torn use.
