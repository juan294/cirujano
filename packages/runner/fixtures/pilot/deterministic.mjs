import assert from 'node:assert/strict';
import test from 'node:test';

test('deterministic fixture arithmetic', () => {
  assert.equal([2, 3, 5, 7].reduce((sum, value) => sum + value, 0), 17);
});

test('deterministic fixture ordering', () => {
  assert.deepEqual(['runner', 'pilot', 'fixture'].sort(), ['fixture', 'pilot', 'runner']);
});
