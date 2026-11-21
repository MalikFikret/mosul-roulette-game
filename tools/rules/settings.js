// rooms/$code/settings: the match config of the room (the engine's config), stored without null
// fields. Readable by members. Written at creation by the creator (seat s01), and afterwards
// replaced by the CURRENT host (the valid member on meta.hostSeat) between matches only. Keys
// and types are checked here; value ranges are checked by the engine (validateConfig, in
// updateSettings and again in startMatch). The mode always equals meta.mode.

import {
  BOOLEAN,
  CODE_OK,
  IN_LOBBY,
  IS_HOST,
  NUMBER,
  REFUSE,
  ROOM_BEFORE,
  SIGNED_IN,
  all,
  anyOf,
  isMember,
} from './helpers.js';

const ALL_TOOLS = '/^(detector|probe|counter|skip|swap|flip|shuffle|double|reverse|link|jail|handSwap|steal|shotShield|toolShield|heal)$/';
// Tools sold in the Custom shop (every tool except swap).
const SHOP_TOOLS = '/^(detector|probe|counter|skip|flip|shuffle|double|reverse|link|jail|handSwap|steal|shotShield|toolShield|heal)$/';

export function settingsRules() {
  return {
    '.read': all(SIGNED_IN, isMember(ROOM_BEFORE)),
    '.write': all(
      SIGNED_IN,
      CODE_OK,
      anyOf(
        // Creation: together with the room, by its creator (seat s01).
        all(
          `!${ROOM_BEFORE}.exists()`,
          "newData.parent().child('meta').exists()",
          "newData.parent().child('members').child(auth.uid).val() === 's01'",
        ),
        // Update: the current host, while no match runs (before and after the write), never
        // deleting the settings (a whole-room deletion uses the rooms/$code grant instead).
        all('newData.exists()', IS_HOST, IN_LOBBY),
      ),
      // Settings change only between matches.
      "newData.parent().child('meta/status').val() === 'lobby'",
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
