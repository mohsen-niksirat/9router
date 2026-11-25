import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown, escHtml } from '../js/markdown.js';

test('markdown safety: <script> tags render fully escaped', () => {
  const html = renderMarkdown('Hello <script>alert("xss")</script> world');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
});

test('markdown safety: onerror= attribute injection renders fully escaped', () => {
  const html = renderMarkdown('<img src="x" onerror="alert(1)">');
  assert.ok(!html.includes('<img '));
  assert.ok(!/onerror\s*=\s*["']?alert/i.test(html));
  assert.ok(html.includes('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;'));
});

test('markdown safety: quote breakout in provider/model name renders fully escaped', () => {
  const maliciousName = `OpenAI" onclick="alert('xss')" data-x='1'><script>evil()</script>`;
  const escapedAttr = escHtml(maliciousName);
  assert.ok(!escapedAttr.includes('"'));
  assert.ok(!escapedAttr.includes("'"));
  assert.ok(!escapedAttr.includes('<'));
  assert.ok(!escapedAttr.includes('>'));
  assert.ok(escapedAttr.includes('&quot;'));
  assert.ok(escapedAttr.includes('&#39;'));

  const rendered = renderMarkdown(`Provider: ${maliciousName}`);
  assert.ok(!rendered.includes('<script>'));
  assert.ok(!/onclick\s*=\s*"alert/i.test(rendered));
});
