# API Gateway

React, Vite and TypeScript console with local Node services, GitHub-backed Docker deployments, stable HTTP routes, login, and light/dark themes.

## Setup

Use Node.js 24 LTS, npm, and MySQL on `localhost:3306`. Run `npm ci` in both `gateway` and `frontend`. Configure `gateway/.env` using `.env.example` without overwriting existing secrets.

Set `DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/gateway_auth` with URL-encoded credentials. Run `npm run db:setup` inside `gateway`. This uses mysql2 to create the database and Prisma migrations for authentication tables. The database user needs creation and migration privileges. Runtime authentication uses Prisma's MySQL-compatible MariaDB adapter; mysql2 handles provisioning.

Set a long random `MANAGEMENT_TOKEN` for machine access. Run `npm run dev` inside `frontend`; it builds/starts the backend and prints the console URL. Use `npm.cmd` on PowerShell if script execution is restricted. The launcher reuses an existing gateway only with matching credentials; otherwise it starts a separate gateway on a free port.

Open the console locally to create the first administrator. Passwords require 12 characters and are salted with scrypt. HttpOnly, SameSite sessions are stored as hashed tokens in MySQL. Missing database configuration does not bypass login. Initialize the administrator before exposing a reverse proxy. Use HTTPS and `AUTH_COOKIE_SECURE=true` for remote hosting.

For separate backend operation, run `npm run build` then `npm start` inside `gateway`. Build the frontend with `npm run build` in `frontend`. Production hosting needs a same-origin `/api` proxy preserving cookies and the original host. Never embed management credentials in browser code. The development proxy no longer injects a management token.

## GitHub Deployments

Install Docker with Linux-container support. Create a GitHub App with repository Contents read permission and install it on the desired repositories, including private repositories. Configure `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and `GITHUB_PRIVATE_KEY_PATH`. Keep the private key server-side outside the repository. Configure a JSON push webhook at `/webhooks/github` with `GITHUB_WEBHOOK_SECRET`.

Create a project with its repository, branch, context, Dockerfile, container port, health path, and environment. Private repositories use short-lived installation tokens. Builds pin immutable commit SHAs. Credentials stay outside clone URLs, command arguments, and build contexts. Environment snapshots are encrypted at rest. Copies exclude `.git`, `node_modules`, `.env` files and logs.

Images must support UID/GID 1000, a read-only filesystem with writable `/tmp`, and listening on `0.0.0.0` at the configured port. Containers have restricted capabilities and resource limits. Repositories and Dockerfiles must still be trusted: builds execute on the Docker host, and Docker access is privileged.

Deployments queue serially and require passing readiness checks. Signed push deliveries are deduplicated. Auto-deploy and auto-promote are optional. Owned Docker containers are reconciled on gateway startup. Local template services are child processes, not isolated containers, and stop with the gateway.

## Traffic Routing

Create a route with a hostname (or `*`), non-root path prefix, and ready instance. Longest segment-prefix matching selects a route. Prefix stripping is optional. Public traffic uses the gateway host/port; `/traffic` is a console development proxy only. Custom-host routes require matching DNS and Host headers.

Promotion checks readiness and route versions, persists the change, then atomically swaps the in-process routing table. New requests select the new instance while in-flight requests retain their upstream. Previous targets remain available for rollback. Stopping requires removing route references and draining active requests. Multi-route auto-promotion is transactional.

This supports uninterrupted HTTP target switching within one healthy gateway process, not high availability against gateway or host failure. HAProxy, multi-host coordination, TLS provisioning, and WebSockets are not implemented. Upstream inactivity timeout is 120 seconds. Application sessions and database migrations must remain compatible across versions.

## API and Storage

Management endpoints accept a bearer management token or authenticated session. Cookie mutations require `X-Gateway-Request: 1` and same-origin checks. Health, signed webhooks, authentication endpoints, and public routes have separate access rules. Gateway session cookies and the management bearer are removed before forwarding.

Primary endpoints: `/containers`, `/services/:name`, `/projects`, `/projects/:id/deployments`, `/deployments`, `/routes`, `/routes/:id/promote`, `/routes/:id/rollback`, `/routes/:id/history`, `/github/repositories`, and `/platform/status`. Route mutations require `expectedVersion` where applicable to reject stale updates. Management prefixes are reserved.

Projects, deployments, routes, and history persist in SQLite under `GATEWAY_DATA_DIR` (default `gateway/data`). Back up the database and `secrets.key` together; losing the key makes encrypted environments unrecoverable. MySQL stores users and sessions separately. One gateway owns each platform data directory. The console launcher uses `data/console` when starting alongside another gateway.

## Verification

Run `npm test` in `gateway` for authentication, lifecycle, routing continuity, rollback, persistence, webhook, and mocked GitHub/Docker contract tests. Run `npm run test:e2e` in `frontend` for isolated browser tests using locally installed Microsoft Edge. Browser fixtures use test-only in-memory authentication, not production MySQL. Screenshots appear in `frontend/test-results`. Real Docker builds, private GitHub access, and MySQL migrations require external services and credentials.
