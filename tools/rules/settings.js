// rooms/$code/settings: the engine's default config for the room's mode, stored without null
// fields. Readable by members; written only at creation, by the creator (seat s01). Keys and
// types are checked here; value ranges are checked by the engine (validateConfig).

import { BOOLEAN, CODE_OK, NUMBER, REFUSE, SIGNED_IN, all, isMember } from './helpers.js';

const ALL_TOOLS = '/^(detector|probe|counter|skip|swap|flip|shuffle|double|reverse|link|jail|handSwap|steal|shotShield|toolShield|heal)$/';
// Tools sold in the Custom shop (every tool except swap).
const SHOP_TOOLS = '/^(detector|probe|counter|skip|flip|shuffle|double|reverse|link|jail|handSwap|steal|shotShield|toolShield|heal)$/';

export function settingsRules() {
  return {
    '.read': all(SIGNED_IN, isMember('data.parent()')),
    '.write': all(
      SIGNED_IN,
      CODE_OK,
      '!data.parent().exists()',
      "newData.parent().child('meta').exists()",
      "newData.parent().child('members').child(auth.uid).val() === 's01'",
    ),
    // The custom block exists exactly in custom mode.
    '.validate':
      "newData.hasChildren(['mode', 'hp', 'toolsPerReload', 'toolsPerTurn', 'shotTimeSeconds', 'enabledTools', 'randomizeSeats']) && newData.hasChild('custom') === (newData.child('mode').val() === 'custom')",
    mode: { '.validate': "newData.val() === newData.parent().parent().child('meta/mode').val()" },
    hp: NUMBER,
    toolsPerReload: NUMBER,
    toolsPerTurn: NUMBER,
    shotTimeSeconds: NUMBER,
    enabledTools: {
      '.validate': 'newData.hasChildren()',
      $index: { '.validate': `$index.matches(/^([0-9]|1[0-5])$/) && newData.isString() && newData.val().matches(${ALL_TOOLS})` },
    },
    randomizeSeats: BOOLEAN,
    custom: {
      '.validate': "newData.hasChildren(['prices', 'limitedStock', 'stock', 'startCoins', 'coinsPerReload', 'selfBlankCoin', 'lootCoinCap'])",
      prices: {
        '.validate': 'newData.hasChildren()',
        $tool: { '.validate': `$tool.matches(${SHOP_TOOLS}) && newData.isNumber()` },
      },
      limitedStock: BOOLEAN,
      stock: {
        '.validate': 'newData.hasChildren()',
        $tool: {
          // A fixed number of copies, or { aliveDivisor }.
          '.validate': `$tool.matches(${SHOP_TOOLS}) && (newData.isNumber() || newData.hasChildren(['aliveDivisor']))`,
          aliveDivisor: NUMBER,
          $other: REFUSE,
        },
      },
      startCoins: NUMBER,
      coinsPerReload: NUMBER,
      selfBlankCoin: NUMBER,
      lootCoinCap: NUMBER,
      $other: REFUSE,
    },
    $other: REFUSE,
  };
}
