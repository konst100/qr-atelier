export type QrKind = 'url' | 'text' | 'wifi' | 'contact';
export type QrShape = 'square' | 'rounded';
export type QrDraft = {
  kind: QrKind; name: string; url: string; text: string;
  ssid: string; password: string; security: 'WPA' | 'nopass';
  firstName: string; lastName: string; phone: string; email: string; organization: string;
  color: string; shape: QrShape; logoDataUrl: string;
};
export type QrError = 'urlRequired' | 'urlInvalid' | 'textRequired' | 'ssidRequired' | 'passwordRequired' | 'contactRequired' | 'emailInvalid' | 'tooLong' | 'colorInvalid';
export const initialDraft: QrDraft = {
  kind: 'url', name: '', url: 'https://example.com', text: '', ssid: '', password: '', security: 'WPA',
  firstName: '', lastName: '', phone: '', email: '', organization: '', color: '#172554', shape: 'square', logoDataUrl: '',
};
const escapeWifi = (value: string) => value.replace(/[\\;,:\"]/g, '\\$&');
const escapeVcard = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[;,]/g, '\\$&');
export function contrastOnWhite(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0;
  const rgb = hex.slice(1).match(/.{2}/g)!.map((part) => {
    const c = parseInt(part, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 + 0.05);
}
export function buildPayload(draft: QrDraft): { payload: string; error?: QrError } {
  const bad = (error: QrError) => ({ payload: '', error });
  if (contrastOnWhite(draft.color) < 4.5) return bad('colorInvalid');
  let payload = '';
  switch (draft.kind) {
    case 'url': {
      if (!draft.url.trim()) return bad('urlRequired');
      try {
        const url = new URL(draft.url.trim());
        if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return bad('urlInvalid');
        payload = url.href;
      } catch { return bad('urlInvalid'); }
      break;
    }
    case 'text':
      if (!draft.text.trim()) return bad('textRequired');
      payload = draft.text;
      break;
    case 'wifi':
      if (!draft.ssid.trim()) return bad('ssidRequired');
      if (draft.security !== 'nopass' && !draft.password) return bad('passwordRequired');
      payload = `WIFI:T:${draft.security};S:${escapeWifi(draft.ssid)};${draft.security === 'nopass' ? '' : `P:${escapeWifi(draft.password)};`}H:false;;`;
      break;
    case 'contact':
      if (!draft.firstName.trim() && !draft.lastName.trim()) return bad('contactRequired');
      if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) return bad('emailInvalid');
      payload = ['BEGIN:VCARD', 'VERSION:3.0',
        `N:${escapeVcard(draft.lastName.trim())};${escapeVcard(draft.firstName.trim())};;;`,
        `FN:${escapeVcard(`${draft.firstName.trim()} ${draft.lastName.trim()}`.trim())}`,
        ...(draft.organization ? [`ORG:${escapeVcard(draft.organization)}`] : []),
        ...(draft.phone ? [`TEL:${escapeVcard(draft.phone)}`] : []),
        ...(draft.email ? [`EMAIL:${escapeVcard(draft.email)}`] : []),
        'END:VCARD', ''].join('\r\n');
  }
  if (new TextEncoder().encode(payload).length > 900) return bad('tooLong');
  return { payload };
}
export function qrOptions(data: string, color: string, shape: QrShape, size = 1000, logoDataUrl = '') {
  return {
    // The bundled encoder consumes byte strings. Encode UTF-8 explicitly so
    // Cyrillic, German characters and emoji survive decoding unchanged.
    width: size, height: size, type: 'svg' as const,
    data: Array.from(new TextEncoder().encode(data), (byte) => String.fromCharCode(byte)).join(''),
    margin: Math.ceil(size * 0.14),
    qrOptions: { errorCorrectionLevel: 'H' as const, mode: 'Byte' as const },
    dotsOptions: { color, type: shape },
    cornersSquareOptions: { color, type: 'square' as const },
    cornersDotOptions: { color, type: 'square' as const },
    backgroundOptions: { color: '#ffffff' },
    ...(logoDataUrl ? {
      image: logoDataUrl,
      imageOptions: { hideBackgroundDots: true, imageSize: 0.24, margin: 8, crossOrigin: 'anonymous' as const },
    } : {}),
  };
}

// Some SVG rasterizers misread quoted fragment URLs. Keep exported references
// in the broadly supported url(#id) form, also used by the on-screen SVG.
export function normalizeQrSvg(svg: SVGElement) {
  svg.querySelectorAll('[clip-path]').forEach((element) => {
    const value = element.getAttribute('clip-path');
    if (value) element.setAttribute('clip-path', value.replace(/url\(['"](#[\w-]+)['"]\)/g, 'url($1)'));
  });
}
