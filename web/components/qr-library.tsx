'use client';
import { useState } from 'react';
import { FolderOpen, Search, Plus, Pencil, Trash2, Link2, AlignLeft, ContactRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { translations, type Language } from '@/lib/translations';
import type { SavedQr } from '@/lib/storage';
type Props = { records: SavedQr[]; language: Language; onNew: () => void; onEdit: (record: SavedQr) => void; onDelete: (id: string) => void };
export function QrLibrary({ records, language, onNew, onEdit, onDelete }: Props) {
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<SavedQr | null>(null);
  const t = translations[language];
  const filtered = records.filter((record) => record.draft.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="library-panel">
    <div className="library-toolbar"><div className="search-field"><Search size={18}/><Input aria-label={t.search} placeholder={t.search} value={search} onChange={(event) => setSearch(event.target.value)} /></div><Button className="primary-button" onClick={onNew}><Plus size={17}/>{t.newCode}</Button></div>
    {!filtered.length ? <Empty className="library-empty"><EmptyHeader><span className="empty-icon"><FolderOpen size={30} strokeWidth={1.3}/></span><EmptyTitle>{records.length ? t.noResults : t.emptyTitle}</EmptyTitle><EmptyDescription>{records.length ? t.noResultsHint : t.emptyText}</EmptyDescription></EmptyHeader>{!records.length && <Button variant="outline" onClick={onNew}>{t.create}</Button>}</Empty> : <div className="record-list">{filtered.map((record) => {
      const Icon = record.draft.kind === 'url' ? Link2 : record.draft.kind === 'text' ? AlignLeft : ContactRound;
      return <article className="record" key={record.id}><div className="record-icon" style={{color: record.draft.color}}><Icon size={23}/></div><div className="record-info"><h3>{record.draft.name}</h3><p>{t[record.draft.kind]}<span>·</span>{new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'de-DE', {dateStyle: 'medium'}).format(new Date(record.updatedAt))}</p></div><div className="record-actions"><Button variant="outline" onClick={() => onEdit(record)} aria-label={`${t.edit}: ${record.draft.name}`}><Pencil size={16}/><span>{t.edit}</span></Button><Button variant="ghost" onClick={() => setDeleting(record)} aria-label={`${t.remove}: ${record.draft.name}`}><Trash2 size={17}/></Button></div></article>;
    })}</div>}
    <div className="library-footnote"><strong>{t.local}</strong><p>{t.localHint}</p></div>
    <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle><AlertDialogDescription>{t.deleteText}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t.cancel}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (deleting) onDelete(deleting.id); setDeleting(null); }}>{t.remove}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
