'use client';

import { useEffect, useState } from 'react';
import { LogIn, LogOut, UserRound, X } from 'lucide-react';
import { ApiError, currentAccount, loginAccount, logoutAccount, registerAccount, type ApiAccount } from '@/lib/api-client';
import { translations, type Language } from '@/lib/translations';

type Props = { language: Language; onAccountChange?: (account: ApiAccount | null) => void };

export function AccountPanel({ language, onAccountChange }: Props) {
  const t = translations[language];
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState<ApiAccount | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || account) return;
    currentAccount().then((result) => { setAccount(result.account); onAccountChange?.(result.account); }).catch(() => { /* demo assets may have no API adapter */ });
  }, [open, account, onAccountChange]);

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
      setAccount(result.account); onAccountChange?.(result.account); setPassword(''); setMessage(t.authSuccess);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await logoutAccount(); } catch { /* clearing the local view is still safe */ }
    setAccount(null); onAccountChange?.(null); setBusy(false); setMessage(t.authSignedOut);
  }

  return <>
    <button className="account-trigger" type="button" onClick={() => { setOpen(true); setMessage(''); }} aria-haspopup="dialog">
      <UserRound size={16}/><span>{account?.displayName || t.account}</span>
    </button>
    {open && <div className="account-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <button className="account-close" type="button" onClick={() => setOpen(false)} aria-label={t.close}><X size={18}/></button>
        <p className="eyebrow"><span />QR ATELIER / ACCOUNT</p>
        <h2 id="account-title">{account ? t.accountReady : t.accountTitle}</h2>
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
      </section>
    </div>}
  </>;
}
