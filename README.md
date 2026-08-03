# RSR SHOP V15

A deployable Node.js Robux storefront with customer checkout and a protected admin portal.

## V15 features

- Responsive customer and admin dashboards
- Covered Tax (`receive ÷ 0.70`) and automatic PHP calculation
- Roblox profile, gamepass, and game verification
- GCash and GoTyme QR payment flow
- Receipt upload and reference number
- Order tracking with Pending, Processing, Completed, Declined and delivery proof
- Customer/admin live chat
- Tutorial and approved-vouch wall
- Promo codes and automatic discount calculation
- Method availability, stock, minimum and maximum controls
- Maintenance mode
- Staff account creation
- Activity logs and CSV order export
- Discord new-order webhook support

## Render

- Root Directory: `rsr-robux-shop` only when this project is inside that folder; otherwise leave blank
- Build Command: `npm install`
- Start Command: `npm start`

Required variables: `NODE_ENV=production`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Optional: `SHOP_NAME`, contact variables and `DISCORD_WEBHOOK_URL`.

## Important production note

This package uses a JSON file and local uploads so it is easy to deploy and test. Render's free filesystem is temporary. Before accepting real payments, move data to PostgreSQL/MongoDB and receipts to Cloudinary/S3. Do not present sample vouches as real customer proof; publish only genuine, approved reviews.
