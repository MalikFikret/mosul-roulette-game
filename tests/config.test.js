// Config defaults and validation (document: "Setup before start",
// "Tools table", "Shop", "What the host can change").

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_IDS,
  TOOL_INFO,
  ERR,
  defaultConfig,
  validateConfig,
  stockCopies,
  createMatch,
  isHiddenTool,
} from '../src/engine/index.js';
import { ids } from './helpers.js';

const players = (n) => ids(n).map((id) => ({ id }));

test('config: tool ids follow the order of the tools table', () => {
  assert.deepEqual(TOOL_IDS, [
    'detector',
    'probe',
    'counter',
    'skip',
    'swap',
    'flip',
    'shuffle',
    'double',
    'reverse',
    'link',
    'jail',
    'handSwap',
    'steal',
    'shotShield',
    'toolShield',
    'heal',
  ]);
});

test('config: exactly three tools are "anytime" tools (shot shield, tool shield, heal)', () => {
  const anytime = TOOL_IDS.filter((t) => TOOL_INFO[t].timing === 'anytime');
  assert.deepEqual(anytime, ['shotShield', 'toolShield', 'heal']);
});

test('config: tools table visibility column (hidden vs announced)', () => {
  const hiddenClassic = TOOL_IDS.filter((t) => isHiddenTool(t, 'classic'));
  assert.deepEqual(hiddenClassic, ['detector', 'probe', 'counter', 'skip', 'swap', 'flip', 'shotShield', 'toolShield']);
  // Custom: skip becomes public.
  assert.equal(isHiddenTool('skip', 'custom'), false);
  assert.equal(isHiddenTool('flip', 'custom'), true);
});

test('config: classic defaults match the settings table', () => {
  const res = validateConfig({});
  assert.equal(res.ok, true);
  assert.equal(res.config.mode, 'classic');
  assert.equal(res.config.hp, 5);
  assert.equal(res.config.toolsPerReload, 2);
  assert.equal(res.config.toolsPerTurn, 3);
  assert.equal(res.config.shotTimeSeconds, 30);
  assert.deepEqual(res.config.enabledTools, TOOL_IDS);
  assert.equal(res.config.randomizeSeats, true);
  assert.equal(res.config.custom, null);
  assert.deepEqual(res.config, defaultConfig('classic'));
});

test('config: custom defaults match the custom chapter', () => {
  const res = validateConfig({ mode: 'custom' });
  assert.equal(res.ok, true);
  const c = res.config;
  assert.equal(c.hp, 5);
  assert.equal(c.toolsPerTurn, 3);
  assert.equal(c.shotTimeSeconds, 30);
  assert.equal(c.custom.startCoins, 4, 'design change: 4, not 5');
  assert.equal(c.custom.coinsPerReload, 3);
  assert.equal(c.custom.selfBlankCoin, 1);
  assert.equal(c.custom.lootCoinCap, 3);
  assert.equal(c.custom.limitedStock, true);
});

test('config: custom mode never contains the swap tool', () => {
  const res = validateConfig({ mode: 'custom' });
  assert.equal(res.config.enabledTools.includes('swap'), false);
  assert.equal(res.config.enabledTools.length, 15);
  const bad = validateConfig({ mode: 'custom', enabledTools: ['swap', 'heal'] });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].field, 'enabledTools');
});

test('config: price table (1 to 5 coins by tool strength)', () => {
  const prices = validateConfig({ mode: 'custom' }).config.custom.prices;
  assert.deepEqual(
    { probe: prices.probe, counter: prices.counter, reverse: prices.reverse },
    { probe: 1, counter: 1, reverse: 1 },
  );
  assert.deepEqual({ skip: prices.skip, flip: prices.flip }, { skip: 2, flip: 2 });
  assert.deepEqual(
    { detector: prices.detector, jail: prices.jail, toolShield: prices.toolShield, heal: prices.heal },
    { detector: 3, jail: 3, toolShield: 3, heal: 3 },
  );
  assert.deepEqual(
    { shuffle: prices.shuffle, handSwap: prices.handSwap, steal: prices.steal },
    { shuffle: 4, handSwap: 4, steal: 4 },
  );
  assert.deepEqual(
    { double: prices.double, link: prices.link, shotShield: prices.shotShield },
    { double: 5, link: 5, shotShield: 5 },
  );
  assert.equal(Object.keys(prices).length, 15);
});

test('config: default shop stock follows the living players, stronger tools get fewer copies', () => {
  const config = validateConfig({ mode: 'custom' }).config;
  // "For example half of them": cheap tools with 6 alive -> 3 copies.
  assert.equal(stockCopies(config, 'probe', 6), 3);
  assert.equal(stockCopies(config, 'detector', 6), 2);
  assert.equal(stockCopies(config, 'shuffle', 6), 2);
  assert.equal(stockCopies(config, 'shotShield', 6), 2);
  assert.equal(stockCopies(config, 'shotShield', 15), 3);
  assert.equal(stockCopies(config, 'probe', 15), 8);
  for (const alive of [2, 3, 7, 15]) {
    assert.ok(stockCopies(config, 'probe', alive) >= stockCopies(config, 'detector', alive));
    assert.ok(stockCopies(config, 'detector', alive) >= stockCopies(config, 'shuffle', alive));
    assert.ok(stockCopies(config, 'shuffle', alive) >= stockCopies(config, 'double', alive));
    assert.ok(stockCopies(config, 'double', alive) >= 1);
  }
});

test('config: the host can override every configurable field', () => {
  const classic = validateConfig({
    hp: 3,
    toolsPerReload: 4,
    toolsPerTurn: 1,
    shotTimeSeconds: 60,
    enabledTools: ['heal', 'detector'],
    randomizeSeats: false,
  });
  assert.equal(classic.ok, true);
  assert.equal(classic.config.hp, 3);
  assert.equal(classic.config.toolsPerReload, 4);
  assert.equal(classic.config.toolsPerTurn, 1);
  assert.equal(classic.config.shotTimeSeconds, 60);
  assert.deepEqual(classic.config.enabledTools, ['detector', 'heal']); // canonical order

  const custom = validateConfig({
    mode: 'custom',
    hp: 2,
    custom: {
      prices: { heal: 1 },
      limitedStock: false,
      stock: { heal: 7, probe: { aliveDivisor: 1 } },
      startCoins: 9,
      coinsPerReload: 0,
      selfBlankCoin: 2,
      lootCoinCap: 5,
    },
  });
  assert.equal(custom.ok, true);
  const c = custom.config.custom;
  assert.equal(c.prices.heal, 1);
  assert.equal(c.prices.double, 5); // untouched prices keep their default
  assert.equal(c.limitedStock, false);
  assert.equal(c.stock.heal, 7);
  assert.equal(stockCopies(custom.config, 'heal', 10), 7);
  assert.equal(stockCopies(custom.config, 'probe', 10), 10);
  assert.equal(c.startCoins, 9);
  assert.equal(c.coinsPerReload, 0);
  assert.equal(c.selfBlankCoin, 2);
  assert.equal(c.lootCoinCap, 5);
});

test('config: invalid values are rejected with the offending field', () => {
  const cases = [
    [{ mode: 'hard' }, 'mode'],
    [{ hp: 0 }, 'hp'],
    [{ hp: 2.5 }, 'hp'],
    [{ hp: '5' }, 'hp'],
    [{ toolsPerReload: -1 }, 'toolsPerReload'],
    [{ toolsPerTurn: 51 }, 'toolsPerTurn'],
    [{ shotTimeSeconds: 1 }, 'shotTimeSeconds'],
    [{ enabledTools: 'all' }, 'enabledTools'],
    [{ enabledTools: ['laser'] }, 'enabledTools'],
    [{ enabledTools: ['heal', 'heal'] }, 'enabledTools'],
    [{ randomizeSeats: 'yes' }, 'randomizeSeats'],
    [{ bogus: 1 }, 'bogus'],
    [{ custom: { startCoins: 1 } }, 'custom'],
    [{ mode: 'custom', toolsPerReload: 2 }, 'toolsPerReload'],
    [{ mode: 'custom', custom: { startCoins: -1 } }, 'custom.startCoins'],
    [{ mode: 'custom', custom: { prices: { swap: 1 } } }, 'custom.prices.swap'],
    [{ mode: 'custom', custom: { prices: { heal: 100 } } }, 'custom.prices.heal'],
    [{ mode: 'custom', custom: { stock: { heal: -1 } } }, 'custom.stock.heal'],
    [{ mode: 'custom', custom: { stock: { heal: { aliveDivisor: 0 } } } }, 'custom.stock.heal'],
    [{ mode: 'custom', custom: { limitedStock: 1 } }, 'custom.limitedStock'],
    [{ mode: 'custom', custom: { secretTransfers: false } }, 'custom.secretTransfers'],
  ];
  for (const [input, field] of cases) {
    const res = validateConfig(input);
    assert.equal(res.ok, false, JSON.stringify(input));
    assert.ok(
      res.errors.some((e) => e.field === field),
      `${JSON.stringify(input)} should flag ${field}, got ${JSON.stringify(res.errors)}`,
    );
  }
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig([]).ok, false);
});

test('config: fixed (non-configurable) parts of custom mode have no config field', () => {
  // Private info, coins/shop existence, secret transfers, hidden balances and
  // ghost predictions cannot be switched off: there is simply no field for them.
  const custom = validateConfig({ mode: 'custom' }).config.custom;
  assert.deepEqual(Object.keys(custom).sort(), [
    'coinsPerReload',
    'limitedStock',
    'lootCoinCap',
    'prices',
    'selfBlankCoin',
    'startCoins',
    'stock',
  ]);
});

test('config: an empty tool list is allowed (the host may disable every tool)', () => {
  const res = createMatch({ enabledTools: [] }, players(3), 5);
  assert.equal(res.ok, true);
  for (const p of res.state.players) assert.deepEqual(p.hand, []);
});

test('createMatch: rejects an invalid config', () => {
  const res = createMatch({ hp: 0 }, players(3), 1);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, ERR.INVALID_CONFIG);
  assert.equal(res.error.details[0].field, 'hp');
});

test('createMatch: needs 3 to 15 players with unique ids', () => {
  assert.equal(createMatch({}, players(2), 1).error.code, ERR.INVALID_PLAYERS);
  assert.equal(createMatch({}, players(16), 1).error.code, ERR.INVALID_PLAYERS);
  assert.equal(createMatch({}, [{ id: 'a' }, { id: 'a' }, { id: 'b' }], 1).error.code, ERR.INVALID_PLAYERS);
  assert.equal(createMatch({}, [{ id: '' }, { id: 'a' }, { id: 'b' }], 1).error.code, ERR.INVALID_PLAYERS);
  assert.equal(createMatch({}, [{ id: 1 }, { id: 'a' }, { id: 'b' }], 1).error.code, ERR.INVALID_PLAYERS);
  assert.equal(createMatch({}, 'abc', 1).error.code, ERR.INVALID_PLAYERS);
  assert.equal(
    createMatch({}, [{ id: 'a', confirmShot: 'no' }, { id: 'b' }, { id: 'c' }], 1).error.code,
    ERR.INVALID_PLAYERS,
  );
  for (const n of [3, 15]) assert.equal(createMatch({}, players(n), 1).ok, true);
});

test('createMatch: needs a seed (the engine has no randomness of its own)', () => {
  assert.equal(createMatch({}, players(3)).error.code, ERR.INVALID_SEED);
  assert.equal(createMatch({}, players(3), 1.5).error.code, ERR.INVALID_SEED);
  assert.equal(createMatch({}, players(3), '').error.code, ERR.INVALID_SEED);
  assert.equal(createMatch({}, players(3), 'room-42').ok, true);
  assert.equal(createMatch({}, players(3), 0).ok, true);
});
