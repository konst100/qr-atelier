'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, ScanLine, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { normalizeQrSvg, qrOptions, type QrShape } from '@/lib/qr';
import { translations, type Language } from '@/lib/translations';

type Props = { payload: string; color: string; shape: QrShape; logoDataUrl: string; language: Language; name: string; validation?: string; downloadBlocked?: boolean; onMessage: (text: string) => void };
export function QrPreview({ payload, color, shape, logoDataUrl, language, name, validation, downloadBlocked = false, onMessage }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const instance = useRef<import('qr-code-styling').default | null>(null);
  const [readyKey, setReadyKey] = useState('');
  const [failedKey, setFailedKey] = useState('');
  const [downloading, setDownloading] = useState(false);
  const key = JSON.stringify([payload, color, shape, logoDataUrl]);
  const t = translations[language];
  const ready = !!payload && readyKey === key;
  useEffect(() => {
    let cancelled = false;
    setReadyKey('');
    setFailedKey('');
    instance.current = null;
    mount.current?.replaceChildren();
    if (!payload) return;
    const timer = setTimeout(async () => {
      try {
        const { default: QRCodeStyling } = await import('qr-code-styling');
        const qr = new QRCodeStyling(qrOptions(payload, color, shape, 1000, logoDataUrl));
        qr.applyExtension(normalizeQrSvg);
        await qr.getRawData('svg');
        if (cancelled || !mount.current) return;
        qr.append(mount.current);
        instance.current = qr;
        setReadyKey(key);
      } catch { if (!cancelled) setFailedKey(key); }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [payload, color, shape, logoDataUrl, key]);
  async function download(extension: 'png' | 'svg') {
    if (!ready || !instance.current || downloading || downloadBlocked) return;
    setDownloading(true);
    try {
      const fileName = (name.trim() || 'qr-code').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80);
      await instance.current.download({ name: fileName, extension });
      onMessage(t.downloaded);
    } catch { onMessage(t.downloadError); }
    finally { setDownloading(false); }
  }
  return <aside className="preview-panel">
    <div className="preview-heading"><h2>{t.preview}</h2><span className="live-indicator"><i />{t.live}</span></div>
    <div className="qr-stage"><div className="qr-paper">
      <div ref={mount} className={`qr-image ${ready ? '' : 'qr-hidden'}`} role="img" aria-label={t.preview} />
      {!ready && <div className="qr-placeholder" role="status"><ScanLine size={48} strokeWidth={1} /><span>{validation || (failedKey === key ? t.error : t.generating)}</span></div>}
    </div><span className="scan-caption"><ScanLine size={17} />{t.scan}</span></div>
    <div className="preview-bottom">
      <div className="status-line"><span className={ready ? 'status-dot' : 'status-dot inactive'} /><span>{ready ? t.ready : t.preview}</span><span className="resolution">1000 × 1000</span></div>
      {validation && <p className="validation" role="alert"><AlertCircle size={16} />{validation}</p>}
      <div className="download-buttons"><Button className="primary-button" disabled={!ready || downloading || downloadBlocked} onClick={() => download('png')} aria-label={`${t.download} PNG`}><Download size={17} />PNG</Button><Button variant="outline" disabled={!ready || downloading || downloadBlocked} onClick={() => download('svg')} aria-label={`${t.download} SVG`}><Download size={17} />SVG</Button></div>
      <p className="file-hint">{t.fileHint}</p>
    </div>
  </aside>;
}
