'use client';

import { useState } from 'react';
import { LogIn, LogOut, UserRound, X } from 'lucide-react';
import { ApiError, loginAccount, logoutAccount, registerAccount, type ApiAccount } from '@/lib/api-client';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { translations, type Language } from '@/lib/translations';

type Props = { language: Language; account: ApiAccount | null; sessionReady: boolean; onAccountChange: (account: ApiAccount | null) => void };

export function AccountPanel({ language, account, sessionReady, onAccountChange }: Props) {
  const t = translations[language];
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  function errorMessage(error: unknown): string {
    if (!(error instanceof ApiError)) return t.authUnavailable;
    const known: Record<string, string> = {
      emailInvalid: t.emailInvalid,
      passwordInvalid: t.passwordInvalid,
      emailTaken: t.emailTaken,
      invalidCredentials: t.invalidCredentials,
    };
    return known[error.code] ?? t.authUnavailable;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      const result = mode === 'login'
        ? await loginAccount({ email, password })
        : await registerAccount({ email, password, displayName });
      onAccountChange(result.account); setPassword(''); setMessage(t.authSuccess);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await logoutAccount(); onAccountChange(null); setMessage(t.authSignedOut); }
    catch { setMessage(t.cabinetError); }
    finally { setBusy(false); }
  }

  return <>
    <button className="account-trigger" type="button" disabled={!sessionReady} onClick={() => { setOpen(true); setMessage(''); }} aria-haspopup="dialog">
      <UserRound size={16}/><span>{!sessionReady ? t.loading : account?.displayName || t.account}</span>
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="account-dialog" showCloseButton={false}>
        <button className="account-close" type="button" onClick={() => setOpen(false)} aria-label={t.close}><X size={18}/></button>
        <p className="eyebrow"><span />QR ATELIER / ACCOUNT</p>
        <DialogTitle>{account ? t.accountReady : t.accountTitle}</DialogTitle>
        <DialogDescription className="sr-only">{t.accountIntro}</DialogDescription>
        {account ? <div className="account-signed"><UserRound size={28}/><strong>{account.displayName || account.email}</strong><span>{account.email}</span><button type="button" className="account-secondary" onClick={signOut} disabled={busy}><LogOut size={16}/>{t.authSignOut}</button></div> : <>
          <p className="account-intro">{t.accountIntro}</p>
          <div className="account-mode" role="tablist" aria-label={t.account}><button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setMessage(''); }}>{t.authLogin}</button><button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setMessage(''); }}>{t.authRegister}</button></div>
          <form onSubmit={submit} className="account-form">
            {mode === 'register' && <label>{t.accountName}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} autoComplete="name" /></label>}
            <label>{t.accountEmail}<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
            <label>{t.accountPassword}<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={256} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
            <button type="submit" className="account-submit" disabled={busy}><LogIn size={16}/>{mode === 'login' ? t.authLogin : t.authRegister}</button>
          </form>
        </>}
        {message && <p className="account-message" role="status">{message}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
