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


## V15.1 additions

- Prominent floating customer-to-admin support chat on every customer page.
- Dedicated **Legit & Vouches** center in the customer navigation.
- Approved-vouch wall, shop guarantees, official Facebook link, and trust statistics.
- Customer vouch submission with admin approval.
- **Gifting In-Game Support** button inside the gifting checkout.
- The gifting support chat carries game/account context to the admin.
- Admin can reply from **Customer Chats** and complete or decline orders from **Manage Orders**.

### Important Roblox limitation

The included “Gifting In-Game Support” is a website chat used while coordinating an in-game delivery. A website cannot directly read or write Roblox in-game chat without a separate Roblox Studio server script and a secure external relay. Never send Roblox passwords, cookies, or account security codes through chat.


## V15.2 fixes
- Order method cards are real clickable buttons and advance immediately to Order Details.
- Customer and admin full chat refresh every second.
- Floating customer chat also refreshes every second while open, so admin replies appear without reopening it.
- Static asset cache-busting added for deployment updates.

## V16 secure admin order workflow

Admin orders can no longer be completed directly. Each order must pass these checkpoints:

1. Roblox account verification
2. Method/gamepass or gifting game verification
3. Payment proof verification with an admin note
4. Stock and availability verification
5. Processing authorization
6. Delivery proof upload and typed `COMPLETE` confirmation

Declining an order requires a clear reason and typed `DECLINE` confirmation. Every checkpoint creates an audit-trail entry with the staff member and timestamp.
