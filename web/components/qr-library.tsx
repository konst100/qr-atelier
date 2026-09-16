'use client';
import { useState } from 'react';
import { FolderOpen, Search, Plus, Pencil, Trash2, Link2, AlignLeft, ContactRound, Pause, Play, ChartColumn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { translations, type Language } from '@/lib/translations';
import { isDynamicQr, type LibraryQr } from '@/lib/cabinet';

type Props = {
  records: LibraryQr[]; language: Language; remote?: boolean; loading: boolean; error: boolean; busy: boolean;
  onNew: () => void; onEdit: (record: LibraryQr) => void; onDelete: (id: string) => void;
  onStatus: (record: LibraryQr) => void; onStats: (record: LibraryQr) => void; onRetry: () => void;
};
export function QrLibrary({ records, language, onNew, onEdit, onDelete, onStatus, onStats, onRetry, loading, error, busy, remote = false }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('recent');
  const [deleting, setDeleting] = useState<LibraryQr | null>(null);
  const t = translations[language];
  const filtered = records.filter((record) => record.draft.name.toLocaleLowerCase(language).includes(search.toLocaleLowerCase(language)) && (status === 'all' || record.server?.status === status))
    .sort((a, b) => sort === 'name' ? a.draft.name.localeCompare(b.draft.name, language) : b.updatedAt.localeCompare(a.updatedAt));
  return <section className="library-panel" aria-busy={loading || busy}>
    <div className="library-toolbar"><div className="search-field"><Search size={18}/><Input aria-label={t.search} placeholder={t.search} value={search} onChange={(event) => setSearch(event.target.value)} /></div><Button className="primary-button" onClick={onNew}><Plus size={17}/>{t.newCode}</Button></div>
    <div className="library-filters">
      {remote && <label>{t.filterStatus}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t.allCodes}</option><option value="active">{t.statusActive}</option><option value="paused">{t.statusPaused}</option><option value="expired">{t.statusExpired}</option></select></label>}
      <label>{t.sortLabel}<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">{t.sortRecent}</option><option value="name">{t.sortName}</option></select></label>
      {remote && <Button variant="ghost" onClick={onRetry} disabled={loading || busy}>{t.refresh}</Button>}
    </div>
    {loading ? <p role="status" className="library-feedback">{t.loading}</p> : error ? <div role="alert" className="library-feedback"><p>{t.cabinetError}</p><Button onClick={onRetry}>{t.retry}</Button></div> : !filtered.length ? <Empty className="library-empty"><EmptyHeader><span className="empty-icon"><FolderOpen size={30} strokeWidth={1.3}/></span><EmptyTitle>{records.length ? t.noResults : t.emptyTitle}</EmptyTitle><EmptyDescription>{records.length ? t.noResultsHint : t.emptyText}</EmptyDescription></EmptyHeader>{!records.length && <Button variant="outline" onClick={onNew}>{t.create}</Button>}</Empty> : <div className="record-list">{filtered.map((record) => {
      const dynamic = isDynamicQr(record);
      const Icon = record.draft.kind === 'url' ? Link2 : record.draft.kind === 'text' ? AlignLeft : ContactRound;
      return <article className="record" key={record.id}>
        <div className="record-icon" style={{color: record.draft.color}}><Icon size={23}/></div>
        <div className="record-info"><h3>{record.draft.name}</h3><p>{t[record.draft.kind]}<span>·</span>{dynamic ? t.dynamicMode : t.staticMode}<span>·</span>{new Intl.DateTimeFormat(language, {dateStyle: 'medium'}).format(new Date(record.updatedAt))}</p>
          {dynamic && <div className="record-meta"><span className={'qr-status ' + record.server!.status}>{record.server!.status === 'active' ? t.statusActive : record.server!.status === 'paused' ? t.statusPaused : t.statusExpired}</span><code>/r/{record.server!.slug}</code></div>}
        </div>
        <div className="record-actions">
          {dynamic && <><Button variant="outline" disabled={busy} onClick={() => onStats(record)} aria-label={t.stats + ': ' + record.draft.name} title={t.stats}><ChartColumn size={16}/></Button>
            {record.server!.status !== 'expired' && <Button variant="outline" disabled={busy} onClick={() => onStatus(record)} aria-label={(record.server!.status === 'active' ? t.pause : t.resume) + ': ' + record.draft.name} title={record.server!.status === 'active' ? t.pause : t.resume}>{record.server!.status === 'active' ? <Pause size={16}/> : <Play size={16}/>}</Button>}</>}
          <Button variant="outline" disabled={busy} onClick={() => onEdit(record)} aria-label={t.edit + ': ' + record.draft.name}><Pencil size={16}/><span>{t.edit}</span></Button>
          <Button variant="ghost" disabled={busy} onClick={() => setDeleting(record)} aria-label={t.remove + ': ' + record.draft.name}><Trash2 size={17}/></Button>
        </div>
      </article>;
    })}</div>}
    <div className="library-footnote"><strong>{remote ? t.online : t.local}</strong><p>{remote ? t.onlineHint : t.localHint}</p></div>
    <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle><AlertDialogDescription>{deleting?.server ? t.deleteOnlineText : t.deleteText}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t.cancel}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (deleting) onDelete(deleting.id); setDeleting(null); }}>{t.remove}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
