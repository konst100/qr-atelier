'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Globe2, LibraryBig, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QrFields } from '@/components/qr-fields';
import { QrPreview } from '@/components/qr-preview';
import { QrLibrary } from '@/components/qr-library';
import { AccountPanel } from '@/components/account-panel';
import { QrStatsPanel } from '@/components/qr-stats-panel';
import { ApiError, currentAccount, archiveRemoteQrCode, createRemoteQrCode, listRemoteQrCodes, updateRemoteQrCode, type ApiAccount } from '@/lib/api-client';
import { hydrateRemoteQr, type LibraryQr } from '@/lib/cabinet';
import { buildPayload, initialDraft, type QrDraft } from '@/lib/qr';
import { LIBRARY_KEY, LANGUAGE_KEY, parseLibrary, savedDraft, type SavedQr } from '@/lib/storage';
import { languageOptions, translations, type Language } from '@/lib/translations';

const colors = ['#172554', '#111827', '#1d4ed8', '#6d28d9', '#047857', '#9f1239'];
const newSlug = () => `qr-${crypto.randomUUID().slice(0, 12)}`;
type View = 'create' | 'library';

export function QrWorkspace() {
  const [language, setLanguage] = useState<Language>('ru');
  const [view, setView] = useState<View>('create');
  const [draft, setDraft] = useState<QrDraft>({ ...initialDraft });
  const [localRecords, setLocalRecords] = useState<SavedQr[]>([]);
  const [remoteRecords, setRemoteRecords] = useState<LibraryQr[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [account, setAccount] = useState<ApiAccount | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState(false);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statsRecord, setStatsRecord] = useState<LibraryQr | null>(null);
  const scope = useRef<string | null>(null);
  scope.current = account?.id ?? null;
  const records: LibraryQr[] = account ? remoteRecords : localRecords;
  const editingRecord = records.find((record) => record.id === editingId);
  const dynamic = draft.kind === 'url' && draft.mode === 'dynamic';
  const dynamicUnsaved = dynamic && (!account || !editingRecord?.server || editingRecord.server.slug !== draft.slug.trim().toLowerCase());
  const t = translations[language];
  const result = buildPayload(draft);

  useEffect(() => {
    try {
      const storedLanguage = window.localStorage.getItem(LANGUAGE_KEY);
      if (storedLanguage && languageOptions.some((option) => option.code === storedLanguage)) setLanguage(storedLanguage as Language);
      setLocalRecords(parseLibrary(window.localStorage.getItem(LIBRARY_KEY)));
    } catch {
      setMessage(translations.ru.storageReadError);
    } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    currentAccount().then((response) => { if (!cancelled) setAccount(response.account); })
      .catch(() => { /* A static demo remains usable without the account API. */ })
      .finally(() => { if (!cancelled) setSessionReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!account) { setRemoteRecords([]); setLibraryLoading(false); setLibraryError(false); return; }
    let cancelled = false;
    setRemoteRecords([]); setLibraryLoading(true); setLibraryError(false);
    listRemoteQrCodes().then((response) => {
      if (!cancelled) setRemoteRecords(response.qrCodes.map(hydrateRemoteQr));
    }).catch(() => { if (!cancelled) setLibraryError(true); })
      .finally(() => { if (!cancelled) setLibraryLoading(false); });
    return () => { cancelled = true; };
  }, [account?.id, libraryRevision]);

  function changeAccount(next: ApiAccount | null) {
    scope.current = next?.id ?? null;
    setAccount(next); setRemoteRecords([]); setEditingId(null); setStatsRecord(null);
    setDraft({ ...initialDraft }); setBusy(false); setMessage('');
  }

  function update<K extends keyof QrDraft>(key: K, value: QrDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value,
      ...(key === 'kind' && value !== 'url' ? { mode: 'static' as const } : {}),
      ...(key === 'mode' && value === 'dynamic' && !editingId ? { slug: newSlug() } : {}),
    }));
  }
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
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
    setLocalRecords(next);
  }
  function resetDraft() { if (busy) return; setDraft({ ...initialDraft }); setEditingId(null); setView('create'); }
  function cabinetError(error: unknown) {
    if (error instanceof ApiError && error.code === 'slugTaken') return t.slugTaken;
    if (error instanceof ApiError && error.code === 'requestTooLarge') return t.logoError;
    if (error instanceof ApiError && error.status === 401) return t.sessionExpired;
    return t.cabinetError;
  }
  async function save() {
    if (busy || !sessionReady || libraryLoading) return;
    if (draft.kind === 'wifi') { setMessage(t.wifiNotSaved); return; }
    if (!draft.name.trim()) { setMessage(t.nameRequired); return; }
    if (result.error) { setMessage(t[result.error]); return; }
    if (dynamic && !account) { setMessage(t.dynamicSignIn); return; }
    const owner = scope.current;
    setBusy(true);
    try {
      const cleanDraft = savedDraft(draft);
      if (account) {
        const id = editingRecord?.server ? editingRecord.id : null;
        const slug = editingRecord?.server?.slug ?? (dynamic ? cleanDraft.slug : newSlug());
        const remoteValue = { ...cleanDraft, slug };
        const response = id
          ? await updateRemoteQrCode(id, { name: remoteValue.name, ...(draft.kind === 'url' ? { destinationUrl: remoteValue.url } : {}), designJson: JSON.stringify(remoteValue) })
          : await createRemoteQrCode({ slug, kind: remoteValue.kind, name: remoteValue.name, ...(draft.kind === 'url' ? { destinationUrl: remoteValue.url } : {}), designJson: JSON.stringify(remoteValue) });
        if (scope.current !== owner) return;
        const saved = hydrateRemoteQr(response.qrCode);
        setRemoteRecords((prev) => [saved, ...prev.filter((record) => record.id !== saved.id)]);
        setDraft(saved.draft);
        setMessage(id ? t.updated : t.saved);
        setEditingId(saved.id);
        return;
      }
      const record: SavedQr = { id: editingId || crypto.randomUUID(), updatedAt: new Date().toISOString(), draft: cleanDraft };
      persist(editingId ? localRecords.map((item) => item.id === editingId ? record : item) : [record, ...localRecords]);
      setMessage(editingId ? t.updated : t.saved);
      setEditingId(record.id);
    } catch (error) { if (scope.current === owner) setMessage(account ? cabinetError(error) : t.storageError); }
    finally { if (scope.current === owner) setBusy(false); }
  }
  function edit(record: SavedQr) { setDraft({ ...record.draft }); setEditingId(record.id); setView('create'); }
  async function remove(id: string) {
    if (busy) return;
    const owner = scope.current; setBusy(true);
    try {
      if (account) {
        await archiveRemoteQrCode(id);
        if (scope.current !== owner) return;
        setRemoteRecords((prev) => prev.filter((record) => record.id !== id));
      } else persist(localRecords.filter((record) => record.id !== id));
      setMessage(t.removed);
      if (editingId === id) { setEditingId(null); setDraft({ ...initialDraft }); }
    } catch (error) { if (scope.current === owner) setMessage(account ? cabinetError(error) : t.storageError); }
    finally { if (scope.current === owner) setBusy(false); }
  }
  async function changeStatus(record: LibraryQr) {
    if (busy || !account || !record.server) return;
    const owner = scope.current; setBusy(true);
    try {
      const response = await updateRemoteQrCode(record.id, { status: record.server.status === 'active' ? 'paused' : 'active' });
      if (scope.current !== owner) return;
      const next = hydrateRemoteQr(response.qrCode);
      setRemoteRecords((prev) => prev.map((item) => item.id === record.id ? next : item));
      setMessage(t.updated);
    } catch (error) { if (scope.current === owner) setMessage(cabinetError(error)); }
    finally { if (scope.current === owner) setBusy(false); }
  }

  return <div className="site-shell">
    <header className="site-header">
      <button className="brand" onClick={resetDraft} aria-label="QR Atelier"><img className="brand-icon" src="/brand-mark.svg" alt="" width="39" height="39" />QR <b>Atelier</b><span className="brand-dot">.</span></button>
      <nav className="primary-nav" aria-label={t.workspace}>
        <button className={view === 'create' ? 'active' : ''} onClick={resetDraft}><Sparkles size={16}/>{t.create}</button>
        <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}><LibraryBig size={16}/>{t.library}{records.length > 0 && <span>{records.length}</span>}</button>
      </nav>
      <span className="header-description">{t.workspace}</span>
      <AccountPanel language={language} account={account} sessionReady={sessionReady} onAccountChange={changeAccount} />
      <label className="language-picker" aria-label={t.language}><Globe2 size={16} /><select value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>{languageOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
    </header>
    <main className="main-content">
      {view === 'library' ? <section className="library-view"><div className="library-heading"><div><p className="eyebrow"><span />QR ATELIER / LIBRARY</p><h1>{t.libraryTitle}</h1><p className="page-subtitle">{t.librarySubtitle}</p></div><Button variant="outline" onClick={resetDraft}><Sparkles size={17}/>{t.newCode}</Button></div><QrLibrary key={account?.id ?? 'local'} records={records} language={language} remote={!!account} loading={!sessionReady || libraryLoading} error={libraryError} busy={busy} onRetry={() => setLibraryRevision((value) => value + 1)} onNew={resetDraft} onEdit={edit} onDelete={remove} onStatus={changeStatus} onStats={setStatsRecord}/></section> : <>
        <section className="page-heading"><div><p className="eyebrow"><span />{t.eyebrow}</p><h1>{t.title}<br /><span>{t.titleAccent}</span></h1><p className="page-subtitle">{t.subtitle}</p></div><div className="heading-badge"><ArrowUpRight size={26} strokeWidth={1.4} /><span>QR / 01</span></div></section>
        <div className="workbench"><fieldset className="editor-panel" disabled={busy}>
          <section className="editor-section"><div className="section-title"><span className="step-number">01</span><div><h2>{t.content}</h2><p>{t.contentHint}</p></div><Sparkles size={20} /></div><QrFields draft={draft} language={language} update={update} locked={!!editingRecord?.server}/></section>
          <section className="editor-section design-section"><div className="section-title"><span className="step-number">02</span><div><h2>{t.design}</h2></div><Sparkles size={20} /></div>
            <div className="field"><label>{t.color}</label><div className="color-row">{colors.map((color) => <button key={color} type="button" style={{ background: color }} className={`color-swatch ${draft.color === color ? 'selected' : ''}`} aria-label={color} aria-pressed={draft.color === color} onClick={() => update('color', color)} />)}<label className="custom-color"><input aria-label={t.color} type="color" value={draft.color} onChange={(event) => update('color', event.target.value)} /><span>{draft.color.toUpperCase()}</span></label></div></div>
            <div className="field"><label>{t.shape}</label><div className="shape-row">{(['square', 'rounded'] as const).map((shape) => <Button key={shape} type="button" variant="outline" className={draft.shape === shape ? 'shape-button selected' : 'shape-button'} aria-pressed={draft.shape === shape} onClick={() => update('shape', shape)}><span className={`shape-sample ${shape}`}>{Array.from({length: 9}, (_, i) => <i key={i} />)}</span>{t[shape]}</Button>)}</div></div>
            <div className="field logo-field"><label htmlFor="qr-logo">{t.logo}</label><div className="logo-picker"><input id="qr-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => chooseLogo(event.target.files?.[0])} /><span>{draft.logoDataUrl ? t.logoReady : t.logoHint}</span>{draft.logoDataUrl && <Button type="button" variant="ghost" onClick={() => update('logoDataUrl', '')}>{t.logoRemove}</Button>}</div></div>
          </section>
          <section className="save-section"><div className="field"><label htmlFor="qr-name">{t.name}</label><input id="qr-name" className="save-name-input" value={draft.name} onChange={(event) => update('name', event.target.value)} maxLength={80} placeholder={t.namePlaceholder}/></div><Button className="primary-button save-button" onClick={save} disabled={!loaded || !sessionReady || libraryLoading || busy || draft.kind === 'wifi'}><LibraryBig size={17}/>{busy ? t.saving : editingId ? t.update : t.save}</Button>{draft.kind === 'wifi' && <p className="field-hint save-warning">{t.wifiNotSaved}</p>}{dynamicUnsaved && <p className="field-hint save-warning">{account ? t.dynamicSaveFirst : t.dynamicSignIn}</p>}{editingRecord?.server?.status === 'paused' && <p className="field-hint save-warning">{t.pausedHint}</p>}</section>
          <div className="static-notice"><ShieldCheck size={21} /><div><strong>{draft.mode === 'dynamic' ? t.dynamicMode : t.static}</strong><p>{draft.mode === 'dynamic' ? t.dynamicModeHint : t.staticHint}</p></div></div>
        </fieldset><QrPreview payload={result.payload} color={draft.color} shape={draft.shape} logoDataUrl={draft.logoDataUrl} name={draft.name} language={language} validation={result.error ? t[result.error] : undefined} downloadBlocked={dynamicUnsaved || !sessionReady} onMessage={setMessage}/></div>
      </>}
      <footer className="workspace-footer"><ShieldCheck size={15}/><span>{account ? t.onlinePrivacy : t.privacy}</span><span className="footer-brand">QR Atelier</span></footer>
      {message && <div role="status" className="toast-message" onClick={() => setMessage('')}>{message}</div>}
    </main>
    {statsRecord && account && <QrStatsPanel key={`${account.id}/${statsRecord.id}`} record={statsRecord} language={language} onClose={() => setStatsRecord(null)}/>}
  </div>;
}
