import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, LoaderCircle, LogOut, Moon, Network, RefreshCw, Sun } from 'lucide-react';
import { api } from './api';

type User = { id: string; name: string; email: string };
const Session = createContext<{ user: User; logout: () => Promise<void> } | null>(null);
export function ThemeSwitch() {
    const [theme, setTheme] = useState(() => {
        try { return localStorage.getItem('gateway-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
        catch { return 'light'; }
    });
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        try { localStorage.setItem('gateway-theme', theme); } catch {}
    }, [theme]);
    return <div className="theme-switch" aria-label="Color theme"><button title="Light theme" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={16}/></button><button title="Dark theme" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={16}/></button></div>;
}
export function Account() {
    const session = useContext(Session);
    const [error, setError] = useState('');
    return <div className="account"><ThemeSwitch/>{session && <button title="Sign out" className="icon-button" onClick={() => void session.logout().catch((error) => setError(error.message))}><LogOut size={16}/></button>}{error && <span role="alert">{error}</span>}</div>;
}
export function SessionGate({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [status, setStatus] = useState<{ available: boolean; setupRequired: boolean } | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    async function load() {
        setLoading(true); setError('');
        try {
            const data = await api<{ available: boolean; setupRequired: boolean }>('/auth/status');
            setStatus(data);
            if (data.available) setUser((await api<{ user: User | null }>('/auth/me')).user);
        } catch (error) { setError((error as Error).message); }
        finally { setLoading(false); }
    }
    useEffect(() => {
        void load();
        const expired = () => { setUser(null); setPassword(''); setError('Your session expired. Please sign in again.'); };
        window.addEventListener('session-expired', expired);
        return () => window.removeEventListener('session-expired', expired);
    }, []);
    async function submit(event: FormEvent) {
        event.preventDefault(); setBusy(true); setError('');
        try { setUser((await api<{ user: User }>(status?.setupRequired ? '/auth/setup' : '/auth/login', { method: 'POST', body: JSON.stringify({ email, name, password }) })).user); setPassword(''); }
        catch (error) { setError((error as Error).message); }
        finally { setBusy(false); }
    }
    if (user) return <Session.Provider value={{ user, logout: async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); setPassword(''); await load(); } }}>{children}</Session.Provider>;
    return <div className="login-page"><div className="login-top"><a className="brand" href="/"><Network size={25}/>gateway.</a><ThemeSwitch/></div><main className="login-main"><div className="login-mark"><Network size={36}/></div><span className="eyebrow">GATEWAY CONSOLE</span><h1>{status?.setupRequired ? 'Create your account' : 'Welcome back'}</h1>{loading ? <div className="login-wait"><LoaderCircle className="spin" size={22}/></div> : !status?.available ? <div className="login-unavailable"><p>Authentication database unavailable</p>{error && <p role="alert">{error}</p>}<button className="secondary" onClick={() => void load()}><RefreshCw size={16}/>Retry connection</button></div> : <form onSubmit={submit}>{status.setupRequired && <label className="field">Name<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)}/></label>}<label className="field">Email<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)}/></label><label className="field">Password<input required type="password" minLength={status.setupRequired ? 12 : undefined} maxLength={128} autoComplete={status.setupRequired ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)}/></label>{error && <p role="alert" className="red">{error}</p>}<button className="primary login-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <ArrowRight size={16}/>} {status.setupRequired ? 'Create account' : 'Sign in'}</button></form>}</main><div className="login-footer">Local workspace</div></div>;
}
