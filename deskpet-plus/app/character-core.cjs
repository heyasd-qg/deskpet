const { scanBuiltins } = require('./character-availability.cjs');
const characterResources = require('./character-resources.cjs');
let builtinState = scanBuiltins(characterResources.activeRoot()), customCharacters = [];
const catalogue = builtinState.characters.slice();
function setCustomCharacters(items) { customCharacters = items; catalogue.splice(0, catalogue.length, ...builtinState.characters, ...items); }
function reloadBuiltinCharacters() { builtinState = scanBuiltins(characterResources.activeRoot()); setCustomCharacters(customCharacters); return builtinState; }
function getBuiltinState() { return builtinState; }
const DEFAULTS = { character: 'sakiko', outfit: 'school_winter_hs_1st', eyesOpen: true, followMouse: true, showLines: true,
  voiceEnabled: true, language: 'zh', sizePercent: 100, maskOn: false, performanceMask: true,
  greetingsEnabled: true, hourlyChime: false, quietStart: '23:00', quietEnd: '07:00', dualEnabled: false, displayLocked: false, voiceVolume: 45 };
const LEGACY = { school_winter_hs: 'school_winter_hs_1st', school_summer_hs: 'school_summer_hs_1st',
  school_winter_jhs: 'school_winter_jhs', casual_spring: 'casual_spring_01', live: 'live_01', live_mask: 'live_01' };
const character = key => catalogue.find(c => c.key === key) || catalogue.find(c => c.key === DEFAULTS.character) || catalogue[0];
function preferences(input) {
  const prefs = {};
  for (const [key, saved] of Object.entries(input.characterPreferences || {})) {
    const item = catalogue.find(c => c.key === key);
    if (saved && typeof saved.outfit === 'string' && (!item || item.outfits.some(o => o.key === saved.outfit))) {
      prefs[key] = { outfit: saved.outfit, maskOn: !!saved.maskOn, performanceMask: !!saved.performanceMask };
    }
  }
  return prefs;
}
function normalize(input = {}) {
  const settings = { ...DEFAULTS, ...input };
  const c = character(settings.character);
  if (c) settings.character = c.key;
  if (!input.character && Object.hasOwn(LEGACY, input.outfit)) {
    settings.outfit = LEGACY[input.outfit];
    if (input.outfit === 'live_mask') settings.maskOn = true;
  }
  if (c && !c.outfits.some(o => o.key === settings.outfit)) settings.outfit = c.defaultOutfit;
  settings.sizePercent = Math.max(60, Math.min(180, Math.round(Number(settings.sizePercent) || 100)));
  settings.voiceVolume = Math.max(0, Math.min(100, Math.round(Number.isFinite(Number(settings.voiceVolume)) ? Number(settings.voiceVolume) : 45)));
  settings.displayLocked = Boolean(settings.displayLocked);
  settings.language = settings.language === 'ja' ? 'ja' : 'zh';
  for (const key of ['eyesOpen', 'followMouse', 'showLines', 'voiceEnabled', 'greetingsEnabled', 'hourlyChime']) settings[key] = Boolean(settings[key]);
  settings.maskOn = Boolean(settings.maskOn && (!c || c.outfits.find(o => o.key === settings.outfit)?.maskAvailable));
  settings.performanceMask = Boolean(settings.performanceMask && (!c || c.performance?.maskAvailable));
  for (const key of ['quietStart', 'quietEnd']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings[key])) settings[key] = DEFAULTS[key];
  settings.characterPreferences = preferences(input);
  settings.dualEnabled = Boolean(input.dualEnabled);
  settings.dualLeft = normalizeSlot(input.dualLeft || settings);
  settings.dualRight = normalizeSlot(input.dualRight || { character: settings.dualLeft.character === 'uika' ? 'sakiko' : 'uika' });
  return settings;
}
function normalizeSlot(input = {}) {
  const c = character(input.character), savedPreferences = preferences(input);
  if (!c) return { character: input.character || DEFAULTS.character, outfit: input.outfit || DEFAULTS.outfit,
    maskOn: !!input.maskOn, performanceMask: !!(input.performanceMask ?? true), characterPreferences: savedPreferences };
  const outfit = c.outfits.find(o => o.key === input.outfit) || c.outfits.find(o => o.key === c.defaultOutfit);
  return { character: c.key, outfit: outfit.key, maskOn: !!(input.maskOn && outfit.maskAvailable),
    performanceMask: !!(c.performance?.maskAvailable && (input.performanceMask ?? true)), characterPreferences: savedPreferences };
}
function updateSlot(previous, key, value) {
  const profile = normalizeSlot(previous);
  if (key === 'character') {
    if (!catalogue.some(c => c.key === value)) return profile;
    profile.characterPreferences[profile.character] = { outfit: profile.outfit, maskOn: profile.maskOn, performanceMask: profile.performanceMask };
    const next = character(value), saved = profile.characterPreferences[value];
    return normalizeSlot({ ...profile, character: value, outfit: saved?.outfit || next.defaultOutfit,
      maskOn: saved?.maskOn || false, performanceMask: saved?.performanceMask ?? next.performance.maskAvailable });
  }
  if (key === 'outfit' && character(profile.character)?.outfits.some(o => o.key === value)) profile.outfit = value;
  if (key === 'maskOn' || key === 'performanceMask') profile[key] = Boolean(value);
  return normalizeSlot(profile);
}
function forSlot(settings, slot) {
  if (!settings.dualEnabled) return { ...settings, slot: 'single' };
  return { ...settings, ...(slot === 'right' ? settings.dualRight : settings.dualLeft), followMouse: false, slot: slot === 'right' ? 'right' : 'left' };
}
function update(previous, key, value) {
  const settings = normalize(previous);
  const match = /^(dualLeft|dualRight)\.(character|outfit|maskOn|performanceMask)$/.exec(key);
  if (match) { settings[match[1]] = updateSlot(settings[match[1]], match[2], value); return normalize(settings); }
  if (key === 'followMouse' && settings.dualEnabled) return settings;
  if (!Object.hasOwn(DEFAULTS, key)) return settings;
  if (key === 'character') {
    if (!catalogue.some(c => c.key === value)) return settings;
    settings.characterPreferences[settings.character] = { outfit: settings.outfit, maskOn: settings.maskOn, performanceMask: settings.performanceMask };
    const next = character(value), saved = settings.characterPreferences[value];
    settings.character = value;
    settings.outfit = saved?.outfit || next.defaultOutfit;
    settings.maskOn = saved?.maskOn || false;
    settings.performanceMask = saved?.performanceMask ?? next.performance.maskAvailable;
  } else if (key === 'outfit') {
    if (!character(settings.character)?.outfits.some(o => o.key === value)) return settings;
    settings.outfit = value;
  } else if (key === 'sizePercent' || key === 'voiceVolume') settings[key] = Number(value);
  else if (key === 'language' || key === 'quietStart' || key === 'quietEnd') settings[key] = String(value);
  else settings[key] = Boolean(value);
  return normalize(settings);
}
module.exports = { catalogue, DEFAULTS, normalize, update, character, forSlot, setCustomCharacters, reloadBuiltinCharacters, getBuiltinState };
