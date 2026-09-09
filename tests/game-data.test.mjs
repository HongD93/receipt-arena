import test from 'node:test';
import assert from 'node:assert/strict';
import { levels, rules } from '../src/data/levels.js';
import { normalizeOutcome, friendlyError } from '../src/api/arena.js';

test('contract results preserve zero payments and do not derive clearance in the browser', () => {
  assert.deepEqual(
    normalizeOutcome({ normalPaid: 50n, attackPaid: 0n, expectedNormal: 50n, cleared: false }),
    { normalPaid: 50, attackPaid: 0, expectedNormal: 50, cleared: false },
  );
});

test('wallet cancellation and missing gas have distinct actionable messages', () => {
  assert.match(friendlyError({ code: 4001 }), /취소/);
  assert.match(friendlyError({ code: 'INSUFFICIENT_FUNDS' }), /테스트넷 CTC/);
  assert.doesNotMatch(friendlyError({ message: 'private-rpc-secret' }), /private-rpc-secret/);
});

test('level definitions refer only to supported contract masks and registered fixture roles', () => {
  assert.deepEqual(
    levels.map((level) => level.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    rules.map((rule) => rule.bit),
    [1, 2, 4],
  );
  for (const level of levels) assert.ok(level.baseline >= 0 && level.baseline <= 7);
  assert.equal(levels[1].normal, levels[1].attack);
  assert.equal(levels[2].normal, 'mixed');
});
