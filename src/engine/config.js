// Match configuration: documented defaults, normalization and validation.
// Every host-configurable setting of the design document is a field here.

import { MODES, TOOL_IDS, TOOL_INFO, isToolId, toolsForMode } from './constants.js';
import { clone, hasOwn, isInt, isPlainObject } from './util.js';

// Shop prices (Custom mode), from the price table of the design document.
export const DEFAULT_PRICES = {
  probe: 1,
  counter: 1,
  reverse: 1,
  skip: 2,
  flip: 2,
  detector: 3,
  jail: 3,
  toolShield: 3,
  heal: 3,
  shuffle: 4,
  handSwap: 4,
  steal: 4,
  double: 5,
  link: 5,
  shotShield: 5,
};

// Default shop stock per reload: copies = max(1, ceil(alive / aliveDivisor)).
// Cheap tools get "half the living players", stronger tools get fewer copies.
export const DEFAULT_STOCK = {
  probe: { aliveDivisor: 2 },
  counter: { aliveDivisor: 2 },
  reverse: { aliveDivisor: 2 },
  skip: { aliveDivisor: 2 },
  flip: { aliveDivisor: 2 },
  detector: { aliveDivisor: 3 },
  jail: { aliveDivisor: 3 },
  toolShield: { aliveDivisor: 3 },
  heal: { aliveDivisor: 3 },
  shuffle: { aliveDivisor: 4 },
  handSwap: { aliveDivisor: 4 },
  steal: { aliveDivisor: 4 },
  double: { aliveDivisor: 5 },
  link: { aliveDivisor: 5 },
  shotShield: { aliveDivisor: 5 },
};

export const CONFIG_LIMITS = {
  hp: [1, 20],
  toolsPerReload: [0, 10],
  toolsPerTurn: [0, 50],
  shotTimeSeconds: [5, 600],
  price: [0, 99],
  stockCopies: [0, 99],
  aliveDivisor: [1, 15],
  startCoins: [0, 99],
  coinsPerReload: [0, 99],
  selfBlankCoin: [0, 99],
  lootCoinCap: [0, 99],
};

export function defaultConfig(mode = 'classic') {
  const config = {
    mode,
    hp: 5,
    toolsPerReload: mode === 'classic' ? 2 : 0,
    toolsPerTurn: 3,
    shotTimeSeconds: 30,
    enabledTools: toolsForMode(mode),
    randomizeSeats: true,
    custom: null,
  };
  if (mode === 'custom') {
    config.custom = {
      prices: clone(DEFAULT_PRICES),
      limitedStock: true,
      stock: clone(DEFAULT_STOCK),
      startCoins: 4,
      coinsPerReload: 3,
      selfBlankCoin: 1,
      lootCoinCap: 3,
    };
  }
  return config;
}

const TOP_KEYS = [
  'mode',
  'hp',
  'toolsPerReload',
  'toolsPerTurn',
  'shotTimeSeconds',
  'enabledTools',
  'randomizeSeats',
  'custom',
];
const CUSTOM_KEYS = ['prices', 'limitedStock', 'stock', 'startCoins', 'coinsPerReload', 'selfBlankCoin', 'lootCoinCap'];

// Validates a (possibly partial) config and returns the normalized full config.
// Result: { ok, config, errors } where errors is a list of { field, message }.
export function validateConfig(input = {}) {
  const errors = [];
  const err = (field, message) => errors.push({ field, message });

  if (!isPlainObject(input)) {
    return { ok: false, config: null, errors: [{ field: '', message: 'config must be an object' }] };
  }
  for (const key of Object.keys(input)) {
    if (!TOP_KEYS.includes(key)) err(key, 'unknown config field');
  }

  const mode = input.mode === undefined ? 'classic' : input.mode;
  if (!MODES.includes(mode)) {
    err('mode', `mode must be one of: ${MODES.join(', ')}`);
    return { ok: false, config: null, errors };
  }
  const config = defaultConfig(mode);

  const intField = (source, key, limitKey, target, label) => {
    if (source[key] === undefined) return;
    const [min, max] = CONFIG_LIMITS[limitKey];
    if (!isInt(source[key]) || source[key] < min || source[key] > max) {
      err(label, `must be an integer between ${min} and ${max}`);
      return;
    }
    target[key] = source[key];
  };
  const boolField = (source, key, target, label) => {
    if (source[key] === undefined) return;
    if (typeof source[key] !== 'boolean') {
      err(label, 'must be a boolean');
      return;
    }
    target[key] = source[key];
  };

  intField(input, 'hp', 'hp', config, 'hp');
  intField(input, 'toolsPerTurn', 'toolsPerTurn', config, 'toolsPerTurn');
  intField(input, 'shotTimeSeconds', 'shotTimeSeconds', config, 'shotTimeSeconds');
  boolField(input, 'randomizeSeats', config, 'randomizeSeats');

  if (input.toolsPerReload !== undefined) {
    if (mode === 'custom') err('toolsPerReload', 'not used in custom mode: tools are bought, never dealt');
    else intField(input, 'toolsPerReload', 'toolsPerReload', config, 'toolsPerReload');
  }

  if (input.enabledTools !== undefined) {
    const list = input.enabledTools;
    if (!Array.isArray(list)) {
      err('enabledTools', 'must be an array of tool ids');
    } else {
      let valid = true;
      const seen = {};
      for (const tool of list) {
        if (!isToolId(tool)) {
          err('enabledTools', `unknown tool id: ${String(tool)}`);
          valid = false;
        } else if (seen[tool]) {
          err('enabledTools', `duplicate tool id: ${tool}`);
          valid = false;
        } else if (!TOOL_INFO[tool].modes.includes(mode)) {
          err('enabledTools', `tool is not available in ${mode} mode: ${tool}`);
          valid = false;
        } else {
          seen[tool] = true;
        }
      }
      // Normalized to the canonical tool order.
      if (valid) config.enabledTools = TOOL_IDS.filter((t) => seen[t]);
    }
  }

  if (input.custom !== undefined && input.custom !== null) {
    if (mode !== 'custom') {
      err('custom', 'custom settings are only valid in custom mode');
    } else if (!isPlainObject(input.custom)) {
      err('custom', 'must be an object');
    } else {
      const src = input.custom;
      const dst = config.custom;
      for (const key of Object.keys(src)) {
        if (!CUSTOM_KEYS.includes(key)) err(`custom.${key}`, 'unknown config field');
      }
      boolField(src, 'limitedStock', dst, 'custom.limitedStock');
      intField(src, 'startCoins', 'startCoins', dst, 'custom.startCoins');
      intField(src, 'coinsPerReload', 'coinsPerReload', dst, 'custom.coinsPerReload');
      intField(src, 'selfBlankCoin', 'selfBlankCoin', dst, 'custom.selfBlankCoin');
      intField(src, 'lootCoinCap', 'lootCoinCap', dst, 'custom.lootCoinCap');

      if (src.prices !== undefined) {
        if (!isPlainObject(src.prices)) {
          err('custom.prices', 'must be an object of tool id -> price');
        } else {
          for (const tool of Object.keys(src.prices)) {
            if (!hasOwn(DEFAULT_PRICES, tool)) {
              err(`custom.prices.${tool}`, 'unknown or unsellable tool id');
              continue;
            }
            intField(src.prices, tool, 'price', dst.prices, `custom.prices.${tool}`);
          }
        }
      }

      if (src.stock !== undefined) {
        if (!isPlainObject(src.stock)) {
          err('custom.stock', 'must be an object of tool id -> copies');
        } else {
          for (const tool of Object.keys(src.stock)) {
            const label = `custom.stock.${tool}`;
            if (!hasOwn(DEFAULT_STOCK, tool)) {
              err(label, 'unknown or unsellable tool id');
              continue;
            }
            const value = src.stock[tool];
            const [cMin, cMax] = CONFIG_LIMITS.stockCopies;
            const [dMin, dMax] = CONFIG_LIMITS.aliveDivisor;
            if (isInt(value) && value >= cMin && value <= cMax) {
              dst.stock[tool] = value;
            } else if (
              isPlainObject(value) &&
              Object.keys(value).length === 1 &&
              isInt(value.aliveDivisor) &&
              value.aliveDivisor >= dMin &&
              value.aliveDivisor <= dMax
            ) {
              dst.stock[tool] = { aliveDivisor: value.aliveDivisor };
            } else {
              err(label, `must be an integer ${cMin}-${cMax} or { aliveDivisor: ${dMin}-${dMax} }`);
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, config: null, errors };
  return { ok: true, config, errors: [] };
}

// Number of copies of a tool the shop holds after a reload.
export function stockCopies(config, tool, aliveCount) {
  const rule = config.custom.stock[tool];
  if (typeof rule === 'number') return rule;
  return Math.max(1, Math.ceil(aliveCount / rule.aliveDivisor));
}
