// Game UI: static checks of the source files (no browser): no npm firebase import, no
// innerHTML-style markup injection, no storage of the Şifre, and a strict CSP in index.html.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);

function uiFiles(dir = new URL('src/ui/', root)) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) files.push(...uiFiles(url));
    else if (entry.name.endsWith('.js')) files.push(url);
  }
  return files;
}

// The code without comments (comments may name what the code must not use).
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const sources = uiFiles().map((url) => ({
  name: url.pathname.split('/src/ui/')[1],
  text: stripComments(readFileSync(url, 'utf8')),
}));

describe('game UI sources', () => {
  test('there are UI modules to check', () => {
    assert.ok(sources.length >= 10);
  });

  test('only the CDN SDK is imported, never the npm "firebase" package', () => {
    for (const { name, text } of sources) {
      assert.doesNotMatch(text, /from\s+['"](firebase|@firebase\/[^'"]*)(\/[^'"]*)?['"]/, name);
      for (const [, spec] of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        assert.ok(spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('https://www.gstatic.com/firebasejs/13.4.0/'), `${name}: ${spec}`);
      }
    }
  });

  test('no innerHTML / outerHTML / insertAdjacentHTML / document.write', () => {
    for (const { name, text } of sources) {
      assert.doesNotMatch(text, /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/, name);
    }
  });

  test('only memory.js touches browser storage, and it stores the table code only', () => {
    for (const { name, text } of sources) {
      if (name === 'memory.js') continue;
      assert.doesNotMatch(text, /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/, name);
    }
    const memory = sources.find((s) => s.name === 'memory.js').text;
    assert.equal([...memory.matchAll(/setItem\(/g)].length, 1);
    assert.match(memory, /setItem\(KEY, code\)/);
  });
});

describe('index.html', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  const directives = Object.fromEntries((csp ?? '').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

  test('has a strict Content-Security-Policy', () => {
    assert.ok(csp, 'CSP meta tag');
    assert.deepEqual(directives['default-src'], ["'none'"]);
    assert.deepEqual(directives['script-src'], ["'self'", 'https://www.gstatic.com']);
    assert.deepEqual(directives['style-src'], ["'self'", 'https://fonts.googleapis.com']);
    assert.deepEqual(directives['font-src'], ["'self'", 'https://fonts.gstatic.com']);
    for (const source of directives['connect-src']) assert.match(source, /^(http|ws):\/\/127\.0\.0\.1:(9099|9000)$/);
    assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  });

  test('is Turkish, left to right, and loads the UI entry module', () => {
    assert.match(html, /<html lang="tr" dir="ltr">/);
    assert.match(html, /<script type="module" src="src\/ui\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /\sstyle="/);
  });
});
