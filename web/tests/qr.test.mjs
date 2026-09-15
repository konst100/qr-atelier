import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload, contrastOnWhite, initialDraft, qrOptions } from '../lib/qr.ts';

test('accepts HTTP URLs and rejects executable URLs, credentials and missing hosts', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'https://', 'https://user:pass@example.com']) {
    assert.equal(buildPayload({ ...initialDraft, url }).error, 'urlInvalid');
  }
  assert.equal(buildPayload({ ...initialDraft, url: ' https://example.com/?x=1&name=Grüße ' }).payload, 'https://example.com/?x=1&name=Gr%C3%BC%C3%9Fe');
});
test('retains Russian, German and line breaks in text', () => {
  const text = 'Привет, мир!\nGrüße aus Köln — äöüß';
  assert.equal(buildPayload({ ...initialDraft, kind: 'text', text }).payload, text);
});
test('escapes Wi-Fi delimiters without changing the password', () => {
  const result = buildPayload({ ...initialDraft, kind: 'wifi', ssid: 'Office;A:B', password: 'a,b"c\\d' });
  assert.equal(result.payload, 'WIFI:T:WPA;S:Office\\;A\\:B;P:a\\,b\\"c\\\\d;H:false;;');
  const open = buildPayload({ ...initialDraft, kind: 'wifi', ssid: 'Guest', security: 'nopass', password: 'must-not-appear' });
  assert.equal(open.payload, 'WIFI:T:nopass;S:Guest;H:false;;');
});
test('vCard preserves names and escapes injected fields', () => {
  const result = buildPayload({ ...initialDraft, kind: 'contact', firstName: 'Иван', lastName: 'Müller;Test', organization: 'One\r\nURL:https://bad.example', phone: '+49 1234' });
  assert.ok(result.payload.includes('N:Müller\\;Test;Иван;;;\r\n'));
  assert.ok(result.payload.includes('ORG:One\\nURL:https://bad.example\r\n'));
  assert.ok(!result.payload.includes('\r\nURL:'));
  assert.ok(result.payload.endsWith('END:VCARD\r\n'));
});
test('bounds payload bytes and protects contrast and quiet zone', () => {
  assert.equal(buildPayload({ ...initialDraft, kind: 'text', text: 'я'.repeat(451) }).error, 'tooLong');
  assert.equal(buildPayload({ ...initialDraft, color: '#ffffff' }).error, 'colorInvalid');
  assert.equal(buildPayload({ ...initialDraft, color: 'red' }).error, 'colorInvalid');
  assert.ok(contrastOnWhite('#172554') > 10);
  assert.equal(qrOptions('test', '#172554', 'square').margin, 140);
});
