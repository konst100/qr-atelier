'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ApiError, getQrStatistics, type QrStatistics } from '@/lib/api-client';
import type { LibraryQr } from '@/lib/cabinet';
import { translations, type Language } from '@/lib/translations';

function lastMonth() {
  const now = new Date();
  return { from: new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

export function QrStatsPanel({ record, language, onClose }: { record: LibraryQr; language: Language; onClose: () => void }) {
  const t = translations[language];
  const [range, setRange] = useState(lastMonth);
  const [input, setInput] = useState(range);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<QrStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'range' | 'request' | ''>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setData(null);
    getQrStatistics(record.id, range.from, range.to).then((response) => {
      if (!cancelled) setData(response);
    }).catch((failure) => {
      if (!cancelled) setError(failure instanceof ApiError && failure.code === 'invalidRange' ? 'range' : 'request');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [record.id, range.from, range.to, revision]);

  const mobile = data?.daily.reduce((sum, day) => sum + day.deviceMobile, 0) ?? 0;
  const desktop = data?.daily.reduce((sum, day) => sum + day.deviceDesktop, 0) ?? 0;
  const max = data?.daily.reduce((value, day) => Math.max(value, day.scans), 1) ?? 1;
  const dateLabel = (day: string) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'));
  function exportCsv() {
    if (!data) return;
    const rows = ['day_utc,opens,mobile,other_devices', ...data.daily.map((day) => [day.day, day.scans, day.deviceMobile, day.deviceDesktop].join(','))];
    const url = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'qr-statistics-' + data.from + '-' + data.to + '.csv';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="stats-dialog" showCloseButton={false}>
      <button className="account-close" onClick={onClose} aria-label={t.close}><X size={18}/></button>
      <DialogTitle>{t.stats} · {record.draft.name}</DialogTitle>
      <DialogDescription>{t.statsHint}</DialogDescription>
      <form className="stats-range" onSubmit={(event) => {
        event.preventDefault();
        if (!input.from || !input.to || input.from > input.to) { setError('range'); return; }
        setRange(input); setRevision((value) => value + 1);
      }}>
        <label>{t.statsFrom}<input type="date" required value={input.from} onChange={(event) => setInput((prev) => ({ ...prev, from: event.target.value }))}/></label>
        <label>{t.statsTo}<input type="date" required value={input.to} onChange={(event) => setInput((prev) => ({ ...prev, to: event.target.value }))}/></label>
        <Button type="submit" disabled={loading}>{t.statsApply}</Button>
        <Button type="button" variant="ghost" disabled={loading} onClick={() => { const next = lastMonth(); setInput(next); setRange(next); setRevision((value) => value + 1); }}>{t.statsLast30}</Button>
      </form>
      {error && <div role="alert" className="stats-error">{error === 'range' ? t.statsRangeError : t.cabinetError}{error === 'request' && <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>{t.retry}</Button>}</div>}
      {loading ? <p role="status">{t.loading}</p> : data && <>
        <p className="stats-period">{dateLabel(data.from)} — {dateLabel(data.to)} · UTC</p>
        <dl className="stats-totals"><div><dt>{t.statsTotal}</dt><dd>{data.total.toLocaleString(language)}</dd></div><div><dt>{t.statsMobile}</dt><dd>{mobile.toLocaleString(language)}</dd></div><div><dt>{t.statsDesktop}</dt><dd>{desktop.toLocaleString(language)}</dd></div></dl>
        {!data.daily.length ? <p className="stats-empty">{t.statsEmpty}</p> : <div className="stats-table-wrap"><table className="stats-table"><caption className="sr-only">{t.statsTotal} · UTC</caption><thead><tr><th scope="col">{t.statsDay}</th><th scope="col">{t.statsTotal}</th><th scope="col">{t.statsMobile}</th><th scope="col">{t.statsDesktop}</th></tr></thead><tbody>{data.daily.map((day) => <tr key={day.day}><th scope="row">{dateLabel(day.day)}</th><td><div className="stats-bar-cell"><span>{day.scans.toLocaleString(language)}</span><i aria-hidden="true" style={{ width: (day.scans / max * 100) + '%' }}/></div></td><td>{day.deviceMobile.toLocaleString(language)}</td><td>{day.deviceDesktop.toLocaleString(language)}</td></tr>)}</tbody></table></div>}
        <div className="stats-actions"><Button variant="outline" onClick={() => setRevision((value) => value + 1)}>{t.refresh}</Button><Button variant="outline" onClick={exportCsv}>{t.statsExport}</Button></div>
      </>}
    </DialogContent>
  </Dialog>;
}
