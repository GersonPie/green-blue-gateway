import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, request }) => {
    const credentials = { email: process.env.TEST_EMAIL || 'operator@example.test', password: process.env.TEST_PASSWORD || 'gateway-test-password-only' };
    expect((await request.post('/api/auth/login', { data: credentials })).status()).toBe(200);
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill(credentials.email);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Services', exact: true })).toBeVisible();
});

test('service lifecycle and desktop layout', async ({ page, request }) => {
    const name = `ui-test-${Date.now()}`;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    try {
        await page.goto('/');
        await expect(page.getByText('Connected', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'New service', exact: true }).click();
        await page.getByLabel('Service name').fill(name);
        await page.getByRole('button', { name: 'Start service', exact: true }).click();
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: 'Check health', exact: true }).click();
        await expect(page.getByText('Healthy', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Send request', exact: true }).click();
        await expect(page.locator('pre')).toContainText(name);
        await expect(page.locator('pre')).toContainText('200');
        await page.screenshot({ path: 'test-results/desktop-details.png', fullPage: true });
        await page.getByRole('button', { name: 'Close details' }).click();
        await page.getByLabel('Search services').fill(name);
        await expect(page.getByRole('button', { name: `Inspect ${name}` })).toBeVisible();
        await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
        await page.getByRole('button', { name: `Stop ${name}`, exact: true }).click();
        await expect(page.getByRole('button', { name: `Inspect ${name}` })).toHaveCount(0);
        expect(errors).toEqual([]);
    } finally {
        await request.delete(`/api/containers/${name}`);
    }
});

test('mobile layout and keyboard dialog dismissal', async ({ page, request }) => {
    const name = `mobile-test-${Date.now()}`;
    const created = await request.post('/api/containers', { data: { name } });
    expect(created.status()).toBe(201);
    try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New service', exact: true }).click();
    await expect(page.getByLabel('Service name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
    await page.getByRole('button', { name: `Inspect ${name}` }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/mobile-details.png', fullPage: true });
    } finally { await request.delete(`/api/containers/${name}`); }
});

test('gateway unavailable state', async ({ page }) => {
    await page.route('**/api/containers', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Gateway unavailable' }) }));
    await page.goto('/');
    await expect(page.getByText('Offline', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Gateway unavailable');
    await expect(page.getByRole('button', { name: 'New service', exact: true })).toBeDisabled();
});

test('theme persists and routes can switch between live instances', async ({ page, request }) => {
    const suffix = Date.now();
    const blue = `blue-${suffix}`; const green = `green-${suffix}`;
    let route;
    try {
        for (const name of [blue, green]) expect((await request.post('/api/containers', { data: { name } })).status()).toBe(201);
        await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.getByRole('button', { name: 'Routes', exact: true }).click();
        await page.getByRole('button', { name: 'New route', exact: true }).click();
        await page.getByLabel('Endpoint prefix').fill(`/payments-${suffix}`);
        await page.getByLabel('Target instance').selectOption(blue);
        await page.getByRole('button', { name: 'Create route', exact: true }).click();
        await expect(page.locator('dialog')).not.toBeVisible();
        route = (await (await request.get('/api/routes')).json()).routes.find((item) => item.path === `/payments-${suffix}`);
        expect((await (await request.get(`/traffic${route.path}/name`)).json()).name).toBe(blue);
        await page.getByRole('button', { name: `Switch ${route.path}`, exact: true }).click();
        await page.getByLabel('New instance').selectOption(green);
        await page.getByRole('button', { name: 'Switch traffic', exact: true }).click();
        await expect(page.locator('dialog')).not.toBeVisible();
        expect((await (await request.get(`/traffic${route.path}/name`)).json()).name).toBe(green);
        await page.screenshot({ path: 'test-results/routes-dark.png', fullPage: true });
        await page.getByRole('button', { name: `Rollback ${route.path}`, exact: true }).click();
        await expect.poll(async () => (await (await request.get(`/traffic${route.path}/name`)).json()).name).toBe(blue);
        await page.getByRole('button', { name: 'Light theme', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await page.screenshot({ path: 'test-results/routes-light.png', fullPage: true });
    } finally {
        if (route) {
            const latest = (await (await request.get('/api/routes')).json()).routes.find((item) => item.id === route.id);
            if (latest) await request.delete(`/api/routes/${route.id}`, { data: { expectedVersion: latest.version } });
        }
        for (const name of [blue, green]) await request.delete(`/api/containers/${name}`);
    }
});
