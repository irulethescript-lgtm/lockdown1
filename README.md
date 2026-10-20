# 🔒 Lock down — City RPG

A multiplayer browser city RPG.
Built with Node.js + Express + SQLite + Socket.IO.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
node server.js

# 3. Open your browser
http://localhost:3000
```

---

## Features

- **Register / Login** — Persistent accounts with hashed passwords
- **Homes** — Buy a property, move in, and furnish it without a tile grid
- **Gym progression** — Train STR / DEF / SPD with energy and stamina; unlock four gyms with better gains
- **Airport** — Ten countries, fixed local catalogs, limited stock and typed cargo
- **Crime mastery** — Prison-specific crimes with visible risk, cash, XP, and reputation rewards. Every 10 successes raises mastery (maximum level 10), adding 2% cash and reducing catch risk by 1 percentage point per level.
- **Daily objectives** — Attempt 3 crimes and complete 2 gym sessions, then claim $500 and 3 reputation once per UTC day.
- **City map** — Clickable locations, Map / Quick Links tabs, zoom and drag controls, and a 35% daily chance of a random collectible item. Results persist per player per UTC day; collection is atomic and requires being home and out of hospital/jail.
- **Home** — Original overview at /home (legacy /prison preserved).
- **Overview dashboard** — Daily progress, travel opportunities, specialties, and recent events
- **Battles** — Attack real players, steal cash, send them to hospital
- **Black Market** — Buy weapons and gear that boost stats
- **Bank** — Deposit/withdraw cash
- **Infirmary** — Pay to heal HP
- **Gang System** — Create or join gangs, invite members, gang bank
- **Live Shoutbox** — Real-time global chat via Socket.IO
- **Mail** — Send messages between players
- **Events** — Attack notifications, mail alerts, gang invites
- **Hitlist** — Place bounties on players
- **Most Wanted** — Leaderboard by reputation
- **Isolation Cell** — See who's in jail and their release timer
- **Profiles** — Public player profiles with fight history

---

## Deployment (Production)

### On a VPS (Ubuntu/Debian)

```bash
# Install Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone/upload your files, then:
cd /var/www/lockdown
npm install
node server.js
```

### With PM2 (recommended — keeps it running)

```bash
npm install -g pm2
pm2 start server.js --name lockdown
pm2 save
pm2 startup
```

### With Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Environment Variables

```bash
# Change the session secret in production!
SESSION_SECRET=your-super-secret-key node server.js

# Or use a .env file with dotenv
PORT=3000
SESSION_SECRET=change-me-in-production
```

---

## File Structure

```
lockdown/
├── server.js              # Entry point, Express + Socket.IO
├── package.json
├── db/                    # SQLite database files (auto-created)
├── middleware/
│   ├── db.js              # Database setup + helpers
│   ├── auth.js            # requireAuth middleware
│   └── gamedata.js        # Missions, items, game constants
├── routes/
│   ├── auth.js            # Login, register, logout
│   └── game.js            # All game routes
├── views/                 # EJS templates
│   ├── layout.ejs         # Master layout (header, sidebar, footer)
│   ├── login.ejs
│   ├── register.ejs
│   ├── prison.ejs         # Main hub
│   ├── cell.ejs
│   ├── gym.ejs
│   ├── yard.ejs
│   ├── battles.ejs
│   ├── missions.ejs
│   ├── marketplace.ejs
│   ├── bank.ejs
│   ├── infirmary.ejs
│   ├── shoutbox.ejs
│   ├── inmates.ejs
│   ├── profile.ejs
│   ├── account.ejs
│   ├── mail.ejs
│   ├── events.ejs
│   ├── most_wanted.ejs
│   ├── hitlist.ejs
│   ├── isolation.ejs
│   ├── gangs.ejs
│   ├── my_gang.ejs
│   ├── gang_create.ejs
│   └── gang_invites.ejs
└── public/
    ├── css/main.css        # All styles (PrisonBlock-inspired)
    └── js/main.js          # Client JS, socket, stat updater
```

---

## Game Mechanics

| Stat | Regenerates |
|------|------------|
| Energy | 1 per 5 minutes |
| Nerve | 1 per 3 minutes |
| HP | Heal at infirmary |

| Action | Cost |
|--------|------|
| Fight | 5 Energy |
| Train (gym) | Choose energy; 2% stamina per energy |
| Crime | Nerve and stamina shown on each crime |
| Travel visit | Round-trip cash fare shown per route |


## Progression and verification

Gym unlocks use lifetime energy spent after this update: Cell Block Gym (0, standard gains), Iron Yard (100, +20%), The Foundry (500, +40%), and Lockdown Elite (1,500, +60%). A session earns `floor(energy × 2 × gym multiplier)` stat points and 15 XP per energy. A newly unlocked gym applies to the following session. History stores base stats; the training cards include cell bonuses. Owned equipped weapons, armor and gear add temporary stat bonuses; they are never written into base stats.

Crime mastery, gym progress, and daily goals are stored in SQLite and created automatically for existing and new accounts. Previous actions are not backfilled. Mastery does not reset at midnight; daily goals reset at 00:00 UTC. Full resource pools cannot bank regeneration time. Stamina recovers by 1% every 5 minutes.

Run `npm test` with the declared dependencies installed for your operating system. The integration suite starts isolated local servers and temporary databases; it covers mastery, gym unlocks, costs, concurrent actions/claims, rollback, old database recovery, and restart persistence. It uses deterministic random outcomes only in its child test servers.

For a separate local database, set `DB_PATH=/absolute/path/to/preview.db` before starting the server. Its parent directory must exist. The default remains `db/lockdown.db`. Do not reuse binaries in `node_modules` from a different operating system: install dependencies on the target platform. The game calls its existing SQLite schema setup on startup; older gang installations may still need the documented `node migrate_gangs.js` upgrade.


## Strategy update

- **Crime decisions:** cautious (−8 risk points, ×0.75 cash, +3 heat), balanced (standard, +6 heat), bold (+12 risk points, ×1.5 cash, +12 heat). Every 5 heat adds 1 catch-risk point; heat cools by 1/minute offline and is capped at 100. Being caught adds 10 extra heat. Risk is clamped to 5–90%. Mastery, speed and education all apply before the final clamp.
- **Economy:** crime cash ranges are now one tenth of the original payouts, making equipment, property purchases and course fees longer-term goals. Extreme cell bonuses on Borderlands 2, Call of Duty, Dead Rising 2 and Death at a Funeral were reduced to keep training meaningful. Existing cash and earned base stats are preserved; passive cell bonuses use the current item balance.
- **Education:** six courses in crime, training and combat. Pay cash once, study one course at a time (15 minutes to 4 hours), then collect the permanent perk. Prerequisites must be completed and collected. Courses progress offline and persist through restarts/transfers. Gym gain is now `floor(energy × 2 × gym multiplier × (1 + education bonus / 100))`.
- **Combat:** balanced/aggressive/defensive stances; equipped gear and stamina affect combat. On victory, mug takes 8% of cash on hand with 60% of base XP and 1 rep; leave earns 150% XP and 3 + floor(target level / 3) rep; hospitalize earns standard XP, 2 rep, and a 10-minute recovery for the target. Mug/leave recovery is 90/60 seconds. A failed attack sends the attacker to recovery for 3 minutes. A 20-round draw has no winner or victory rewards. Survivors retain HP; knocked-out players recover at 20% HP. Attack costs 5 energy and 10 stamina, defender spends up to 5 stamina. The per-target cooldown is 10 minutes; profile mugging uses this same fight system and cooldown.
- **Recovery:** separate medical, drug and booster timers. Medical time accumulates; use is allowed below the 6-hour limit (up to 9 hours with faction upgrades). Imported kits/Morphine/blood bags restore percentage life and shorten standard hospital stays. Legacy medicine retains its listed HP effect and adds 5 minutes. Boosters are blocked in hospital/jail. Opium has a 120–180 minute drug timer; other existing drugs retain their listed Lockdown effects.

All new tables and attack-history columns are added automatically at startup. Keep your existing `db` folder when installing the update. Do not copy `node_modules` between operating systems; use Node.js 22+ and `npm ci` in your game folder, then `npm start`.


## Travel and overseas shops

The Airport offers United States, United Kingdom (London), Japan, United Arab Emirates, Brazil, Canada, Mexico, France, Germany and China. Flights take 3–12 minutes each way; the fare covers the return leg. Your home location and job stay unchanged. Permanent relocation is disabled, including the old POST endpoint; old relocation page links redirect to the Airport.

Each country has a deterministic selection of 12 existing catalog items: 3 flowers, 3 plushies, 2 drugs, 2 weapons, 1 booster and 1 cache. The selection and local price stay fixed across refreshes/restarts. Local prices range from 65% to 135% of the home reference price. Shared quantities refresh on UTC hour boundaries. Each rare booster/cache has a 22% chance to be stocked with 1–3 units, available only during the first 20 minutes of that hour. The table includes the home reference price and estimated player-market profit after the 10% fee; no sale is guaranteed.

Cargo uses one slot per item and is delivered exactly once into the correct inventory type after the prepaid return flight. Old saved souvenir cargo and collector sales remain supported. Bags start at six slots; upgrades retain their existing trip/cash requirements. Local actions are unavailable while away; regeneration and courses continue.

## Properties

My Property shows your active home, homes for sale, owned homes, furnishings and storage. Every account keeps a starter apartment. Buy a townhouse ($25,000), penthouse ($250,000), villa ($2.5m), or estate ($25m), then choose Move in. Switching homes keeps furnishings; a smaller home requires enough capacity. Buy furnishings for cash and use Add to home / Store controls. Existing placed furniture and its bonuses are retained; numeric storage slots are internal only. Homes have 96/120/180/240/400 furnishing spaces. No tile grid is displayed.

The additive `owned_homes` and `rotating_stock` tables are created at startup. Keep the existing database when updating. No player balances, jobs or home locations are reset.

## City life and progression

- Four trainable battle stats: strength (damage), defense (protection), speed
  (accuracy and initiative) and dexterity (evasion). Combat logs show misses.
- Happiness starts at 100. Each distinct valid furnishing placed at home adds
  10 to its cap, up to 200. Happiness above 100 adds up to 25% gym gains; each
  energy point trained uses 1 happiness. It recovers by 5 every 15 minutes
  offline, without banking unused full-pool recovery. A $50 home break restores
  up to 25 happiness, with a shared 30-minute cooldown.
- Successful crimes grant criminal experience equal to nerve spent. Every 100
  experience adds 1 to nerve capacity, capped at 25 extra. Failures grant none.
  Existing mastery, level and furnishing bonuses are preserved.


Existing databases receive additive migrations at startup. Saved money, items,
base stats, education and trips are retained. Old accounts start with 8 dexterity,
100 happiness and 0 new criminal experience. These are LOCKDOWN's documented
city rules, not a claim of exact Torn balance. Artwork remains as installed.


## Item market and inventory

- `/market` and `/shop` show the current hourly assortment with search, categories, price sorting and shared stock. Legacy basics stay; imported items rotate with a 65% hourly inclusion chance (30% for items worth at least $100m). Sold-out entries remain visible until rotation. All former shop tiers are available without relocation. $100 items have 400–1,000 units; prices above $100m have only 2–3. Intermediate price bands scale stock down. Refreshes do not refill stock early. Purchases debit cash and stock in one transaction.
- `/inventory` combines owned weapons, armor, gear, consumables, travel collectibles, and unplaced property items. Equip or unequip equipment, use supplies with shared recovery timers, or list a quantity for a total asking price on the player market.
- Lockdown supports one weapon, one armor item, and one gear item in its existing combat system.
- Category names in `data/torn-item-categories.json` come from the supplied [Torn Item index](https://wiki.torn.com/wiki/Item), revision 28542.
- `data/tornstats-items.json` contains all **1,509** entries published at [Torn Stats](https://www.tornstats.com/items), fetched October 19, 2026. It records names, IDs, descriptions (including source effects), types, buy/sell prices, market values and circulation. The snapshot SHA-256 is recorded. Re-import a saved page with `python scripts/import-tornstats.py snapshot.html`. The original 919 user-supplied names remain in `data/torn-items.json` for reference.
- Imported keys remain `torn_<id>`. `data/torn-legacy-types.json` preserves storage types of the original 919 entries, including 21 source category/type disagreements, so saved inventories, equipment and open player listings remain valid. Categories follow the imported snapshot; displayed names and descriptions replace Torn with Lock down. Original source data and save keys are kept for provenance and compatibility. New entries use the source equipment/consumable type.
- Shop prices use a positive source buy price first, otherwise positive published market value, otherwise positive sell price. Entries with no positive price use $250. Published values are a static snapshot, not live prices. Active imports join the rotating assortment; source Unused entries are never offered for sale or trade. Books cannot be listed on the player market.
- Equipment bonuses and usable-item effects follow Lockdown balance profiles. The item row states the implemented effect; expandable “Lock down item details” shows a rebranded reference description; actual playable effects are shown above it. Imports do not add racing, crafting, package opening, book buffs, drug side effects or throwable combat.
- All 1,509 entries have local PNG assets; 1,507 have source artwork. Razor (#1218) and Diesel (#1229) have broken source image URLs and use the existing default item image, labeled in the interface. Image provenance and SHA-256 hashes are recorded in `data/torn-item-images.json`: the pinned [Johanmans10/TornItems revision](https://github.com/Johanmans10/TornItems/tree/0aa398cfc88c9fc3cbc989c170236c4d6d6d300e) plus official Torn images for newer IDs. No runtime image requests to Torn are needed. Original game artwork and layout remain in place.

## Player guide

The top navigation's **How To** link opens `/how-to`, an authenticated rules and beginner guide. Nine expandable chapters cover the current Lockdown menus, costs, combat, education, trading and travel. This is a reference walkthrough; daily objectives and activities retain their existing rewards.


## Casino

Open `/casino`, `/awards` or `/points`. Casino Tokens are separate from voting Tokens.
Every player receives 75 Casino Tokens at the first visit after midnight UTC;
unused allowance does not stack. House rounds, lottery tickets, Bookie wagers and
Russian Roulette seats use one token. Poker uses none. Games unlock at levels
2 (Bookie), 3 (Lottery), 4 (Blackjack), 5 (Poker), 6 (Russian Roulette), 7 (Wheel),
8 (Slots, Craps, High-Low). Hospital, jail and travel block casino actions.

- Points start at zero. Buy them for $50,000 each; 30 points refill tokens once per
  UTC day. A Casino Pass (`torn_428`) also refills tokens. Gaming Consultants have
  one daily job refill. Full balances cannot waste points or passes.
- Blackjack uses one deck, dealer stands on all 17s, natural pays 3:2, insurance
  2:1, ordinary wins/doubles/5-card Charlie 1:1; no split. Bets $10–$1,000,000.
- Poker is two-player five-card draw with one redraw, not Texas Hold'em. Poker
  and Russian Roulette escrow both stakes, pay 95% of the pot, and refund ties.
  Russian Roulette is a fictional cash wager without character injury.
- Waiting tables expire after 24h. Poker hands expire after 10m: one player drew,
  that player wins; neither drew, both refunded. Stakes $100–$1,000,000.
- Lottery tickets cost $1,000, up to ten/day; one ticket wins 90% of the pot after
  UTC rollover, settled on the next casino visit. Wheel costs $1,000 once/day.
- Slots triple multipliers: 100/40/20/10/10/10/10/10; pairs return half the wager.
  Craps resolves a complete pass-line bet. High-Low ties lose; each correct guess
  adds 10% to the bank (rounded down), auto cashout at 25 wins or $100m.
- Twelve persistent awards track betting, blackjack outcomes, lottery wins,
  poker profit, roulette wins, wheel spins, slots jackpot and High-Low streaks.

### Verified sports events (operator)

No live sports feed is configured. Bookie remains empty until an operator imports
trusted fixtures and verified results. There is no player result-setting endpoint.
Run against your game database:

```bash
DB_PATH=db/lockdown.db node scripts/casino-sports.js /path/to/events.json
```

The JSON file is an array. `starts_at` is Unix seconds; odds are thousandths
(1800 means decimal odds 1.8). Omit `winner` for fixtures; import again after the
start with a winning option ID or `"void"` to refund. Settlement is replay safe.

```json
[{"id":"fixture-1","title":"Home vs Away","starts_at":1900000000,"options":[{"id":"home","label":"Home","odds":1800},{"id":"away","label":"Away","odds":2200}]}]
```

## Medical recovery

Hospital and inventory show separate countdowns in the page and header. Server
checks, inventory spending, healing and timers commit in one transaction.

| Item | Hospital reduction | Life healed | Medical time added |
| --- | --- | --- | --- |
| Small First Aid Kit | 20m | 5% | 10m |
| First Aid Kit | 40m | 10% | 15m |
| Morphine | 70m | 15% | 20m |
| Compatible blood bag | 120m | 30% | 30m |

Medical time drains offline and stacks from its existing expiry. A use is allowed
only while remaining time is below 6h; the last use may take it over that limit.
Medical Effectiveness education adds 20% to healing and hospital reduction.
Faction leaders can buy up to +30% effectiveness and +3h capacity in Hospital,
using the faction bank ($250,000 × next upgrade level).

Every player receives a persistent blood type. Intravenous Therapy unlocks blood
bags; filling one requires more than 30% life and consumes 30% maximum life,
an empty bag and 60m medical time. It produces a bag of your type. Withdrawal is
blocked in hospital/jail. Incompatible blood is rejected and preserved in this
version rather than inflicting transfusion injury.

Opium clears standard hospital time, restores life up to 50% (with medical
bonuses), and grants temporary +30% defense during its 120–180m drug timer.
It does not overdose or add medical time. Its defense bonus never changes saved
base defense. Radiation blocks drugs and ordinary hospital time reduction;
Neumune removes 3h radiation hospital time (with effectiveness) and 12h radiation,
adding 3h medical time. Radiation state is supported, but there is currently no
dirty-bomb or irradiated-bag gameplay that creates it.

Complete Applied Anatomy → Intravenous Therapy → Brain Surgery, then take the
Brain Surgeon job (100 DEF) to permanently unlock reviving. Initial skill is 1;
success chance is 50% + half skill, recovery is skill% maximum life, and each
successful revive adds 1 skill up to 100. Each attempt costs 75 energy, reduced
by 5 per faction Reviver upgrade to 25. Patients can turn consent off; revivers
must be free and at home in the same city. Failed attempts spend energy. Radiation
requires Neumune. These are Lockdown progression rules; Love Juice events, outside
hits/early discharge, full drug/addiction simulation and the supplied combat
revamp are not implemented by this recovery update. Existing paid hospital
priority care and out-of-hospital healing remain available.
