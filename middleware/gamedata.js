const MISSIONS = [
  { key: 'message_runner', name: 'Message Runner', desc: "Deliver a coded note across downtown. Don't get caught.", reward: { cash: 30, xp: 10 }, nerve: 1, cooldown: 3600, level: 1 },
  { key: 'kitchen_duty', name: 'Kitchen Duty', desc: 'Cover a restaurant shift. A meal is included.', reward: { cash: 20, xp: 5, hp: 15 }, nerve: 1, cooldown: 3600, level: 1 },
  { key: 'fix_the_pipe', name: 'Fix the Pipe', desc: 'Repair a busted pipe for contraband access.', reward: { cash: 50, xp: 20 }, nerve: 2, cooldown: 7200, level: 2 },
  { key: 'settle_score', name: 'Settle a Score', desc: 'Rough up a snitch on behalf of a boss.', reward: { cash: 40, xp: 25, rep: 10 }, nerve: 3, cooldown: 7200, level: 3 },
  { key: 'guard_stash', name: 'Guard the Stash', desc: 'Watch over a drug stash during a police raid.', reward: { cash: 80, xp: 30 }, nerve: 3, cooldown: 10800, level: 4 },
  { key: 'laundry_run', name: 'Laundry Run', desc: 'Move goods through the laundry. Fast and clean.', reward: { cash: 100, xp: 40, rep: 5 }, nerve: 4, cooldown: 14400, level: 5 },
  { key: 'bank_heist', name: 'City Bank Heist', desc: 'Hit a cash depot during a security shift change.', reward: { cash: 250, xp: 80, rep: 20 }, nerve: 6, cooldown: 86400, level: 8 },
];

const ITEMS = {
  first_aid_pouch: {"name": "First Aid Pouch", "price": 100, "effect": {"hp": 120}, "img": "/amenities/default.png", "desc": "+120 HP", "consumable": true},
  trauma_pack: {"name": "Trauma Pack", "price": 220, "effect": {"hp": 250}, "img": "/amenities/default.png", "desc": "+250 HP", "consumable": true},
  pulse_can: {"name": "Pulse Energy", "price": 90, "effect": {"energy": 60}, "img": "/amenities/energy_drinks.png", "desc": "+60 Energy", "consumable": true},
  espresso_shot: {"name": "Espresso Shot", "price": 30, "effect": {"energy": 20}, "img": "/amenities/energy_drinks.png", "desc": "+20 Energy", "consumable": true},
  courage_flask: {"name": "Courage Flask", "price": 120, "effect": {"nerve": 4}, "img": "/amenities/water_bottle.png", "desc": "+4 Nerve", "consumable": true},
  trail_mix: {"name": "Trail Mix", "price": 60, "effect": {"energy": 20, "hp": 25}, "img": "/amenities/default.png", "desc": "+20 Energy, +25 HP", "consumable": true},
  shiv:          { name: 'Shiv',           img: '/amenities/shiv.png',            desc: '+5 STR in combat',        price: 150,  effect: { strength: 5 },             slot: 'weapon' },
  knuckle_wraps: { name: 'Knuckle Wraps',  img: '/amenities/work_gloves.png',     desc: '+3 STR, +2 DEF',          price: 200,  effect: { strength: 3, defense: 2 }, slot: 'weapon' },
  steel_toes:    { name: 'Steel Toes',     img: '/amenities/default.png',         desc: '+4 SPD',                  price: 180,  effect: { speed: 4 },                slot: 'boots'  },
  shiv_handle:   { name: 'Handled Shiv',   img: '/amenities/shiv.png',            desc: '+8 STR, +2 SPD',          price: 400,  effect: { strength: 8, speed: 2 },   slot: 'weapon' },
  body_armor:    { name: 'Padded Jacket',  img: '/amenities/leather_vest.png',    desc: '+10 DEF',                 price: 350,  effect: { defense: 10 },             slot: 'armor'  },
  med_kit:       { name: 'Med Kit',        img: '/amenities/med_kit.png',         desc: 'Restores 100 HP',         price: 80,   effect: { hp: 100 },    consumable: true },
  water_bottle:  { name: 'Water Bottle',   img: '/amenities/default.png',         desc: 'Restores 20 HP',          price: 20,   effect: { hp: 20 },     consumable: true },
  blunt:         { name: 'Rolled Blunt',   img: '/amenities/blunt.png',           desc: '+30 Energy instantly',    price: 50,   effect: { energy: 30 }, consumable: true },
  steroids:      { name: 'Steroids',       img: '/amenities/steroids.png',        desc: '+2 STR permanently',      price: 500,  effect: { strength: 2 }, permanent: true },
  // New consumable items
  energy_drink:  { name: 'Energy Drink',   img: '/amenities/default.png',         desc: '+30 Energy instantly',    price: 40,   effect: { energy: 30 }, consumable: true, item_type: 'item' },
  redbull:       { name: 'Red Bull',       img: '/amenities/default.png',         desc: '+50 Energy instantly',    price: 60,   effect: { energy: 50 }, consumable: true, item_type: 'item' },
  large_water:   { name: 'Large Water',    img: '/amenities/default.png',         desc: 'Restores 30 HP',          price: 25,   effect: { hp: 30 },     consumable: true, item_type: 'item' },
  chocolate_bar: { name: 'Chocolate Bar',  img: '/amenities/default.png',         desc: '+15 Energy, +10 HP',      price: 35,   effect: { energy: 15, hp: 10 }, consumable: true, item_type: 'item' },
  adrenaline:    { name: 'Adrenaline',     img: '/amenities/default.png',         desc: 'Full HP restore',         price: 300,  effect: { hp: 9999 },   consumable: true, item_type: 'item' },
  nerve_tonic:   { name: 'Nerve Tonic',    img: '/amenities/default.png',         desc: 'Full Nerve restore',      price: 250,  effect: { nerve: 9999 },consumable: true, item_type: 'item' },
};



// ─── CELL AMENITIES ───────────────────────────────────────────────────────────
// img: path relative to /public/images/amenities/
const IMG = (k) => '/amenities/' + k + '.png';

const CELL_AMENITIES = {
  jump_street: {
    name: '21 Jump Street', img: IMG('jump_street'), category: 'energy', price: 350, size: 1,
    desc: 'Incompetent cops always cheer you up. +8 Energy',
    effect: { max_energy: 8 }
  },
  boo1: {
    name: 'Boo (Vol. 1)', img: IMG('boo'), category: 'nerve', rep_cost: 25, size: 1,
    desc: 'A horror comic. Nerves of steel. +5 Nerve',
    effect: { max_nerve: 5 }
  },
  boo2: {
    name: 'Boo (Vol. 2)', img: IMG('boo'), category: 'nerve', rep_cost: 40, size: 1,
    desc: 'The terrifying sequel. +8 Nerve, +3 Speed',
    effect: { max_nerve: 8, speed: 3 }
  },
  three_musketeers: {
    name: '3 Musketeers', img: IMG('three_musketeers'), category: 'combat', price: 280, size: 1,
    desc: '+3 STR, +3 DEF, +3 SPD',
    effect: { strength: 3, defense: 3, speed: 3 }
  },
  four_leaf_clover: {
    name: '4-Leaf Clover', img: IMG('four_leaf_clover'), category: 'stamina', price: 120, size: 1,
    desc: '+2 Stamina (up to 2 in property)',
    effect: { stamina: 2 }, max_count: 2
  },
  abe_lincoln: {
    name: 'Abraham Lincoln: Vampire Hunter', img: IMG('abe_lincoln'), category: 'hp', price: 500, size: 1,
    desc: '+16 HP, +6 Energy, +1 Nerve',
    effect: { max_hp: 16, max_energy: 6, max_nerve: 1 }
  },
  after_life: {
    name: 'After Life', img: IMG('after_life'), category: 'hp', price: 150, size: 1,
    desc: '-1 SPD, +1 HP',
    effect: { max_hp: 1, speed: -1 }
  },
  air_purifier: {
    name: 'Air Purifier', img: IMG('air_purifier'), category: 'hp', price: 600, size: 2,
    desc: '+15 HP, +5 Energy (up to 2 in property)',
    effect: { max_hp: 15, max_energy: 5 }, max_count: 2
  },
  alan_wake: {
    name: 'Alan Wake', img: IMG('alan_wake'), category: 'speed', price: 300, size: 1,
    desc: '+5 SPD, +5 Stamina',
    effect: { speed: 5, stamina: 5 }
  },
  american_flag: {
    name: 'American Flag', img: IMG('american_flag'), category: 'hp', price: 80, size: 1,
    desc: '+1 HP, +1 Nerve (up to 5 in property)',
    effect: { max_hp: 1, max_nerve: 1 }, max_count: 5
  },
  american_history_x: {
    name: 'American History X', img: IMG('american_history_x'), category: 'strength', price: 320, size: 1,
    desc: '+5 STR, +1 Nerve',
    effect: { strength: 5, max_nerve: 1 }
  },
  assassins_creed: {
    name: "Assassin's Creed", img: IMG('assassins_creed'), category: 'speed', price: 420, size: 1,
    desc: '+10 SPD, +1 Nerve',
    effect: { speed: 10, max_nerve: 1 }
  },
  avatar: {
    name: 'Avatar: The Last Airbender', img: IMG('avatar'), category: 'hp', price: 1200, size: 1,
    desc: '+2000 HP',
    effect: { max_hp: 2000 }
  },
  bad_teacher: {
    name: 'Bad Teacher', img: IMG('bad_teacher'), category: 'hp', price: 380, size: 1,
    desc: '+15 HP',
    effect: { max_hp: 15 }
  },
  bag_of_coal: {
    name: 'Bag of Coal', img: IMG('bag_of_coal'), category: 'energy', price: 50, size: 1,
    desc: '-10 STR, -20 SPD, -2 HP, +20 Energy, -10 Nerve, +5 Stamina (up to 5)',
    effect: { strength: -10, speed: -20, max_hp: -2, max_energy: 20, max_nerve: -10, stamina: 5 }, max_count: 5
  },
  barbell: {
    name: 'Barbell', img: IMG('barbell'), category: 'strength', price: 750, size: 1,
    desc: '+16 STR, +4 DEF, +2 Energy',
    effect: { strength: 16, defense: 4, max_energy: 2 }
  },
  batman_robin: {
    name: 'Batman and Robin', img: IMG('batman_robin'), category: 'nerve', price: 200, size: 1,
    desc: '-10 DEF, -5 SPD, +3 Nerve',
    effect: { defense: -10, speed: -5, max_nerve: 3 }
  },
  battleship: {
    name: 'Battleship', img: IMG('battleship'), category: 'defense', price: 300, size: 1,
    desc: '+10 DEF, -5 SPD',
    effect: { defense: 10, speed: -5 }
  },
  bed_mattress: {
    name: 'Bed with Mattress', img: IMG('bed_mattress'), category: 'energy', price: 400, size: 4,
    desc: '-5 DEF, +1 SPD, +5 Energy, +2 Stamina (up to 4)',
    effect: { defense: -5, speed: 1, max_energy: 5, stamina: 2 }, max_count: 4
  },
  bible: {
    name: 'Bible', img: IMG('bible'), category: 'hp', price: 200, size: 1,
    desc: '+10 HP',
    effect: { max_hp: 10 }
  },
  blood_amulet: {
    name: 'Blood Amulet', img: IMG('blood_amulet'), category: 'combat', price: 900, size: 1,
    desc: '+3 STR, +3 SPD, +3 DEF, +3 Energy, +3 Nerve, +3 Stamina',
    effect: { strength: 3, speed: 3, defense: 3, max_energy: 3, max_nerve: 3, stamina: 3 }
  },
  blowup_doll: {
    name: 'Blowup Doll', img: IMG('blowup_doll'), category: 'stamina', price: 150, size: 2,
    desc: '-3 Energy, +5 Stamina',
    effect: { max_energy: -3, stamina: 5 }
  },
  blue_candle: {
    name: 'Blue Candle', img: IMG('blue_candle'), category: 'stamina', price: 40, size: 1,
    desc: '+2 Stamina (up to 26)',
    effect: { stamina: 2 }, max_count: 26
  },
  bluray_player: {
    name: 'Blu-ray Player', img: IMG('bluray_player'), category: 'strength', price: 350, size: 1,
    desc: '+20 STR, -10 SPD (up to 10)',
    effect: { strength: 20, speed: -10 }, max_count: 10
  },
  brave: {
    name: 'Brave', img: IMG('three_musketeers'), category: 'combat', price: 280, size: 1,
    desc: '+3 STR, +3 SPD, +5 HP',
    effect: { strength: 3, speed: 3, max_hp: 5 }
  },
  bookcase: {
    name: 'Bookcase', img: IMG('bookcase'), category: 'nerve', price: 800, size: 9,
    desc: '+20 DEF, +5 SPD, +15 Nerve (up to 2)',
    effect: { defense: 20, speed: 5, max_nerve: 15 }, max_count: 2
  },
  borderlands2: {
    name: 'Borderlands 2 (PC)', img: IMG('borderlands2'), category: 'hp', price: 1500, size: 1,
    desc: '+50 HP, +5 Energy, +2 Nerve',
    effect: { max_hp: 50, max_energy: 5, max_nerve: 2 }
  },
  box_of_chocolates: {
    name: 'Box of Chocolates', img: IMG('box_of_chocolates'), category: 'hp', price: 250, size: 1,
    desc: '+150 HP, +2 Energy (up to 2)',
    effect: { max_hp: 150, max_energy: 2 }, max_count: 2
  },
  boxing_stars: {
    name: 'Boxing With The Stars', img: IMG('boxing_stars'), category: 'stamina', price: 80, size: 1,
    desc: '+1 Stamina (up to 10)',
    effect: { stamina: 1 }, max_count: 10
  },
  boxing_stars_hd: {
    name: 'Boxing With The Stars HD', img: IMG('boxing_stars_hd'), category: 'strength', price: 200, size: 1,
    desc: '+5 STR, +2 Stamina (up to 3)',
    effect: { strength: 5, stamina: 2 }, max_count: 3
  },
  bulldog: {
    name: 'Bulldog', img: IMG('bulldog'), category: 'defense', price: 600, size: 4,
    desc: '+5 DEF, 10% chance to scare off raider (up to 2)',
    effect: { defense: 5 }, max_count: 2
  },
  call_of_duty_ps4: {
    name: 'Call of Duty: Ghosts (PS4)', img: IMG('call_of_duty_ps4'), category: 'strength', price: 2000, size: 1,
    desc: '+50 STR, +20 SPD, -25 DEF, +2 Stamina',
    effect: { strength: 50, speed: 20, defense: -25, stamina: 2 }
  },
  call_of_duty_xbone: {
    name: 'Call of Duty: Ghosts (Xbox One)', img: IMG('call_of_duty_xbone'), category: 'strength', price: 2000, size: 1,
    desc: '+50 STR, +20 SPD, -25 DEF, +2 Stamina',
    effect: { strength: 50, speed: 20, defense: -25, stamina: 2 }
  },
  cars2: {
    name: 'Cars 2', img: IMG('cars2'), category: 'speed', price: 300, size: 1,
    desc: '+12 SPD, +10 Stamina',
    effect: { speed: 12, stamina: 10 }
  },
  catwoman: {
    name: 'Catwoman', img: IMG('catwoman'), category: 'speed', price: 180, size: 1,
    desc: '-5 DEF, +5 SPD, -2 Nerve',
    effect: { defense: -5, speed: 5, max_nerve: -2 }
  },
  cd_player: {
    name: 'CD Player', img: IMG('cd_player'), category: 'energy', price: 150, size: 1,
    desc: '-1 DEF, -5 SPD, +5 Energy (up to 2)',
    effect: { defense: -1, speed: -5, max_energy: 5 }, max_count: 2
  },
  chariots_of_fire: {
    name: 'Chariots of Fire', img: IMG('chariots_of_fire'), category: 'speed', price: 250, size: 1,
    desc: '+10 SPD',
    effect: { speed: 10 }
  },
  checkers: {
    name: 'Checkers', img: IMG('checkers'), category: 'stamina', price: 100, size: 1,
    desc: '+5 Stamina (up to 4)',
    effect: { stamina: 5 }, max_count: 4
  },
  cheech_chong: {
    name: "Cheech and Chong Hey Watch This", img: IMG('cheech_chong'), category: 'nerve', price: 220, size: 1,
    desc: '-10 Energy, +10 Nerve',
    effect: { max_energy: -10, max_nerve: 10 }
  },
  chess_set: {
    name: 'Chess Set', img: IMG('chess_set'), category: 'stamina', price: 280, size: 1,
    desc: '+10 Stamina (up to 3)',
    effect: { stamina: 10 }, max_count: 3
  },
  chef_hat: {
    name: 'Chef Hat', img: IMG('chef_hat'), category: 'nerve', price: 200, size: 1,
    desc: '+5 Nerve',
    effect: { max_nerve: 5 }
  },
  chihuahua: {
    name: 'Chihuahua', img: IMG('chihuahua'), category: 'defense', price: 250, size: 1,
    desc: '+3 DEF, 5% chance to scare raider (up to 2)',
    effect: { defense: 3 }, max_count: 2
  },
  christmas_tree: {
    name: 'Christmas Tree', img: IMG('christmas_tree'), category: 'defense', price: 500, size: 6,
    desc: '+10 DEF, +15 Energy',
    effect: { defense: 10, max_energy: 15 }
  },
  cock: {
    name: 'Cock (Rooster)', img: IMG('cock'), category: 'hp', price: 400, size: 1,
    desc: '+10 DEF, +15 HP, +5 STR',
    effect: { defense: 10, max_hp: 15, strength: 5 }
  },
  coffee_press: {
    name: 'Coffee Press', img: IMG('coffee_press'), category: 'energy', price: 200, size: 1,
    desc: '+10 Energy, -10 Stamina (up to 2)',
    effect: { max_energy: 10, stamina: -10 }, max_count: 2
  },
  computer_chair: {
    name: 'Computer Chair', img: IMG('computer_chair'), category: 'stamina', price: 450, size: 4,
    desc: '+25 Stamina (up to 2)',
    effect: { stamina: 25 }, max_count: 2
  },
  curved_4k_tv: {
    name: 'Curved 4K TV', img: IMG('curved_4k_tv'), category: 'strength', price: 900, size: 2,
    desc: '-5 Stamina, +3 STR, +10 Energy, +10 Nerve',
    effect: { stamina: -5, strength: 3, max_energy: 10, max_nerve: 10 }
  },
  dancing_chili: {
    name: 'Dancing Chili Pepper', img: IMG('dancing_chili'), category: 'hp', price: 180, size: 1,
    desc: '+5 HP, +2 Energy, +5 Nerve',
    effect: { max_hp: 5, max_energy: 2, max_nerve: 5 }
  },
  dead_rising2: {
    name: 'Dead Rising 2', img: IMG('dead_rising2'), category: 'speed', price: 450, size: 1,
    desc: '+5 SPD, +50 HP, +5 Stamina',
    effect: { speed: 5, max_hp: 50, stamina: 5 }
  },
  dead_rising3: {
    name: 'Dead Rising 3 (Xbox One)', img: IMG('dead_rising3'), category: 'nerve', price: 500, size: 1,
    desc: '+8 Nerve, +3 Stamina',
    effect: { max_nerve: 8, stamina: 3 }
  },
  death_funeral: {
    name: 'Death at a Funeral', img: IMG('death_funeral'), category: 'strength', price: 380, size: 1,
    desc: '+5 STR',
    effect: { strength: 5 }
  },
  diablo3: {
    name: 'Diablo III', img: IMG('diablo3'), category: 'hp', price: 700, size: 1,
    desc: '+10 HP, +10 Stamina',
    effect: { max_hp: 10, stamina: 10 }
  },
  dr_strange: {
    name: 'Dr. Strange', img: IMG('dr_strange'), category: 'nerve', price: 600, size: 1,
    desc: '+20 Nerve',
    effect: { max_nerve: 20 }
  },
  dredd: {
    name: 'Dredd 3D', img: IMG('dredd'), category: 'strength', price: 480, size: 1,
    desc: '+10 STR, +10 HP, -1 Nerve',
    effect: { strength: 10, max_hp: 10, max_nerve: -1 }
  },
  dumbbells: {
    name: 'Dumbbells', img: IMG('dumbbells'), category: 'strength', price: 350, size: 1,
    desc: '+8 STR, +2 DEF, +1 Energy (up to 5)',
    effect: { strength: 8, defense: 2, max_energy: 1 }, max_count: 5
  },
  dvd_player: {
    name: 'DVD Player', img: IMG('dvd_player'), category: 'combat', price: 200, size: 1,
    desc: '+5 DEF, +5 SPD',
    effect: { defense: 5, speed: 5 }
  },
  easter_basket: {
    name: 'Easter Basket', img: IMG('easter_basket'), category: 'stamina', price: 150, size: 2,
    desc: '+10 Stamina (up to 2)',
    effect: { stamina: 10 }, max_count: 2
  },
  evil_dead: {
    name: 'Evil Dead', img: IMG('evil_dead'), category: 'combat', price: 420, size: 1,
    desc: '+6 STR, +6 DEF, +6 Stamina',
    effect: { strength: 6, defense: 6, stamina: 6 }
  },
  exercise_bike: {
    name: 'Exercise Bike', img: IMG('exercise_bike'), category: 'stamina', price: 500, size: 4,
    desc: '+2 Energy, +6 Stamina (up to 3)',
    effect: { max_energy: 2, stamina: 6 }, max_count: 3
  },
  family_photo: {
    name: 'Family Photo', img: IMG('family_photo'), category: 'strength', price: 200, size: 1,
    desc: '+5 STR, +4 Nerve',
    effect: { strength: 5, max_nerve: 4 }
  },
  fast_five: {
    name: 'Fast Five', img: IMG('fast_five'), category: 'strength', price: 420, size: 1,
    desc: '+20 STR, +5 Stamina',
    effect: { strength: 20, stamina: 5 }
  },
  fifty_shades: {
    name: 'Fifty Shades Darker', img: IMG('fifty_shades'), category: 'energy', price: 280, size: 1,
    desc: '+5 Energy, +5 Stamina',
    effect: { max_energy: 5, stamina: 5 }
  },
  flat_screen_tv: {
    name: 'Flat Screen TV', img: IMG('flat_screen_tv'), category: 'energy', price: 600, size: 2,
    desc: '+3 Energy, +5 Nerve, -10 Stamina (up to 2)',
    effect: { max_energy: 3, max_nerve: 5, stamina: -10 }, max_count: 2
  },
  footloose: {
    name: 'Footloose', img: IMG('footloose'), category: 'nerve', price: 220, size: 1,
    desc: '+5 Nerve, +5 Stamina',
    effect: { max_nerve: 5, stamina: 5 }
  },
  friday_13th: {
    name: 'Friday the 13th', img: IMG('friday_13th'), category: 'strength', price: 320, size: 1,
    desc: '+5 STR, -10 SPD, +10 Stamina',
    effect: { strength: 5, speed: -10, stamina: 10 }
  },
  furry_vengeance: {
    name: 'Furry Vengeance', img: IMG('furry_vengeance'), category: 'speed', price: 200, size: 1,
    desc: '+5 SPD, +1 Nerve',
    effect: { speed: 5, max_nerve: 1 }
  },
  get_out: {
    name: 'Get Out', img: IMG('get_out'), category: 'defense', price: 1500, size: 1,
    desc: 'Always scares off property raiders!',
    effect: { defense: 10 }
  },
  ghost_rider: {
    name: 'Ghost Rider: Spirit of Vengeance', img: IMG('ghost_rider'), category: 'strength', price: 450, size: 1,
    desc: '+10 STR, +10 HP',
    effect: { strength: 10, max_hp: 10 }
  },
  green_lantern: {
    name: 'Green Lantern', img: IMG('green_lantern'), category: 'combat', price: 2500, size: 1,
    desc: '+10 STR, +10 DEF, +10 SPD, +10 HP, +10 Energy, +10 Nerve, +10 Stamina',
    effect: { strength: 10, defense: 10, speed: 10, max_hp: 10, max_energy: 10, max_nerve: 10, stamina: 10 }
  },
  green_unicorn: {
    name: 'Green Unicorn Plushie', img: IMG('green_unicorn'), category: 'defense', price: 120, size: 1,
    desc: '+25 DEF, +2 Stamina (up to 8)',
    effect: { defense: 25, stamina: 2 }, max_count: 8
  },
  grill: {
    name: 'Grill', img: IMG('grill'), category: 'combat', price: 800, size: 4,
    desc: '+10 STR, +10 DEF, +10 SPD, +5 HP, +5 Stamina',
    effect: { strength: 10, defense: 10, speed: 10, max_hp: 5, stamina: 5 }
  },
  grown_ups: {
    name: 'Grown Ups', img: IMG('grown_ups'), category: 'strength', price: 180, size: 1,
    desc: '+5 STR',
    effect: { strength: 5 }
  },
  groundhog: {
    name: 'Groundhog', img: IMG('groundhog'), category: 'hp', price: 220, size: 1,
    desc: '+10 HP, +5 Energy (up to 2)',
    effect: { max_hp: 10, max_energy: 5 }, max_count: 2
  },
  coffee_maker: {
    name: 'Coffee Maker', img: IMG('coffee_maker'), category: 'energy', price: 200, size: 1,
    desc: '+2 Max Energy',
    effect: { max_energy: 2 }
  },
  energy_drinks: {
    name: 'Energy Drinks', img: IMG('energy_drinks'), category: 'energy', price: 500, size: 2,
    desc: '+5 Max Energy',
    effect: { max_energy: 5 }
  },
  gym_bench: {
    name: 'Gym Bench', img: IMG('gym_bench'), category: 'energy', price: 800, size: 4,
    desc: '+3 Max Energy, +2 STR',
    effect: { max_energy: 3, strength: 2 }
  },
  meditation_mat: {
    name: 'Meditation Mat', img: IMG('meditation_mat'), category: 'nerve', price: 150, size: 1,
    desc: '+2 Max Nerve',
    effect: { max_nerve: 2 }
  },
  first_aid_kit: {
    name: 'First Aid Kit', img: IMG('first_aid_kit'), category: 'hp', price: 250, size: 1,
    desc: '+10 Max HP',
    effect: { max_hp: 10 }
  },
  bunk_upgrade: {
    name: 'Bunk Upgrade', img: IMG('bunk_upgrade'), category: 'hp', price: 600, size: 4,
    desc: '+25 Max HP',
    effect: { max_hp: 25 }
  },
  protein_stash: {
    name: 'Protein Stash', img: IMG('protein_stash'), category: 'hp', price: 700, size: 2,
    desc: '+20 Max HP, +1 STR',
    effect: { max_hp: 20, strength: 1 }
  },
  yoga_mat: {
    name: 'Yoga Mat', img: IMG('yoga_mat'), category: 'stamina', price: 180, size: 1,
    desc: '+10 Stamina',
    effect: { stamina: 10 }
  },
  punching_bag: {
    name: 'Punching Bag', img: IMG('punching_bag'), category: 'stamina', price: 450, size: 2,
    desc: '+15 Stamina, +2 STR',
    effect: { stamina: 15, strength: 2 }
  },
  weapon_rack: {
    name: 'Weapon Rack', img: IMG('weapon_rack'), category: 'strength', price: 400, size: 2,
    desc: '+5 STR',
    effect: { strength: 5 }
  },
  armor_stand: {
    name: 'Armor Stand', img: IMG('armor_stand'), category: 'defense', price: 400, size: 2,
    desc: '+5 DEF',
    effect: { defense: 5 }
  },
  speed_rope: {
    name: 'Speed Rope', img: IMG('speed_rope'), category: 'speed', price: 300, size: 1,
    desc: '+3 SPD',
    effect: { speed: 3 }
  },
  treadmill: {
    name: 'Treadmill', img: IMG('treadmill'), category: 'speed', price: 900, size: 4,
    desc: '+5 SPD, +2 Max Energy',
    effect: { speed: 5, max_energy: 2 }
  },
};

const TITLES = [
  [0,   'New Arrival'],
  [10,  'Scrapper'],
  [30,  'Enforcer'],
  [75,  'Shot Caller'],
  [150, 'Crime Boss'],
  [300, 'Kingpin'],
  [600, 'City Kingpin'],
];

function getTitle(rep) {
  let title = TITLES[0][1];
  for (const [req, t] of TITLES) { if (rep >= req) title = t; }
  return title;
}

async function levelUpCheck(user, run) {
  const events = [];
  while (user.xp >= user.xp_needed) {
    user.xp -= user.xp_needed;
    user.level++;
    user.xp_needed = Math.floor(user.xp_needed * 1.6);
    user.max_hp    += 25; user.hp     = user.max_hp;
    user.max_energy += 2; user.energy = user.max_energy;
    user.max_nerve  += 1; user.nerve  = user.max_nerve;
    user.strength   += 2; user.defense += 1; user.speed += 1; user.dexterity += 1;
    events.push('Level up! You are now Level ' + user.level + '.');
  }
  if (events.length) {
    await run(
      'UPDATE users SET xp=?,xp_needed=?,level=?,max_hp=?,hp=?,max_energy=?,energy=?,max_nerve=?,nerve=?,strength=?,defense=?,speed=?,dexterity=? WHERE id=?',
      [user.xp, user.xp_needed, user.level, user.max_hp, user.hp, user.max_energy,
       user.energy, user.max_nerve, user.nerve, user.strength, user.defense, user.speed, user.dexterity, user.id]
    );
  }
  return events;
}

// ─── WEAPONS ─────────────────────────────────────────────────────────────────
const WEAPONS = {
  baseball_bat: {"name": "Baseball Bat", "price": 300, "effect": {"strength": 15}, "img": "/amenities/baton.png", "desc": "+15 STR", "tier": 1},
  compact_pistol: {"name": "Compact Pistol", "price": 850, "effect": {"strength": 28, "speed": 5}, "img": "/amenities/default.png", "desc": "+28 STR, +5 SPD", "tier": 2},
  pump_shotgun: {"name": "Pump Shotgun", "price": 2400, "effect": {"strength": 60, "speed": -5}, "img": "/amenities/default.png", "desc": "+60 STR, -5 SPD", "tier": 3},
  shiv:           { name: 'Shiv',              img: '/amenities/shiv.png',       desc: '+5 STR',              price: 150,  effect: { strength: 5 },              tier: 1 },
  sock_rock:      { name: 'Sock and Rock',      img: '/amenities/default.png',    desc: '+8 STR',              price: 200,  effect: { strength: 8 },              tier: 1 },
  blade:          { name: 'Blade',              img: '/amenities/shiv.png',       desc: '+12 STR, +3 SPD',     price: 250,  effect: { strength: 12, speed: 3 },   tier: 1 },
  gun:            { name: 'Gun',                img: '/amenities/default.png',    desc: '+25 STR',             price: 400,  effect: { strength: 25 },             tier: 1 },
  knuckle_wraps:  { name: 'Knuckle Wraps',     img: '/amenities/work_gloves.png',  desc: '+10 STR, +3 SPD',     price: 280,  effect: { strength: 10, speed: 3 },   tier: 1 },
  baton:          { name: 'Baton',             img: '/amenities/baton.png',  desc: '+20 STR, +5 DEF',     price: 600,  effect: { strength: 20, defense: 5 }, tier: 2 },
  chain:          { name: 'Chain',             img: '/amenities/default.png',  desc: '+25 STR',             price: 700,  effect: { strength: 25 },             tier: 2 },
  switchblade:    { name: 'Switchblade',       img: '/amenities/shiv.png',  desc: '+30 STR, +10 SPD',   price: 900,  effect: { strength: 30, speed: 10 },  tier: 2 },
  machete:        { name: 'Machete',           img: '/amenities/machete.png',  desc: '+50 STR, +5 SPD',     price: 2000, effect: { strength: 50, speed: 5 },   tier: 3 },
  nunchucks:      { name: 'Nunchucks',         img: '/amenities/default.png', desc: '+45 STR, +20 SPD',price: 2200, effect: { strength: 45, speed: 20 },  tier: 3 },
  katana:         { name: 'Katana',            img: '/amenities/katana.png', desc: '+100 STR, +30 SPD',  price: 5000, effect: { strength: 100, speed: 30 }, tier: 4 },
  sledgehammer:   { name: 'Sledgehammer',      img: '/amenities/default.png', desc: '+150 STR, -20 SPD',  price: 5500, effect: { strength: 150, speed: -20 },tier: 4 },
  minigun:        { name: 'Minigun',           img: '/amenities/minigun.png',    desc: '+500 STR',            price: 20000,effect: { strength: 500 },            tier: 5 },
  plasma_cutter:  { name: 'Plasma Cutter',     img: '/amenities/default.png', desc: '+400 STR, +100 SPD', price: 18000,effect: { strength: 400, speed: 100 },tier: 5 },
};

// ─── ARMOR ────────────────────────────────────────────────────────────────────
const ARMOR = {
  motorcycle_jacket: {"name": "Motorcycle Jacket", "price": 300, "effect": {"defense": 18}, "img": "/amenities/default.png", "desc": "+18 DEF", "tier": 1},
  ballistic_vest: {"name": "Ballistic Vest", "price": 3300, "effect": {"defense": 85, "max_hp": 15}, "img": "/amenities/default.png", "desc": "+85 DEF, +15 Max HP", "tier": 3},
  bandana:        { name: 'Bandana',           img: '/amenities/bandana.png',    desc: '+5 DEF',              price: 100,  effect: { defense: 5 },               tier: 1 },
  torn_jacket:    { name: 'Lock down Jacket',       img: '/amenities/default.png',    desc: '+10 DEF',             price: 200,  effect: { defense: 10 },              tier: 1 },
  yellow_pages:   { name: 'Yellow Pages',      img: '/amenities/default.png',    desc: '+15 DEF (makeshift)', price: 80,   effect: { defense: 15 },              tier: 1 },
  food_tray:      { name: 'Food Tray',         img: '/amenities/default.png',    desc: '+8 DEF (improvised)', price: 50,   effect: { defense: 8 },               tier: 1 },
  bullet_proof_vest: { name: 'Bulletproof Vest', img: '/amenities/default.png', desc: '+50 DEF, +20 HP',     price: 1200, effect: { defense: 50, max_hp: 20 },  tier: 2 },
  padded_shirt:   { name: 'Padded Shirt',      img: '/amenities/default.png',    desc: '+15 DEF, -3 SPD',    price: 350,  effect: { defense: 15, speed: -3 },   tier: 1 },
  leather_vest:   { name: 'Leather Vest',      img: '/amenities/default.png',     desc: '+30 DEF',             price: 800,  effect: { defense: 30 },              tier: 2 },
  riot_helmet:    { name: 'Riot Helmet',       img: '/amenities/default.png',   desc: '+35 DEF, +10 HP',    price: 1000, effect: { defense: 35, max_hp: 10 },  tier: 2 },
  chainmail:      { name: 'Chainmail',         img: '/amenities/default.png',desc: '+60 DEF, -10 SPD',   price: 2500, effect: { defense: 60, speed: -10 },  tier: 3 },
  kevlar_vest:    { name: 'Kevlar Vest',       img: '/amenities/default.png',   desc: '+80 DEF, +20 HP',    price: 3000, effect: { defense: 80, max_hp: 20 },  tier: 3 },
  tactical_armor: { name: 'Tactical Armor',    img: '/amenities/tactical_armor.png', desc: '+150 DEF, +50 HP',   price: 7000, effect: { defense: 150, max_hp: 50 }, tier: 4 },
  exo_suit:       { name: 'Exo Suit',          img: '/amenities/default.png',      desc: '+500 DEF, +200 HP',  price: 25000,effect: { defense: 500, max_hp: 200 },tier: 5 },
};

// ─── GEAR ─────────────────────────────────────────────────────────────────────
const GEAR = {
  running_shoes: {"name": "Running Shoes", "price": 220, "effect": {"speed": 6}, "img": "/amenities/default.png", "desc": "+6 SPD", "tier": 1},
  tactical_gloves: {"name": "Tactical Gloves", "price": 700, "effect": {"strength": 12, "defense": 10}, "img": "/amenities/work_gloves.png", "desc": "+12 STR, +10 DEF", "tier": 2},
  work_gloves:    { name: 'Work Gloves',       img: '/amenities/default.png', desc: '+3 STR, +3 DEF',     price: 150,  effect: { strength: 3, defense: 3 },  tier: 1 },
  lucky_charm:    { name: 'Lucky Charm',       img: '/amenities/default.png',  desc: '+5 HP, +1 Nerve',    price: 120,  effect: { max_hp: 5, max_nerve: 1 },  tier: 1 },
  brass_knuckles: { name: 'Brass Knuckles',    img: '/amenities/brass_knuckles.png',  desc: '+15 STR, +5 SPD',   price: 500,  effect: { strength: 15, speed: 5 },   tier: 2 },
  gas_mask:       { name: 'Gas Mask',          img: '/amenities/default.png',desc: '+20 DEF, +10 HP',   price: 600,  effect: { defense: 20, max_hp: 10 },  tier: 2 },
  power_gloves:   { name: 'Power Gloves',      img: '/amenities/default.png',desc: '+40 STR, +20 DEF',  price: 2000, effect: { strength: 40, defense: 20 },tier: 3 },
  stealth_mask:   { name: 'Stealth Mask',      img: '/amenities/default.png',  desc: '+30 SPD, +15 DEF',  price: 1800, effect: { speed: 30, defense: 15 },   tier: 3 },
  gauntlets:      { name: 'Gauntlets',         img: '/amenities/default.png',  desc: '+80 STR, +40 DEF',  price: 6000, effect: { strength: 80, defense: 40 },tier: 4 },
  void_mask:      { name: 'Void Mask',         img: '/amenities/default.png',  desc: '+50 SPD, +3 Nerve', price: 5500, effect: { speed: 50, max_nerve: 3 },  tier: 4 },
  infinity_glove: { name: 'Infinity Glove',    img: '/amenities/default.png',desc: '+200 STR, +100 DEF',price: 30000,effect: { strength: 200, defense: 100},tier: 5 },
  shadow_cloak:   { name: 'Shadow Cloak',      img: '/amenities/default.png',  desc: '+150 SPD, +5 Nerve',price: 22000,effect: { speed: 150, max_nerve: 5 }, tier: 5 },
};

// ─── DRUGS ────────────────────────────────────────────────────────────────────
const DRUGS = {
  weed:         { name: 'Weed',          img: '/amenities/default.png',   desc: '+50 Energy instantly',    price: 80,   effect: { energy: 50 },  consumable: true, tier: 1 },
  moonshine:    { name: 'Moonshine',     img: '/amenities/default.png',   desc: '+3 Nerve instantly',      price: 100,  effect: { nerve: 3 },    consumable: true, tier: 1 },
  cocaine:      { name: 'Cocaine',       img: '/amenities/default.png',   desc: '+80 Energy instantly', price: 200,  effect: { energy: 80 }, consumable: true, tier: 1 },
  viagra:       { name: 'Viagra',        img: '/amenities/default.png',   desc: '+30 Stamina instantly',   price: 150,  effect: { stamina: 30 }, consumable: true, tier: 1 },
  steroids:     { name: 'Steroids',      img: '/amenities/default.png',   desc: '+5 STR permanently',      price: 500,  effect: { strength: 5 }, consumable: true, permanent: true, tier: 2 },
  speed_pills:  { name: 'Speed Pills',   img: '/amenities/default.png',   desc: '+5 SPD permanently',      price: 500,  effect: { speed: 5 },    consumable: true, permanent: true, tier: 2 },
  adrenaline:   { name: 'Adrenaline',    img: '/amenities/default.png',   desc: 'Full HP restore',         price: 300,  effect: { hp: 9999 },    consumable: true, tier: 3 },
  nerve_tonic:  { name: 'Nerve Tonic',   img: '/amenities/default.png',   desc: 'Full Nerve restore',      price: 250,  effect: { nerve: 9999 }, consumable: true, tier: 2 },
};

// ─── PRISONS ──────────────────────────────────────────────────────────────────
const PRISONS = [
  {
    id: 1, name: 'Lockdown City', short: 'Lockdown City',
    level_req: 1, max_cell: '8x12',
    desc: 'Your first city. Street hustles, starter jobs and room to grow.',
    hall_img: '/img/city-skyline.svg', yard_img: '/img/yard.png',
    item_tiers: [1], weapon_tiers: [1], armor_tiers: [1], gear_tiers: [1],
    // Amenities available in THIS prison's warden shop (cost rep, come protected)
    warden_amenities: ['curved_4k_tv','dvd_player','exercise_bike','jump_street','boo1','boo2','bag_of_coal','coffee_maker'],
    // Items/weapons/armor/drugs available in marketplace for this prison
    items_available:   ['energy_drink','redbull','large_water','chocolate_bar','med_kit','water_bottle'],
    weapons_available: ['shiv','sock_rock','knuckle_wraps','blade'],
    armor_available:   ['bandana','torn_jacket','yellow_pages','food_tray'],
    drugs_available:   ['weed','cocaine','viagra'],
  },
  {
    id: 2, name: 'London', short: 'London',
    level_req: 10, max_cell: '10x12',
    desc: 'A global trading hub with new contacts and better opportunities.',
    hall_img: '/img/city-skyline.svg', yard_img: '/img/yard.png',
    item_tiers: [1,2], weapon_tiers: [1,2], armor_tiers: [1,2], gear_tiers: [1,2],
    warden_amenities: ['gym_bench','flat_screen_tv','three_musketeers','evil_dead','punching_bag','assassins_creed'],
    items_available:   ['energy_drink','redbull','large_water','chocolate_bar','med_kit','water_bottle','blunt'],
    weapons_available: ['shiv','sock_rock','knuckle_wraps','blade','gun','baton'],
    armor_available:   ['bandana','torn_jacket','padded_shirt','bullet_proof_vest','yellow_pages','food_tray'],
    drugs_available:   ['weed','cocaine','viagra','moonshine'],
  },
  {
    id: 3, name: 'Tokyo', short: 'Tokyo',
    level_req: 25, max_cell: '12x14',
    desc: 'A fast-moving city of technology, underground markets and sharp competition.',
    hall_img: '/img/city-skyline.svg', yard_img: '/img/yard.png',
    item_tiers: [1,2,3], weapon_tiers: [1,2,3], armor_tiers: [1,2,3], gear_tiers: [1,2,3],
    warden_amenities: ['gym_bench','flat_screen_tv','curved_4k_tv','punching_bag','bookcase','energy_drinks'],
    items_available:   ['energy_drink','redbull','large_water','chocolate_bar','med_kit','water_bottle','blunt','adrenaline'],
    weapons_available: ['shiv','sock_rock','baton','chain','switchblade','blade','gun','machete'],
    armor_available:   ['bandana','padded_shirt','leather_vest','bullet_proof_vest','food_tray'],
    drugs_available:   ['weed','cocaine','viagra','moonshine','steroids','speed_pills'],
  },
  {
    id: 4, name: 'Dubai', short: 'Dubai',
    level_req: 50, max_cell: '12x16',
    desc: 'Big money, luxury property and high-stakes deals.',
    hall_img: '/img/city-skyline.svg', yard_img: '/img/yard.png',
    item_tiers: [1,2,3,4], weapon_tiers: [1,2,3,4], armor_tiers: [1,2,3,4], gear_tiers: [1,2,3,4],
    warden_amenities: ['curved_4k_tv','gym_bench','assassins_creed','evil_dead','flat_screen_tv','exercise_bike'],
    items_available:   ['energy_drink','redbull','large_water','med_kit','water_bottle','adrenaline','nerve_tonic'],
    weapons_available: ['baton','switchblade','machete','nunchucks','katana','gun','blade'],
    armor_available:   ['leather_vest','riot_helmet','chainmail','kevlar_vest','bullet_proof_vest'],
    drugs_available:   ['weed','cocaine','steroids','speed_pills','adrenaline','nerve_tonic'],
  },
  {
    id: 5, name: 'Cape Town', short: 'Cape Town',
    level_req: 100, max_cell: '14x16',
    desc: 'An international network for experienced operators and major scores.',
    hall_img: '/img/city-skyline.svg', yard_img: '/img/yard.png',
    item_tiers: [1,2,3,4,5], weapon_tiers: [1,2,3,4,5], armor_tiers: [1,2,3,4,5], gear_tiers: [1,2,3,4,5],
    warden_amenities: ['curved_4k_tv','gym_bench','flat_screen_tv','assassins_creed','three_musketeers','exercise_bike','punching_bag','bookcase'],
    items_available:   ['energy_drink','redbull','large_water','med_kit','water_bottle','adrenaline','nerve_tonic','blunt'],
    weapons_available: ['machete','katana','sledgehammer','minigun','plasma_cutter','gun'],
    armor_available:   ['chainmail','kevlar_vest','tactical_armor','exo_suit','bullet_proof_vest'],
    drugs_available:   ['weed','cocaine','steroids','speed_pills','adrenaline','nerve_tonic','viagra'],
  },
];


// Inject img paths into all CELL_AMENITIES
Object.entries(CELL_AMENITIES).forEach(([key, val]) => {
  if (!val.img) val.img = getAmenityImg(key);
});


function getAmenityImg(key) {
  const map = {
    'jump_street': '21_jump_street',
    'three_musketeers': '3_musketeers',
    'four_leaf_clover': '4_leaf_clover',
    'abe_lincoln': 'abraham_lincoln',
    'after_life': 'after_life',
    'air_purifier': 'air_purifier',
    'alan_wake': 'alan_wake',
    'american_flag': 'american_flag',
    'american_history_x': 'american_history_x',
    'assassins_creed': 'assassins_creed',
    'avatar': 'avatar',
    'bad_teacher': 'bad_teacher',
    'bag_of_coal': 'bag_of_coal',
    'barbell': 'barbell',
    'batman_robin': 'batman_robin',
    'battleship': 'battleship',
    'bed_mattress': 'bed_mattress',
    'bible': 'bible',
    'blood_amulet': 'blood_amulet',
    'blue_candle': 'blue_candle',
    'bookcase': 'bookcase',
    'borderlands2': 'borderlands_2',
    'brave': 'brave',
    'bulldog': 'bulldog',
    'call_of_duty_ps4': 'cod_ghosts_ps4',
    'call_of_duty_xbox': 'cod_ghosts_xbox',
    'cars_2': 'cars_2',
    'catwoman': 'catwoman',
    'chariots_of_fire': 'chariots_of_fire',
    'chess_set': 'chess_set',
    'chihuahua': 'chihuahua',
    'christmas_tree': 'christmas_tree',
    'cock': 'cock',
    'coffee_press': 'coffee_press',
    'computer_chair': 'computer_chair',
    'curved_4k_tv': 'curved_4k_tv',
    'dead_rising2': 'dead_rising_2',
    'dead_rising3': 'dead_rising_3',
    'death_funeral': 'death_funeral',
    'diablo3': 'diablo_iii',
    'dr_strange': 'dr_strange',
    'dredd_3d': 'dredd_3d',
    'dumbbells': 'dumbbells',
    'dvd_player': 'dvd_player',
    'energy_drinks': 'energy_drinks',
    'evil_dead': 'evil_dead',
    'exercise_bike': 'exercise_bike',
    'family_photo': 'family_photo',
    'fast_five': 'fast_five',
    'fifty_shades_darker': 'fifty_shades',
    'first_aid_kit': 'first_aid_kit',
    'flat_screen_tv': 'flat_screen_tv',
    'footloose': 'footloose',
    'friday_13th': 'friday_13th',
    'furry_vengeance': 'furry_vengeance',
    'get_out': 'get_out',
    'ghost_rider': 'ghost_rider',
    'green_lantern': 'green_lantern',
    'grill': 'grill',
    'grown_ups': 'grown_ups',
    'gym_bench': 'gym_bench',
    'meditation_mat': 'meditation_mat',
    'bunk_upgrade': 'bunk_upgrade',
    'protein_stash': 'protein_stash',
    'punching_bag': 'punching_bag',
    'weapon_rack': 'weapon_rack',
    'armor_stand': 'armor_stand',
    'speed_rope': 'speed_rope',
    'treadmill': 'treadmill',
    'yoga_mat': 'yoga_mat',
  };
  const file = map[key] || key;
  return '/amenities/' + file + '.png';
}

// ─── JOBS (per prison, keyed by prison_id) ────────────────────────────────────
const JOBS = {
  1: [ // Ohio State Penitentiary
    { key:'cleaner',    name:'Street Cleaner', req_def:30,  base_pay:50,  xp_per_day:5  },
    { key:'kitchen',    name:'Kitchen Worker',     req_def:60,  base_pay:90,  xp_per_day:8  },
    { key:'laundry',    name:'Laundry Crew',       req_def:100, base_pay:140, xp_per_day:12 },
    { key:'workshop',   name:'Workshop Mechanic',  req_def:150, base_pay:200, xp_per_day:18 },
  ],
  2: [ // Alcatraz Island
    { key:'dock_hand',  name:'Dock Hand',          req_def:80,  base_pay:120, xp_per_day:10 },
    { key:'medic',      name:'Paramedic',       req_def:150, base_pay:200, xp_per_day:15 },
    { key:'librarian',  name:'Librarian',          req_def:220, base_pay:290, xp_per_day:22 },
    { key:'guard_aide', name:'Security Assistant',         req_def:300, base_pay:400, xp_per_day:30 },
  ],
  3: [ // Devil's Island
    { key:'quarry',     name:'Quarry Worker',      req_def:200, base_pay:300, xp_per_day:25 },
    { key:'cook',       name:'Restaurant Cook',        req_def:300, base_pay:450, xp_per_day:35 },
    { key:'enforcer',   name:'Street Enforcer',     req_def:450, base_pay:640, xp_per_day:50 },
  ],
  4: [ // San Francisco Pen
    { key:'tech_room',  name:'Tech Room Operator', req_def:500, base_pay:800,  xp_per_day:65 },
    { key:'infirmary',  name:'Hospital Assistant',     req_def:700, base_pay:1100, xp_per_day:90 },
  ],
  5: [ // Pelican Bay
    { key:'solitary',   name:'Security Supervisor',   req_def:1000, base_pay:1800, xp_per_day:140 },
    { key:'contraband', name:'Contraband Runner',  req_def:1500, base_pay:2800, xp_per_day:200 },
  ],
};

// Casino city career special: one token refill per UTC day.
JOBS[1].push({key:'gaming_consultant',name:'Gaming Consultant',req_def:100,base_pay:140,xp_per_day:12});

// Keep imported IDs separate from legacy keys so existing saves retain their stats.
const importedCatalogs = require('./torn-catalog').buildCatalog();
for (const [type, catalog] of Object.entries({ item: ITEMS, weapon: WEAPONS, armor: ARMOR, gear: GEAR, drug: DRUGS })) {
  Object.assign(catalog, importedCatalogs[type]);
}

ITEMS.stock_ammunition_pack={name:'Ammunition Pack',desc:'A sealed special ammunition dividend from Big Al’s Gun Shop.',price:0,for_sale:false,consumable:false,effect:{},img:'/amenities/default.png'};

// Only the documented catalog is available as portable equipment/consumables.
// Retired legacy keys can remain in historical saves, but cannot be acquired,
// equipped, consumed or traded. Furnishings are managed separately.
for (const catalog of [ITEMS, WEAPONS, ARMOR, GEAR, DRUGS]) {
  for (const [key, item] of Object.entries(catalog)) {
    if (!Number.isInteger(item.source_id) || item.source_id <= 0) delete catalog[key];
  }
}

module.exports = { getAmenityImg, MISSIONS, ITEMS, CELL_AMENITIES, WEAPONS, ARMOR, GEAR, DRUGS, PRISONS, TITLES, getTitle, levelUpCheck, JOBS };
for(const jobs of Object.values(JOBS)) jobs.push({key:'brain_surgeon',name:'Brain Surgeon',req_def:100,base_pay:200,xp_per_day:15});
