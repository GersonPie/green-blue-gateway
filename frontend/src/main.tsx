import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownLeft, ArrowUpRight, Box, Check, ChevronRight, Copy, Layers3, LoaderCircle, Github, GitBranch, ArrowLeftRight, Network, Play, Plus, RefreshCw, Search, Send, Square, Terminal, X } from 'lucide-react';
import './style.css';
import './platform.css';
import { api } from './api';
import { Account, SessionGate } from './session';
import { PlatformView } from './platform';

type Service = { name: string; port: number; state: string; pid?: number; kind?: string; activeRequests?: number; draining?: boolean; routes?: string[] };
type Event = { id: number; text: string; time: string; error?: boolean };
function App() {
    const [services, setServices] = useState<Service[]>([]);
    const [connected, setConnected] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [connectionError, setConnectionError] = useState('');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [selected, setSelected] = useState<string | null>(null);
    const [modal, setModal] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState('');
    const [health, setHealth] = useState<Record<string, boolean>>({});
    const [events, setEvents] = useState<Event[]>([]);
    const [tab, setTab] = useState('services');
    const [endpoint, setEndpoint] = useState('/name');
    const [result, setResult] = useState('');
    const [copied, setCopied] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    const refreshPending = useRef(false);
    const refreshVersion = useRef(0);
    const log = (text: string, error = false) => setEvents((items) => [{ id: Date.now() + Math.random(), text, time: new Date().toLocaleTimeString(), error }, ...items].slice(0, 40));
    const refresh = useCallback(async () => {
        if (refreshPending.current) return;
        refreshPending.current = true;
        const version = refreshVersion.current;
        try {
            const data = await api<{ containers: Service[] }>('/containers');
            if (version === refreshVersion.current) setServices(data.containers);
            setConnected(true); setConnectionError('');
        } catch (error) { setConnected(false); setConnectionError((error as Error).message); }
        finally { setLoading(false); refreshPending.current = false; }
    }, []);
    useEffect(() => { void refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, [refresh]);
    useEffect(() => {
        if (modal) { dialog.current?.showModal(); dialog.current?.querySelector('input')?.focus(); }
        else dialog.current?.close();
    }, [modal]);
    useEffect(() => {
        const current = dialog.current;
        const cancel = (event: globalThis.Event) => { if (busy) event.preventDefault(); };
        current?.addEventListener('cancel', cancel);
        return () => current?.removeEventListener('cancel', cancel);
    }, [busy]);
    const service = services.find((item) => item.name === selected);
    const shown = services.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || item.state === filter));
    const running = services.filter((item) => item.state === 'running').length;
    async function start(event: React.FormEvent) {
        event.preventDefault(); setBusy('create');
        try {
            const created = await api<Service>('/containers', { method: 'POST', body: JSON.stringify({ name }) });
            refreshVersion.current++;
            setServices((items) => [...items.filter((item) => item.name !== created.name), created]);
            log(`${created.name} started on port ${created.port}`); setModal(false); setSelected(created.name); setName(''); await refresh();
        } catch (error) { setError((error as Error).message); log((error as Error).message, true); }
        finally { setBusy(''); }
    }
    async function stop(item: Service) {
        setBusy(item.name);
        try {
            await api(`/containers/${encodeURIComponent(item.name)}`, { method: 'DELETE' });
            refreshVersion.current++;
            setServices((items) => items.filter((entry) => entry.name !== item.name));
            log(`${item.name} stopped`); setSelected(null); await refresh();
        }
        catch (error) { setError((error as Error).message); log((error as Error).message, true); }
        finally { setBusy(''); }
    }
    async function check(item: Service) {
        setBusy('health');
        try { const data = await api<{ ok: boolean }>(`/containers/${item.name}/health`); setHealth((previous) => ({ ...previous, [item.name]: data.ok })); log(`${item.name}: ${data.ok ? 'healthy' : 'unhealthy'}`); }
        catch (error) { setHealth((previous) => ({ ...previous, [item.name]: false })); log(`${item.name}: ${(error as Error).message}`, true); }
        finally { setBusy(''); }
    }
    async function send() {
        if (!service) return;
        setBusy('request'); setResult('');
        const started = performance.now();
        try {
            if (!endpoint.startsWith('/') || endpoint.startsWith('//') || endpoint.split(/[/?#]/).includes('..')) throw new Error('Enter an absolute service path without traversal');
            const response = await fetch(`/api/services/${service.name}${endpoint}`, { signal: AbortSignal.timeout(12000) });
            const text = await response.text(); let body = text;
            try { body = JSON.stringify(JSON.parse(text), null, 2); } catch {}
            setResult(`${response.status} ${response.statusText}  |  ${Math.round(performance.now() - started)} ms\n\n${body}`);
            log(`GET ${service.name}${endpoint} returned ${response.status}`);
        } catch (error) { setResult((error as Error).message); }
        finally { setBusy(''); }
    }
    const titles: Record<string, string> = { services: 'Services', activity: 'Activity', projects: 'Projects', deployments: 'Deployments', routes: 'Routes' };
    const title = titles[tab];
    return <div className="shell">
        <aside className="sidebar"><a className="brand" href="/"><span className="brand-mark"><Network size={23}/></span>gateway<span className="brand-dot">.</span></a>
            <div className="workspace"><span className="workspace-icon">L</span><div>Local workspace<small>Development</small></div><span className="live-dot"/></div>
            <span className="nav-label">WORKSPACE</span>
            <nav>{[{ id: 'services', label: 'Services', Icon: Layers3 }, { id: 'projects', label: 'Projects', Icon: Github }, { id: 'deployments', label: 'Deployments', Icon: GitBranch }, { id: 'routes', label: 'Routes', Icon: ArrowLeftRight }, { id: 'activity', label: 'Activity', Icon: Activity }].map(({ id, label, Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={18}/>{label}</button>)}</nav>
            <div className="sidebar-bottom"><div><Terminal size={17}/><span>Local runtime<small>Node.js processes</small></span></div><span className="version">GATEWAY CONSOLE <span>v1.0</span></span></div>
        </aside>
        <div className="main"><header><div className="breadcrumbs">Workspace <ChevronRight size={14}/><strong>{title}</strong></div><div className="header-controls"><span className="environment"><span className="live-dot"/>Development</span><Account/></div></header>
        <main><div className="page-heading"><div className="eyebrow">LOCAL INFRASTRUCTURE</div><div className="title-row"><div><h1>{title}</h1><p>{tab === 'services' ? 'Your services, connected and in view.' : tab === 'activity' ? 'Recent operations in this session.' : tab === 'projects' ? 'Connected repositories' : tab === 'routes' ? 'Live traffic assignments' : 'Builds and releases'}</p></div>{tab === 'services' && <button className="primary" onClick={() => { setError(''); setModal(true); }} disabled={connected !== true}><Plus size={17}/>New service</button>}</div></div>
        {(error || connectionError) && <div className="alert" role="alert"><span>{error || connectionError}</span><button title="Dismiss error" onClick={() => { setError(''); setConnectionError(''); }}><X size={16}/></button></div>}
        {['services', 'activity'].includes(tab) && <section className="metrics"><div><span>Total services<Box size={17}/></span><strong>{loading ? '-' : services.length}<small>instances</small></strong></div><div><span>Running<Activity size={17}/></span><strong>{loading ? '-' : running}<small className="green">active now</small></strong></div><div><span>Gateway<Network size={17}/></span><strong className="status-metric"><i className={`live-dot ${connected === false ? 'offline' : ''}`}/>{connected === null ? 'Connecting' : connected ? 'Connected' : 'Offline'}</strong></div></section>}
        {tab === 'activity' ? <section className="activity-list"><div className="section-title"><h2>Session activity</h2><button className="text-button" onClick={() => setEvents([])} disabled={!events.length}>Clear</button></div>{events.length ? events.map((event) => <div className="event" key={event.id}><Activity size={16} className={event.error ? 'red' : 'green'}/><span>{event.text}</span><time>{event.time}</time></div>) : <div className="empty"><Activity size={30}/><h3>No activity yet</h3></div>}</section> : ['projects', 'deployments', 'routes'].includes(tab) ? <PlatformView view={tab}/> : <>
        <section className="services"><div className="section-title"><h2>Service directory <span>{services.length}</span></h2><button className="icon-button" title="Refresh services" onClick={() => void refresh()}><RefreshCw size={16}/></button></div><div className="toolbar"><div className="tabs">{['all', 'running', 'failed'].map((value) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'All services' : value === 'running' ? 'Running' : 'Failed'}</button>)}</div><label className="search"><Search size={16}/><input aria-label="Search services" placeholder="Search services..." value={query} onChange={(event) => setQuery(event.target.value)}/></label></div>
        <div className="table-wrap"><table><thead><tr><th>SERVICE NAME</th><th>STATUS</th><th>PORT</th><th>PROCESS ID</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{shown.map((item) => <tr key={item.name} className={selected === item.name ? 'chosen' : ''}><td><button className="service-name" onClick={() => { setSelected(item.name); setResult(''); }}><span className="service-icon"><Box size={19}/></span><span>{item.name}<small>{item.kind === 'docker' ? 'Docker / GitHub deployment' : 'Node.js / Default template'}</small></span></button></td><td><span className={`badge ${item.state}`}><i/>{item.state}</span></td><td><code>:{item.port || '-'}</code></td><td><code>{item.pid || '-'}</code></td><td><div className="row-actions"><button className="icon-button" title={`Inspect ${item.name}`} onClick={() => { setSelected(item.name); setResult(''); }}><ArrowUpRight size={17}/></button><button className="icon-button danger" title={`Stop ${item.name}`} disabled={!!busy || ['starting', 'stopping'].includes(item.state)} onClick={() => void stop(item)}><Square size={14}/></button></div></td></tr>)}</tbody></table></div>
        {!shown.length && <div className="empty"><div className="empty-asset"><Network size={38}/></div><h3>{loading ? 'Connecting to gateway' : query || filter !== 'all' ? 'No matching services' : 'A clear workspace'}</h3><p>{loading ? 'Waiting for service status.' : query || filter !== 'all' ? 'Try another search or status.' : 'No services are running.'}</p>{!loading && !query && filter === 'all' && <button className="secondary" disabled={!connected} onClick={() => setModal(true)}><Plus size={16}/>Create service</button>}</div>}
        <div className="table-footer"><span>{shown.length} of {services.length} services</span><span><span className={`live-dot ${connected ? '' : 'offline'}`}/>{connected ? 'Live updates' : 'Disconnected'}</span></div></section>
        <div className="lower-grid"><section><div className="section-title"><h2>Recent activity</h2><button className="text-button" onClick={() => setTab('activity')}>View all<ArrowUpRight size={14}/></button></div>{events.length ? events.slice(0, 4).map((event) => <div className="event" key={event.id}><ArrowDownLeft size={15} className={event.error ? 'red' : 'green'}/><span>{event.text}</span><time>{event.time}</time></div>) : <div className="quiet-empty"><Activity size={18}/>No operations in this session</div>}</section><section className="runtime"><div className="section-title"><h2>Runtime</h2><Terminal size={17}/></div><dl><div><dt>Environment</dt><dd>Local development</dd></div><div><dt>Process engine</dt><dd>Node.js</dd></div><div><dt>Service template</dt><dd>DefaultContainer</dd></div><div><dt>Transport</dt><dd>HTTP</dd></div></dl></section></div></>}
        <footer><span><Network size={14}/>Gateway Console</span><span>Local workspace</span></footer></main></div>
        {service && <><div className="drawer-backdrop" onClick={() => setSelected(null)}/><aside className="drawer" aria-label="Service details"><div className="section-title"><span className="eyebrow">SERVICE DETAILS</span><button className="icon-button" title="Close details" onClick={() => setSelected(null)}><X size={19}/></button></div><div className="detail-name"><span className="service-icon"><Box size={24}/></span><h2>{service.name}</h2></div><span className={`badge ${service.state}`}><i/>{service.state}</span><dl><div><dt>Port</dt><dd>{service.port}</dd></div><div><dt>Process ID</dt><dd>{service.pid || '-'}</dd></div><div><dt>Health</dt><dd>{health[service.name] === undefined ? 'Not checked' : health[service.name] ? 'Healthy' : 'Unhealthy'}</dd></div><div><dt>In-flight requests</dt><dd>{service.activeRequests || 0}</dd></div><div><dt>Routes</dt><dd>{service.routes?.join(', ') || 'None'}</dd></div></dl><button className="secondary" disabled={!!busy} onClick={() => void check(service)}><Activity size={16}/>Check health</button><div className="request-section"><h3>Request tester</h3><div className="request-input"><span>GET</span><input aria-label="Request path" value={endpoint} onChange={(event) => setEndpoint(event.target.value)}/><button title="Send request" disabled={!!busy || service.state !== 'running'} onClick={() => void send()}>{busy === 'request' ? <LoaderCircle className="spin" size={17}/> : <Send size={17}/>}</button></div>{result && <pre>{result}</pre>}<button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}/api/services/${service.name}${endpoint}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setError('Could not copy URL'); } }}>{copied ? <Check size={14}/> : <Copy size={14}/>}Copy URL</button></div><button className="secondary stop-button" disabled={!!busy} onClick={() => void stop(service)}><Square size={14}/>Stop service</button></aside></>}
        <dialog ref={dialog} onCancel={() => { if (!busy) setModal(false); }} onClose={() => setModal(false)}><form onSubmit={start}><div className="section-title"><h2>New service</h2><button type="button" className="icon-button" title="Close" disabled={!!busy} onClick={() => setModal(false)}><X size={19}/></button></div><label className="field">Service name<input autoFocus required pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}" maxLength={64} placeholder="e.g. payments-api" value={name} onChange={(event) => setName(event.target.value)}/></label><div className="template-choice"><Box size={20}/><div>DefaultContainer<small>Node.js service</small></div><Check size={16}/></div>{error && <p className="red" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary" disabled={!!busy} onClick={() => setModal(false)}>Cancel</button><button className="primary" disabled={!!busy || !name}>{busy === 'create' ? <LoaderCircle size={16} className="spin"/> : <Play size={16}/>} {busy === 'create' ? 'Starting...' : 'Start service'}</button></div></form></dialog>
    </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><SessionGate><App/></SessionGate></React.StrictMode>);
