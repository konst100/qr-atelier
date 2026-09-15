'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Globe2, LibraryBig, QrCode as ScanQr, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QrFields } from '@/components/qr-fields';
import { QrPreview } from '@/components/qr-preview';
import { QrLibrary } from '@/components/qr-library';
import { buildPayload, initialDraft, type QrDraft } from '@/lib/qr';
import { LIBRARY_KEY, LANGUAGE_KEY, parseLibrary, savedDraft, type SavedQr } from '@/lib/storage';
import { languageOptions, translations, type Language } from '@/lib/translations';

const colors = ['#172554', '#111827', '#1d4ed8', '#6d28d9', '#047857', '#9f1239'];
type View = 'create' | 'library';

export function QrWorkspace() {
  const [language, setLanguage] = useState<Language>('ru');
  const [view, setView] = useState<View>('create');
  const [draft, setDraft] = useState<QrDraft>({ ...initialDraft });
  const [records, setRecords] = useState<SavedQr[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const t = translations[language];
  const result = buildPayload(draft);

  useEffect(() => {
    try {
      const storedLanguage = window.localStorage.getItem(LANGUAGE_KEY);
      if (storedLanguage && languageOptions.some((option) => option.code === storedLanguage)) setLanguage(storedLanguage as Language);
      setRecords(parseLibrary(window.localStorage.getItem(LIBRARY_KEY)));
    } catch {
      setMessage(translations.ru.storageReadError);
    } finally { setLoaded(true); }
  }, []);

  function update<K extends keyof QrDraft>(key: K, value: QrDraft[K]) { setDraft((prev) => ({ ...prev, [key]: value })); }
  function chooseLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 200_000) { setMessage(t.logoError); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') update('logoDataUrl', reader.result); };
    reader.readAsDataURL(file);
  }
  function changeLanguage(value: Language) {
    setLanguage(value);
    document.documentElement.lang = value;
    try { window.localStorage.setItem(LANGUAGE_KEY, value); } catch { /* preference is optional */ }
  }
  function persist(next: SavedQr[]) {
    setRecords(next);
    try { window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(next)); }
    catch { setMessage(t.storageError); }
  }
  function resetDraft() { setDraft({ ...initialDraft }); setEditingId(null); setView('create'); }
  function save() {
    if (draft.kind === 'wifi') { setMessage(t.wifiNotSaved); return; }
    if (!draft.name.trim()) { setMessage(t.nameRequired); return; }
    if (result.error) { setMessage(t[result.error]); return; }
    try {
      const record: SavedQr = { id: editingId || crypto.randomUUID(), updatedAt: new Date().toISOString(), draft: savedDraft(draft) };
      persist(editingId ? records.map((item) => item.id === editingId ? record : item) : [record, ...records]);
      setMessage(editingId ? t.updated : t.saved);
      setEditingId(record.id);
    } catch { setMessage(t.storageError); }
  }
  function edit(record: SavedQr) { setDraft({ ...record.draft }); setEditingId(record.id); setView('create'); }
  function remove(id: string) { persist(records.filter((record) => record.id !== id)); setMessage(t.removed); if (editingId === id) resetDraft(); }

  return <div className="site-shell">
    <header className="site-header">
      <button className="brand" onClick={resetDraft} aria-label="QR Atelier"><span className="brand-icon"><ScanQr size={24} /></span>QR <b>Atelier</b><span className="brand-dot">.</span></button>
      <nav className="primary-nav" aria-label={t.workspace}>
        <button className={view === 'create' ? 'active' : ''} onClick={resetDraft}><Sparkles size={16}/>{t.create}</button>
        <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}><LibraryBig size={16}/>{t.library}{records.length > 0 && <span>{records.length}</span>}</button>
      </nav>
      <span className="header-description">{t.workspace}</span>
      <label className="language-picker" aria-label={t.language}><Globe2 size={16} /><select value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>{languageOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
    </header>
    <main className="main-content">
      {view === 'library' ? <section className="library-view"><div className="library-heading"><div><p className="eyebrow"><span />QR ATELIER / LIBRARY</p><h1>{t.libraryTitle}</h1><p className="page-subtitle">{t.librarySubtitle}</p></div><Button variant="outline" onClick={resetDraft}><Sparkles size={17}/>{t.newCode}</Button></div><QrLibrary records={records} language={language} onNew={resetDraft} onEdit={edit} onDelete={remove}/></section> : <>
        <section className="page-heading"><div><p className="eyebrow"><span />{t.eyebrow}</p><h1>{t.title}<br /><span>{t.titleAccent}</span></h1><p className="page-subtitle">{t.subtitle}</p></div><div className="heading-badge"><ArrowUpRight size={26} strokeWidth={1.4} /><span>QR / 01</span></div></section>
        <div className="workbench"><div className="editor-panel">
          <section className="editor-section"><div className="section-title"><span className="step-number">01</span><div><h2>{t.content}</h2><p>{t.contentHint}</p></div><Sparkles size={20} /></div><QrFields draft={draft} language={language} update={update}/></section>
          <section className="editor-section design-section"><div className="section-title"><span className="step-number">02</span><div><h2>{t.design}</h2></div><Sparkles size={20} /></div>
            <div className="field"><label>{t.color}</label><div className="color-row">{colors.map((color) => <button key={color} type="button" style={{ background: color }} className={`color-swatch ${draft.color === color ? 'selected' : ''}`} aria-label={color} aria-pressed={draft.color === color} onClick={() => update('color', color)} />)}<label className="custom-color"><input aria-label={t.color} type="color" value={draft.color} onChange={(event) => update('color', event.target.value)} /><span>{draft.color.toUpperCase()}</span></label></div></div>
            <div className="field"><label>{t.shape}</label><div className="shape-row">{(['square', 'rounded'] as const).map((shape) => <Button key={shape} type="button" variant="outline" className={draft.shape === shape ? 'shape-button selected' : 'shape-button'} aria-pressed={draft.shape === shape} onClick={() => update('shape', shape)}><span className={`shape-sample ${shape}`}>{Array.from({length: 9}, (_, i) => <i key={i} />)}</span>{t[shape]}</Button>)}</div></div>
            <div className="field logo-field"><label htmlFor="qr-logo">{t.logo}</label><div className="logo-picker"><input id="qr-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => chooseLogo(event.target.files?.[0])} /><span>{draft.logoDataUrl ? t.logoReady : t.logoHint}</span>{draft.logoDataUrl && <Button type="button" variant="ghost" onClick={() => update('logoDataUrl', '')}>{t.logoRemove}</Button>}</div></div>
          </section>
          <section className="save-section"><div className="field"><label htmlFor="qr-name">{t.name}</label><input id="qr-name" className="save-name-input" value={draft.name} onChange={(event) => update('name', event.target.value)} maxLength={80} placeholder={t.namePlaceholder}/></div><Button className="primary-button save-button" onClick={save} disabled={!loaded || draft.kind === 'wifi'}><LibraryBig size={17}/>{editingId ? t.update : t.save}</Button>{draft.kind === 'wifi' && <p className="field-hint save-warning">{t.wifiNotSaved}</p>}</section>
          <div className="static-notice"><ShieldCheck size={21} /><div><strong>{t.static}</strong><p>{t.staticHint}</p></div></div>
        </div><QrPreview payload={result.payload} color={draft.color} shape={draft.shape} logoDataUrl={draft.logoDataUrl} name={draft.name} language={language} validation={result.error ? t[result.error] : undefined} onMessage={setMessage}/></div>
      </>}
      <footer className="workspace-footer"><ShieldCheck size={15}/><span>{t.privacy}</span><span className="footer-brand">QR Atelier</span></footer>
      {message && <div role="status" className="toast-message" onClick={() => setMessage('')}>{message}</div>}
    </main>
  </div>;
}
