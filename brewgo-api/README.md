# Brew Go API

REST API for the **Brew Go** coffee-ordering prototype (Figma). Built for the ITE101 PWA final project
(`/api/v1`, success/error envelopes, idempotent checkout, truthful payment status, grounded AI, 503 fallback)
using only the Express.js / REST / design-pattern material from the ITPE101 lectures.

## Run it

```bash
npm install
cp .env.example .env     # then fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (see "Database: Supabase" below)
npm start                # http://localhost:3000   (npm run dev = auto-restart with nodemon)
npm test                 # 189 checks, no internet needed: the API, the Maya integration and the database layer (fake Maya + fake Supabase servers)
```

Demo logins (seeded): customer `maya.santos@email.com` / `Password123`, staff `admin@brewgo.ph` / `Admin123!`.
Maya starts with 120 pts, Gold tier, a live order `BG-8921`, 4 favorites and 2 saved payment methods, matching the Figma screens.

Settings are environment variables (see `.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required), `PORT`, `PUBLIC_API_URL`, `FRONTEND_URL`, `CORS_ORIGINS`, `WEBHOOK_SECRET`, `AI_ENABLED`.
Put your deployed React URL in `CORS_ORIGINS` and `FRONTEND_URL`, otherwise the browser blocks requests and the payment redirect goes to localhost.

Full endpoint list: **docs/API.md**. Postman: import `postman/brewgo-api.postman_collection.json`, then run the folders in order.

## Database: Supabase (the only database)

All data lives in your Supabase project. The server keeps **no copy** in memory: every request reads and writes Supabase directly, so a restart, a crash or a redeploy never loses anything.

1. In Supabase open **SQL Editor**, paste `supabase/schema.sql` and press **Run**. It creates the tables (`brewgo_records`, `brewgo_counters`), turns Row Level Security on, and installs three small helper functions. It is safe to run again, and it also upgrades a project created with the older version of this API (it carries the id counters over).
2. In Supabase open **Project Settings > API** and copy the **Project URL** and the **service_role** key (not the `anon` key).
3. Put them in `.env` (local) and in Render's **Environment** tab (deployed):
   ```
   SUPABASE_URL=https://xxxxxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```
4. Start the API. On the very first start (empty database) the demo data is added. `GET /api/v1/health` shows `"database": {"database": "supabase", "reachable": true}` and answers `503` if Supabase is down.

If the two settings are missing, the schema is not installed, or Supabase cannot be reached, the API refuses to start and tells you what to fix.

How it works (controllers > services > repositories > `db/supabase.js`):
- `db/supabase.js` is the only file that talks to Supabase. Repositories (`repositories/`) are async and ask it for records; nothing is cached.
- Each record is a JSON row in `brewgo_records(collection, id, data)`. You can browse and edit rows in the Supabase Table Editor (filter by `collection`).
- Things that must never be done twice or overwritten are done **inside Postgres in one step**: handing out ids and order numbers, taking stock (it refuses to go below 0, so two customers can't both get the last croissant), adding/removing points, and changing only some fields of a record.
- Requests that change the same thing at the same moment (one customer's cart/checkout, one order's payment) are put in line by a tiny in-process lock (`utils/mutex.js`). It holds no data. That is why a double-tapped checkout makes one order, and why the webhook and the return page can't award points twice.
- If Supabase fails while a request is running, the customer gets `503 DATABASE_UNAVAILABLE` and the next request simply works once Supabase is back.

Good to know: run **one** API instance (the lock is per process). The demo data is added only when the table is completely empty; to re-seed it, run `truncate public.brewgo_records; truncate public.brewgo_counters;` and restart. Never commit or expose the service_role key. The rate limiter (429) still counts in memory; that is only a short-lived counter, not data.

## Where each lecture topic is used

| Lecture topic | Where |
|---|---|
| Routes, controllers, models (ch. 11) | `routes/`, `controllers/`, `repositories/` + Supabase (`db/supabase.js`) |
| Layered design: Controller > Service > Repository | `services/`, `repositories/` |
| CRUD + status codes 200/201/204/400/404/409/422/429/503 | `controllers/`, `middleware/errorHandler.js` |
| Request validation middleware | `middleware/validate.js`, `middleware/validators.js` |
| Auth: bearer token, 401 vs 403, protecting credentials | `middleware/auth.js`, `utils/password.js` |
| Pagination, filtering, sorting, rate limiting (429) | `utils/helpers.js`, `services/productService.js`, `middleware/rateLimit.js` |
| **Builder**: response envelope | `utils/ApiResponseBuilder.js` |
| **Facade**: checkout, home screen, profile | `services/checkoutFacade.js`, `homeFacade.js`, `userService.getProfile` |
| **Adapter**: payment gateway, AI provider | `services/paymentService.js`, `services/aiService.js` |
| **Bridge**: payment method x provider | `services/paymentService.js` |
| **Strategy**: delivery fee, coupon discount | `services/pricingService.js` |
| **State**: order lifecycle | `services/orderService.js` |
| **Prototype**: product option templates | `services/optionTemplates.js` |
| **Decorator**: request logging | `utils/decorators.js` |
| **Singleton**: one shared database client and one instance of each repository (Node caches the module) | `db/supabase.js`, `repositories/index.js` |
| Inheritance / abstract base class | `repositories/BaseRepository.js`, `utils/errors.js`, strategy + state classes |

## Payments with Maya (real sandbox)

`PAYMENT_PROVIDER=maya` (in `.env`) makes checkout call Maya's **Checkout API**:

1. `POST /checkout` creates the order, then asks Maya for a checkout session (`POST /checkout/v1/checkouts`, public key). The response contains `data.payment.checkoutUrl`, Maya's hosted payment page.
2. The React app sends the customer there (`window.location.href = checkoutUrl`). They pay with a Maya wallet or card.
3. Maya redirects back to `FRONTEND_URL/payment/success?orderId=...` (or `/payment/cancelled`). That page calls `POST /orders/:id/reconcile`, and the API asks Maya for the real payment status (`GET /payments/v1/payments/{checkoutId}`, secret key) before marking the order paid. The amount Maya reports must match the order total.
4. Optional but recommended once deployed: Maya also calls `POST /api/v1/webhooks/maya?token=<WEBHOOK_SECRET>`. The webhook body is never trusted: the API only uses its `id` to ask Maya for the real status.

Try it with Maya's sandbox test data (from developers.maya.ph > Sandbox Credentials and Cards):

| What | Value |
|---|---|
| Maya wallet (success) | +63 990 010 0900, password `Password@1`, OTP `123456` |
| Maya wallet (always fails: no balance) | +63 990 010 0916, password `Password@1`, OTP `123456` |
| Visa (3-D Secure, success) | `4123 4501 3100 1381`, exp 12/2030, CVV 123, 3DS password `mctest1` |
| Mastercard (no 3-D Secure) | `5123 4567 8901 2346`, exp 12/2030, CVV 111 |

Good to know:
- `.env.example` already contains Maya's **public shared sandbox keys**. They work for trying things out but other developers use them too. For your defense, create your own sandbox keys in Maya Business Manager and paste them into `.env`.
- Webhooks need a public **HTTPS** URL (port 443), so they only work after you deploy. Locally the return page + `/reconcile` does the job. After deploying with your own keys: `PUBLIC_API_URL=https://your-api npm run maya:webhooks`. The script refuses the shared keys on purpose.
- If Maya is down or rejects the request, checkout answers `503 PAYMENT_GATEWAY_ERROR`, nothing is left behind (stock and coupon are put back) and the cart is kept, so the customer can simply retry.
- Abandoned checkouts are cancelled after ~65 minutes (a sweeper first asks Maya, in case the customer actually paid) and their stock is released.
- `PAYMENT_PROVIDER=mock` keeps the built-in fake payment page for offline work and for the automated tests.
- I could not reach Maya's sandbox from the environment where this was built, so the Maya code is tested against a local fake that checks the same things Maya does (Basic-auth key, consistent amounts, reference length). Do one real sandbox payment before your defense; if Maya rejects a field, the API log prints Maya's error message.

## Good to know

- **Data is in Supabase** (see "Database: Supabase"). Restarting the API keeps everything.
- With `PAYMENT_PROVIDER=mock` the payment page is a local stand-in (`/api/v1/payments/sandbox/...`). The app flow is identical to Maya's: redirect to `checkoutUrl`, return to `/payment/success|cancelled`, read `GET /orders/:id`.
- **The AI is a keyword-based stand-in** behind an adapter. It can only return real menu items; prices and stock always come from the database. To test the 503 fallback send header `X-Simulate-AI-Outage: true` (or start with `AI_ENABLED=false`).
- Validation errors are **422** with `details[]` (finals guide), not 400. 400 is only for broken JSON / bad Idempotency-Key.
- `DELETE /cart/items/:id` returns **200 with the updated cart** (not 204) so the app always shows server totals.
- Product images are simple placeholder illustrations (SVG) in `public/images/`. Replace them with real photos and update each product's `imageUrl` (`PATCH /products/:id`).
- The backend must be reachable over **HTTPS** when the React app is on Vercel/Netlify, otherwise browsers block the calls (mixed content).
- One thing beyond the lectures: password hashing and random tokens use Node's built-in `crypto` module (no extra packages).
