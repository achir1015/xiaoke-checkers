import test from 'node:test';
import assert from 'node:assert/strict';
import { filterText, isBlocked } from '../src/renderer/js/safety.js';

test('聊天過濾不雅字詞（換成同樣長度的＊）', () => {
  assert.equal(filterText('你這個白痴'), '你這個＊＊');
  assert.equal(filterText('what the FUCK'), 'what the ＊＊＊＊');
  assert.equal(filterText('幹嘛跳這麼遠？好能幹！'), '幹嘛跳這麼遠？好能幹！');
  assert.equal(filterText('連跳好厲害'), '連跳好厲害');
});

test('封鎖名單比對暱稱（不分大小寫、去掉空白）', () => {
  const list = [{ name: 'Bad Guy', date: '2026-11-12' }, '阿德'];
  assert.ok(isBlocked(list, 'badguy'));
  assert.ok(isBlocked(list, '阿 德'));
  assert.ok(!isBlocked(list, '小明'));
  assert.ok(!isBlocked([], '小明'));
});
