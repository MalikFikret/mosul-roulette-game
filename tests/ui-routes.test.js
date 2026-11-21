// Game UI: hash routes, invite links and table codes typed or pasted by a player (pure helpers
// of src/ui/routes.js, no browser needed).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES, codeFromText, hashFor, inviteLink, parseRoute } from '../src/ui/routes.js';

describe('parseRoute', () => {
  test('home for an empty hash, "#", "#/" and non-strings', () => {
    for (const hash of ['', '#', '#/', '#//', undefined, null, 42]) {
      assert.deepEqual(parseRoute(hash), { name: ROUTES.HOME }, String(hash));
    }
  });

  test('the fixed pages', () => {
    assert.deepEqual(parseRoute('#/yeni'), { name: ROUTES.CREATE });
    assert.deepEqual(parseRoute('#/hakkinda'), { name: ROUTES.ABOUT });
    assert.deepEqual(parseRoute('#/hakkinda/'), { name: ROUTES.ABOUT });
  });

  test('a table and its recover page, code normalized', () => {
    assert.deepEqual(parseRoute('#/masa/ABC234'), { name: ROUTES.TABLE, code: 'ABC234' });
    assert.deepEqual(parseRoute('#/masa/abc234'), { name: ROUTES.TABLE, code: 'ABC234' });
    assert.deepEqual(parseRoute('#/masa/ABC234/'), { name: ROUTES.TABLE, code: 'ABC234' });
    assert.deepEqual(parseRoute('#/masa/ABC234?ref=x'), { name: ROUTES.TABLE, code: 'ABC234' });
    assert.deepEqual(parseRoute('#/masa/ABC234/don'), { name: ROUTES.RECOVER, code: 'ABC234' });
    assert.deepEqual(parseRoute('#/masa/%61bc234'), { name: ROUTES.TABLE, code: 'ABC234' });
  });

  test('an invalid table code is never returned (untrusted hash)', () => {
    const bad = [
      '#/masa/', '#/masa', '#/masa/ABC23', '#/masa/ABC2345', '#/masa/ABC0O1', '#/masa/ABCIL2',
      '#/masa/ABC 34', '#/masa/%E0%A4%A', '#/masa/<script>', '#/masa/..%2F..', '#/masa/ABC%2F34',
    ];
    for (const hash of bad) {
      const route = parseRoute(hash);
      assert.equal(route.code, undefined, hash);
      assert.ok([ROUTES.BAD_CODE, ROUTES.UNKNOWN].includes(route.name), hash);
    }
    // %34 decodes to "4": the code is checked after decoding, so this is the valid ABC234.
    assert.deepEqual(parseRoute('#/masa/ABC23%34'), { name: ROUTES.TABLE, code: 'ABC234' });
  });

  test('unknown hashes', () => {
    for (const hash of ['#/nope', '#/masa/ABC234/other', '#/masa/ABC234/don/x', '#/yeni/x', 'hakkinda/x']) {
      assert.equal(parseRoute(hash).name, ROUTES.UNKNOWN, hash);
    }
  });

  test('hashFor builds what parseRoute reads back, and refuses a bad code', () => {
    assert.deepEqual(parseRoute(hashFor.home()), { name: ROUTES.HOME });
    assert.deepEqual(parseRoute(hashFor.create()), { name: ROUTES.CREATE });
    assert.deepEqual(parseRoute(hashFor.about()), { name: ROUTES.ABOUT });
    assert.deepEqual(parseRoute(hashFor.table('XYZ789')), { name: ROUTES.TABLE, code: 'XYZ789' });
    assert.deepEqual(parseRoute(hashFor.recover('XYZ789')), { name: ROUTES.RECOVER, code: 'XYZ789' });
    assert.throws(() => hashFor.table('xyz789'));
    assert.throws(() => hashFor.recover('<b>'));
  });
});

describe('invite links', () => {
  test('page address without query or hash, plus #/masa/CODE', () => {
    assert.equal(inviteLink('https://malikfikret.github.io/son-cay/', 'ABC234'), 'https://malikfikret.github.io/son-cay/#/masa/ABC234');
    assert.equal(inviteLink('https://malikfikret.github.io/son-cay/#/masa/ABC234/don', 'ABC234'), 'https://malikfikret.github.io/son-cay/#/masa/ABC234');
    assert.equal(inviteLink('http://localhost:8080/?x=1#/yeni', 'XYZ789'), 'http://localhost:8080/#/masa/XYZ789');
    assert.equal(inviteLink('https://malikfikret.github.io/son-cay/index.html', 'ABC234'), 'https://malikfikret.github.io/son-cay/index.html#/masa/ABC234');
    assert.throws(() => inviteLink('https://example.test/', 'bad'));
  });

  test('an invite link parses back to its code', () => {
    const link = inviteLink('https://malikfikret.github.io/son-cay/', 'QRS456');
    assert.deepEqual(parseRoute(new URL(link).hash), { name: ROUTES.TABLE, code: 'QRS456' });
    assert.equal(codeFromText(link), 'QRS456');
  });
});

describe('codeFromText (typed or pasted)', () => {
  test('a bare code in any case, with spaces around', () => {
    assert.equal(codeFromText('ABC234'), 'ABC234');
    assert.equal(codeFromText(' abc234 '), 'ABC234');
  });

  test('a whole invite link, also its recover page', () => {
    assert.equal(codeFromText('https://malikfikret.github.io/son-cay/#/masa/abc234'), 'ABC234');
    assert.equal(codeFromText('  http://localhost:8080/#/masa/ABC234/don\n'), 'ABC234');
    assert.equal(codeFromText('#/masa/ABC234'), 'ABC234');
  });

  test('null for anything else', () => {
    for (const text of ['', '   ', 'ABC', 'ABC2345', 'ABC0O1', 'https://x.test/#/yeni', 'https://x.test/#/masa/BAD', 'https://x.test/', null, 5]) {
      assert.equal(codeFromText(text), null, String(text));
    }
  });
});
