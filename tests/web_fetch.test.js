import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractReadableText,
  validateWebUrl,
  fetchWebPage,
  MAX_WEB_TEXT_CHARS,
} from '../js/web_fetch.js';
import { escHtml } from '../js/markdown.js';

test('extractReadableText: strips <script>/<style> and returns clean main text', () => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>مقاله نمونه</title>
        <style>body { color: red; } .hidden { display: none; }</style>
        <script>console.error("evil"); alert(1);</script>
      </head>
      <body>
        <nav>منوی ناوبری</nav>
        <main>
          <h1>عنوان اصلی</h1>
          <p>متن اصلی صفحه برای آزمایش خوانش.</p>
        </main>
        <footer>پاورقی سایت</footer>
      </body>
    </html>
  `;

  const res = extractReadableText(html, 'https://example.com/article');
  assert.equal(res.title, 'مقاله نمونه');
  assert.equal(res.truncated, false);
  assert.ok(res.text.includes('عنوان اصلی'));
  assert.ok(res.text.includes('متن اصلی صفحه برای آزمایش خوانش.'));
  assert.ok(!res.text.includes('alert(1)'));
  assert.ok(!res.text.includes('color: red'));
  assert.ok(!res.text.includes('منوی ناوبری'));
});

test('extractReadableText: 20,000-char cap truncates and sets truncated: true', () => {
  const longBody = 'A'.repeat(MAX_WEB_TEXT_CHARS + 5000);
  const html = `<html><head><title>Long</title></head><body><p>${longBody}</p></body></html>`;

  const res = extractReadableText(html, 'https://example.com/long');
  assert.equal(res.truncated, true);
  assert.ok(res.text.includes('۲۰٬۰۰۰'));
  assert.ok(res.text.length < longBody.length);
});

test('validateWebUrl & fetchWebPage: rejects non-http(s) URLs', async () => {
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'ftp://example.com']) {
    assert.throws(() => validateWebUrl(bad), /[\u0600-\u06FF]/);
    await assert.rejects(() => fetchWebPage({ url: bad }), /[\u0600-\u06FF]/);
  }
  assert.equal(validateWebUrl('https://example.com/path'), 'https://example.com/path');
});

test('URL and title containing quotes/HTML escape safely', () => {
  const nastyUrl = 'https://example.com/?q="><img src=x onerror=alert(1)>';
  const nastyTitle = 'Title "quoted" <script>alert(1)</script>';
  const html = `<html><head><title>${nastyTitle}</title></head><body><p>Body text</p></body></html>`;

  const extracted = extractReadableText(html, nastyUrl);
  const safeHref = escHtml(extracted.url);
  const safeTitle = escHtml(extracted.title);

  assert.ok(!safeHref.includes('"') && !safeHref.includes('<') && !safeHref.includes('>'));
  assert.ok(!safeTitle.includes('"') && !safeTitle.includes('<script>'));
  assert.ok(safeHref.includes('&quot;') || safeHref.includes('&lt;'));
  assert.ok(safeTitle.includes('&lt;script&gt;'));
});
