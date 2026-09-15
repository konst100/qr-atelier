import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import jsQR from 'jsqr';
import QRCodeStyling from 'qr-code-styling';
import { buildPayload, initialDraft, normalizeQrSvg, qrOptions } from '../lib/qr.ts';

const examples = [
  { ...initialDraft, url: 'https://example.com/path?name=Grüße&next=1' },
  { ...initialDraft, kind: 'text', text: 'Привет, мир!\nGrüße — äöüß' },
  { ...initialDraft, kind: 'wifi', ssid: 'Office;Köln', password: 'test:";\\123456' },
  { ...initialDraft, kind: 'contact', firstName: 'Иван', lastName: 'Müller', phone: '+49 1234567', email: 'test@example.com' },
];
for (const example of examples) {
  for (const shape of ['square', 'rounded']) {
    test(`exported SVG decodes: ${example.kind}, ${shape}`, async () => {
      const { payload, error } = buildPayload(example);
      assert.equal(error, undefined);
      const code = new QRCodeStyling({ ...qrOptions(payload, example.color, shape), jsdom: JSDOM });
      code.applyExtension(normalizeQrSvg);
      const svg = await code.getRawData('svg');
      assert.ok(svg);
      const raster = new Resvg(svg.toString()).render();
      const result = jsQR(new Uint8ClampedArray(raster.pixels), raster.width, raster.height);
      assert.equal(result?.data, payload);
    });
  }
}
