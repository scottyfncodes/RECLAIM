// RECLAIM: every tunable number and every word lives here.

// Palette tokens (direction.json art.palette). CSS mirrors these in styles.css :root.
export const PAL = {
  background: '#17191b', surface: '#26292c', primary: '#8fd05a', accent: '#f2c230', text: '#eeece3',
  // the human layer
  asphalt: '#34373b', asphaltLot: '#3b3e42', concrete: '#8b8d88', plaza: '#a09f98', seam: '#6e706b',
  paintWhite: '#c9c8c0', paintYellow: '#c9a534', crack: '#1b1c1e',
  roof: '#74787c', roofDark: '#5c6064', wall: '#4a4e53', window: '#2c3138',
  // the living layer
  soilDry: '#7a6650', soilRich: '#3a2a1f', moss: '#667a3a', mossShade: '#4b653c',
  grass: '#5f9a41', grassLight: '#86bd55', grassShade: '#447c46', fern: '#3f8d55',
  stem: '#4d7d33', stemLight: '#84c452', wood: '#6a5238', leaf: '#8fd05a', leafDark: '#6fae44',
  water: '#2f7890', waterLight: '#63b4c4', tree: '#3f7d3a', treeMid: '#5c9c45', treeLight: '#88c458',
  flowers: ['#e8528c', '#f2c230', '#f4efe2', '#9d7be0', '#ef7f3a'],
};

// Game feel (direction.json play.feel). Tuned by playing; change here only.
export const FEEL = {
  tip_grab_radius_px: 44,
  node_grab_radius_px: 26,
  grow_speed_tiles_per_s: 5.5,
  grow_cost_sun_per_tile: 2.5,
  segment_length_px: 14,
  hold_to_crack_delay_ms: 250,
  pan_threshold_px: 10,
  crack_sidewalk_ms: 1500,
  crack_asphalt_ms: 3200,
  crack_cost_water_sidewalk: 2.4,
  crack_cost_water_asphalt: 4.8,
  constrict_ms: 4500,
  constrict_cost_water: 8,
  hydrant_burst_ms: 1800,
  root_reach_tiles: 1.6,
  irrigate_tiles: 1.7,
  irrigate_tiles_seeking: 2.7,
  break_shake_px: 3,
  break_shake_ms: 140,
  haptic_grab_ms: 6,
  haptic_break_ms: 12,
  moss_appears_s: 2.5,
  succession_step_s: 18,
  zoom_max: 2.2,
  start_sun: 14,
  start_water: 0,
};

export const T = { ASPHALT: 0, LOT: 1, WALK: 2, PLAZA: 3, SOIL: 4, BUILDING: 5, WATER: 6, BASIN: 7 };
export const PAVED = t => t === T.ASPHALT || t === T.LOT || t === T.WALK || t === T.PLAZA || t === T.BASIN;
export const TOUGH = t => t === T.ASPHALT || t === T.LOT;

// Alive index: what "restored" means. Destruction alone scores nothing.
export const ALIVE = {
  cover_target: 0.62,       // share of all land that must be living ground, water or a garden building
  species_target: 8,
  win_raw: 0.93,
  w_cover: 0.5, w_species: 0.2, w_link: 0.2, w_soil: 0.1,
  stage_at: [0, 8, 30, 60, 100],   // displayed Alive % where each succession stage begins
};

export const STAGES = [
  { n: 'I', name: 'PERSISTENCE', line: 'One vine. One crack. Find water.' },
  { n: 'II', name: 'COLONIZATION', line: 'Moss and grass take the first ground.' },
  { n: 'III', name: 'EXPANSION', line: 'Flowers. Then the things that want flowers.' },
  { n: 'IV', name: 'ECOSYSTEM', line: 'It has started doing this without you.' },
  { n: 'V', name: 'RECLAMATION', line: 'Fourth & Main is no longer an address.' },
];

export const EVOLUTIONS = {
  pressure: { name: 'Root Pressure', tag: 'BREAK', line: 'Slabs split in half the time, and every break fractures the slabs beside it.', flavor: 'Concrete is patient. You are more patient.' },
  seeking: { name: 'Water Seeking', tag: 'FIND', line: 'Sense the water main buried under the road. Your vine waters ground much farther from itself.', flavor: 'They put a river in a pipe. You can hear it.' },
  climbing: { name: 'Climbing Tendrils', tag: 'KEEP', line: 'Grow up walls and over roofs. A covered building becomes a vertical garden that feeds you sun.', flavor: 'Excellent bones. Shame about the tenants.' },
  constrict: { name: 'Constriction', tag: 'FELL', line: 'Hold on a building beside your vine to bring it down. The shade goes with it. The rubble takes time.', flavor: 'Load-bearing is a temporary condition.' },
};
export const EVO_OFFERS = [['pressure', 'seeking'], ['climbing', 'constrict']];

export const SPECIES = {
  moss: { name: 'Moss', line: 'First in. Asks for nothing but damp.' },
  grass: { name: 'Grass', line: 'Holds the soil together so everything else can argue over it.' },
  wildflower: { name: 'Wildflowers', line: 'Advertising, for bees.' },
  fern: { name: 'Ferns', line: 'Perfectly happy in the shade your buildings left.' },
  mushroom: { name: 'Fungi', line: 'Rot, done professionally.' },
  shrub: { name: 'Shrubs', line: 'Shelter. Something will move in.' },
  tree: { name: 'Trees', line: 'Give it forty years. Or four minutes.' },
  pollinator: { name: 'Pollinators', line: 'Came for the flowers. Staying for the lack of windshields.' },
  bird: { name: 'Birds', line: 'The first song on this corner in a long time.' },
  dragonfly: { name: 'Dragonflies', line: 'Standing water, standing ovation.' },
  ivy: { name: 'Ivy', line: 'The building is finally load-bearing for something useful.' },
};

export const INSPECT = {
  hydrant: ['FIRE HYDRANT', 'Still under pressure. Nobody left to report the leak.'],
  hydrant_burst: ['BROKEN HYDRANT', 'Technically a spring now.'],
  drain: ['STORM DRAIN', 'Leads somewhere wetter.'],
  lamp: ['STREET LAMP', 'Has lit nothing for years. The moths moved on.'],
  meter: ['PARKING METER', 'Expired. So did everyone who fed it.'],
  car: ['SEDAN', '48 payments remaining.'],
  bench: ['BENCH', 'Reserved.'],
  sign: ['BUS STOP', 'Next service: no.'],
  stump: ['STREET TREE', 'Planted in a one-metre square and told to be grateful.'],
  cart: ['SHOPPING CART', 'Migrated here on its own. Nobody knows how.'],
  shop: ['CORNER SHOP', 'Back in 5 minutes.'],
  flats: ['APARTMENTS', '24 units. Excellent natural light, soon.'],
  garden: ['VERTICAL GARDEN', 'Still a building. Now with residents.'],
  rubble: ['RUBBLE', 'Not soil yet. Fungi are working on it.'],
  asphalt: ['ASPHALT', 'Sealed. Nothing gets in. Hold beside your vine to crack it.'],
  walk: ['SIDEWALK', 'Thin concrete over old earth. Hold beside your vine to crack it.'],
  plaza: ['PAVING', 'Somebody chose this over grass, on purpose. Hold beside your vine to crack it.'],
  basin: ['FOUNTAIN', 'Dry. Waiting for rain like everything else.'],
  water: ['OPEN WATER', 'Everything within a few paces drinks from it.'],
  main: ['WATER MAIN', 'A river in a pipe, right under the road. Break the road above it.'],
  vine: ['YOU', 'One organism. Every tendril carries water to the ground beside it.'],
};

export const PROMPTS = {
  drag: 'Drag the glowing tip',
  water: 'Grow to the leaking hydrant',
  crack: 'Press and hold a slab beside your vine',
  spread: 'Open more ground. Life follows water.',
  corners: 'Cross the road. Link all four corners.',
  build: 'Open more ground. Plants make soil, soil makes trees.',
  watch: 'It grows without you now. Help it, or watch.',
};
