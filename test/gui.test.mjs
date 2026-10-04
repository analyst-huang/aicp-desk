import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Static document invariants only. Feature behavior is exercised in e2e/workflows.
const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');

test('GUI IDs are unique', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('static HTML avoids inline script and event handlers', () => {
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});
