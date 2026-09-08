export async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api${path}`, { ...init, signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json', 'X-Gateway-Request': '1', ...init?.headers } });
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Gateway returned ${response.status}`);
    }
    return response.status === 204 ? undefined as T : response.json();
}
