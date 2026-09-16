'use client';
import { Link2, AlignLeft, Wifi, ContactRound, Radio, Zap } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { translations, type Language } from '@/lib/translations';
import type { QrDraft, QrKind } from '@/lib/qr';
type Props = { draft: QrDraft; language: Language; locked?: boolean; update: <K extends keyof QrDraft>(key: K, value: QrDraft[K]) => void };
export function QrFields({ draft, language, update, locked = false }: Props) {
  const t = translations[language];
  return <Tabs value={draft.kind} onValueChange={(value) => update('kind', value as QrKind)} className="type-tabs">
    <TabsList aria-label={t.content} className="type-list">{([{ kind: 'url', Icon: Link2 }, { kind: 'text', Icon: AlignLeft }, { kind: 'wifi', Icon: Wifi }, { kind: 'contact', Icon: ContactRound }] as const).map(({ kind, Icon }) => <TabsTrigger disabled={locked} key={kind} value={kind}><Icon size={17}/>{t[kind]}</TabsTrigger>)}</TabsList>
    <TabsContent value="url"><div className="field"><Label>{t.linkMode}</Label><div className="mode-row"><button type="button" disabled={locked} className={draft.mode === 'static' ? 'mode-button selected' : 'mode-button'} aria-pressed={draft.mode === 'static'} onClick={() => update('mode', 'static')}><Radio size={15}/><span><strong>{t.staticMode}</strong><small>{t.staticModeHint}</small></span></button><button type="button" disabled={locked} className={draft.mode === 'dynamic' ? 'mode-button selected' : 'mode-button'} aria-pressed={draft.mode === 'dynamic'} onClick={() => update('mode', 'dynamic')}><Zap size={15}/><span><strong>{t.dynamicMode}</strong><small>{t.dynamicModeHint}</small></span></button></div></div><div className="field"><Label htmlFor="qr-url">{t.urlLabel}</Label><Input id="qr-url" value={draft.url} onChange={(event) => update('url', event.target.value)} maxLength={1200} type="url" placeholder="https://example.com" aria-describedby="url-hint" /><p id="url-hint" className="field-hint">{t.urlHint}</p></div>{draft.mode === 'dynamic' && <div className="field"><Label htmlFor="qr-slug">{t.slug}</Label><Input readOnly={locked} id="qr-slug" value={draft.slug} onChange={(event) => update('slug', event.target.value)} maxLength={64} placeholder="summer-2026" aria-describedby="slug-hint" /><p id="slug-hint" className="field-hint">{locked ? t.slugLocked : t.slugHint}</p></div>}</TabsContent>
    <TabsContent value="text"><div className="field"><Label htmlFor="qr-text">{t.textLabel}</Label><Textarea id="qr-text" value={draft.text} onChange={(event) => update('text', event.target.value)} maxLength={900} rows={4} placeholder={t.textPlaceholder}/></div></TabsContent>
    <TabsContent value="wifi">
      <div className="field"><Label htmlFor="qr-ssid">{t.ssid}</Label><Input id="qr-ssid" value={draft.ssid} onChange={(event) => update('ssid', event.target.value)} maxLength={64} autoComplete="off" /></div>
      <div className="field"><Label htmlFor="qr-security">{t.security}</Label><Select value={draft.security} onValueChange={(value) => { if (value) update('security', value as QrDraft['security']); }}><SelectTrigger id="qr-security" className="security-select"><SelectValue>{draft.security === 'WPA' ? t.protected : t.open}</SelectValue></SelectTrigger><SelectContent><SelectItem value="WPA">{t.protected}</SelectItem><SelectItem value="nopass">{t.open}</SelectItem></SelectContent></Select></div>
      {draft.security !== 'nopass' && <div className="field"><Label htmlFor="qr-password">{t.password}</Label><Input id="qr-password" type="password" value={draft.password} onChange={(event) => update('password', event.target.value)} maxLength={128} autoComplete="new-password" /></div>}
      <p className="field-hint wifi-notice">{t.wifiPrivacy}</p>
    </TabsContent>
    <TabsContent value="contact"><div className="contact-fields">{(['firstName', 'lastName', 'phone', 'email', 'organization'] as const).map((key) => <div className={`field ${key === 'organization' ? 'full-width' : ''}`} key={key}><Label htmlFor={`qr-${key}`}>{t[key]}</Label><Input id={`qr-${key}`} value={draft[key]} onChange={(event) => update(key, event.target.value)} maxLength={100} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} /></div>)}</div></TabsContent>
  </Tabs>;
}
