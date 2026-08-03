# RSR Robux Shop

Responsive Robux ordering website with customer accounts, four checkout methods, receipt upload, order tracking and a protected admin portal.

## Local setup

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

## Render deployment

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Root directory: leave blank

Required environment variables:

- `NODE_ENV=production`
- `JWT_SECRET` — generate a long random secret
- `ADMIN_EMAIL` — admin login email
- `ADMIN_PASSWORD` — admin login password

Optional environment variables are documented in `.env.example`.

## Admin portal

The admin uses the same login screen. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Admin accounts receive a different dashboard with order management and shop settings.

## Important production note

This starter stores data in `data/store.json` and receipt images in `public/uploads`. Render's default filesystem is ephemeral, so data can reset after a redeploy or restart. Before accepting real customer payments, connect a persistent database and cloud image storage. Do not use this demo storage as the final production system.
