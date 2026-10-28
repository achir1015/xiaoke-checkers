import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { SYSTEM, buildParams } from '../src/renderer/js/advisor-core.js';

const require = createRequire(import.meta.url);

test('桌面版與 iPad 版軍師提示詞一致', () => {
  const desktop = require('../src/main/advisor.js');
  assert.equal(desktop.SYSTEM, SYSTEM);
  assert.match(SYSTEM, /中國跳棋/);
});

test('軍師請求參數：Opus 5.5、effort、伺服器端備援', () => {
  const p = buildParams({ model: 'claude-opus-5-5', effort: 'low' }, [{ role: 'user', content: 'hi' }], 4000);
  assert.equal(p.model, 'claude-opus-5-5');
  assert.deepEqual(p.output_config, { effort: 'low' });
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
});
