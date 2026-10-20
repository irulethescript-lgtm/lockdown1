# Weapon stats and combat

The player-supplied tables from 20 October 2026 are recorded in `data/weapon-stats.json`. There are 151 primary, secondary and melee profiles. Taurus maps to the existing Taurus PT92, and Metal Nunchakus maps to Metal Nunchaku. All profiles resolve to existing catalog items; existing item storage keys and artwork are preserved.

## Owned weapons

- Each owned unit has a saved ID, damage and accuracy, rolled independently to two decimal places within its exact inclusive reference ranges. Narrow ranges, fixed values and fractional endpoints are preserved; rolls never exceed the supplied maxima.
- The market shows possible ranges; Equipment shows actual individual rolls. A shop purchase creates units immediately. Existing inventory, finds, travel cargo and rewards initialize their units when first viewed in Equipment, equipped, listed or used in a battle, within a serialized transaction.
- Selecting an exact weapon, installing an attachment, loading ammunition, selling and canceling preserve that unit's stats. Weapons in a listing are held in escrow, including their attachment and loaded magazine. A buyer receives those exact units. Legacy listings without units initialize once on delivery. The existing generic inventory sell action chooses the lowest unit IDs; the armory allows choosing an exact ID.
- Weapons still stored as `item` due to the old import (including Handbag) are supported without changing their saved storage types. Trout remains a consumable temporary even though its old storage type is `weapon`.
- Supplied weapons use their damage/accuracy instead of the earlier generic category-based strength/speed boosts. Armor and gear keep their existing bonuses. Unlisted catalog weapons retain their older compatibility behavior pending supplied stats.
- China Lake and SMAW have unknown ranges. Their metadata is displayed, but they cannot be equipped for the new combat system. No unprovided stat ranges or ranked-war rolls are invented.

## Fight plan

One active weapon, one unarmed fallback and one optional opening temporary are configured in Equipment. The same plan is used when defending. Fists: damage 10, accuracy 50. Kick: damage 30, accuracy 40.71; unlocked through the new Lockdown Kick Training course. This course's ID, price and duration are Lockdown configuration, because the reference did not specify them.

Attacks now use a saved turn-by-turn sequence, with a five-minute real-time deadline and up to25rounds. The attacker chooses an owned weapon, Fists/Kick, a temporary item or Reload each turn; the defender responds automatically using the configured fight plan. A selected temporary consumes one turn and is spent even on a miss. One temporary item is supported per participant per battle. See ATTACKING.md for the full click sequence. The standalone simulation helper retains six-second rounds for balancing tests.

Weapon damage multiplies strength-derived attack power by damage / 10. Weapon accuracy scales the speed-versus-dexterity hit chance, clamped to 10%–99.5%. Defense, stance, stamina, education and property bonuses still apply. This conversion is Lockdown balancing, not a reproduction of an unpublished Torn formula.

## Ammunition and attachments

Firearms use the supplied caliber, magazine size and rate of fire. Each attack consumes a random whole burst within its reference range, limited by the loaded ammunition. Burst size controls ammunition usage; it does not apply full hit damage for every projectile. Reloading during combat spends a turn. Attacking players must manually reload or select another action when a firearm is empty. The automatic defender falls back to Fists/Kick if its reserve is empty. A manual ammo switch returns unused rounds to the proper reserve. No rounds are granted free with weapons.

Only special ammo listed for a weapon can be purchased/loaded. The supplied table does not specify special-ammo modifiers or prices, so these are explicit Lockdown balancing values:

| Ammo | Per-round price | Effect |
| --- | ---: | --- |
| Standard | $10 | Normal damage |
| HP | $30 | +25% damage |
| TR | $30 | +15% accuracy |
| PI | $40 | Ignore 25% defense |
| IN | $50 | Burning after a successful hit |

Primary/secondary attachments use one slot per weapon. Replacements cost the full price and do not refund the removed attachment. Reflex sight: $25,000 / +2 accuracy. Stabilizing grip: $20,000 / +1 damage and accuracy. Suppressor: $30,000 / +1 stealth and −1 damage. Removing an attachment is free. These are Lockdown configuration, since no attachment catalog was supplied.

## Temporary items

- All 14 supplied damaging temporary items have their fixed damage, accuracy and stealth values.
- Bolas skip the opponent's next three turns. Concussion/Pepper reduce dexterity to 1/5; Flash reduces speed to 1/5 for 15–20 real seconds. Smoke reduces speed to 1/3 and Tear Gas reduces dexterity to 1/3 for 120–180 seconds. Applied debuffs multiply the affected stat; expiry is checked on each round.
- Epinephrine, Melatonin, Serotonin and Tyrosine require completed BIO3420. Their strength/speed/defense/dexterity boosts are +500%/+500%/+300%/+500% for 120 seconds. SPT2480 increases the bonus by 10%, yielding +550%/+330%. Serotonin restores 25% maximum life. Needles can be used from inventory or as an opening item. Their stat bonuses add, apply to effective stats without rewriting base stats, and disappear on expiry or hospitalization. Reusing a needle on the same stat adds its bonus and refreshes that stat's timer.
- Molotov and IN cause 10% of their initial hit as burning damage on each of the following turns within24seconds. This magnitude/duration is a Lockdown choice; the reference specifies burning but no formula.
- Party Popper and Glitter Bomb create a festive battle-report effect and no damage or stat bonus.
- Stygian Darkness is retained with its reference description but cannot be prepared in citizen battles, because there are no interdimensional boss targets. Nerve Gas and Semtex were not covered by the supplied table; no new effects were inferred.

## Boundaries

All battle resource consumption, ammunition state, remaining needle effects, damage, cooldowns and rewards commit or roll back together. Timed effects expire against real elapsed battle time and persist across page refreshes.

Stealth and acquisition sources are retained as reference metadata. Citizen battle reports continue to identify both participants; no stealth anonymity mechanic is claimed. The source labels do not replace existing shop availability with historical event or auction restrictions. There is no ranked-war/cache bonus generator, intrinsic/unique weapon-bonus catalog, attachment inventory market, or interdimensional boss system in this change.
