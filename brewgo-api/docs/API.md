# Brew Go API v1: contract

Base URL: `http://localhost:3000/api/v1`  |  Auth: `Authorization: Bearer <token>`  |  Body: JSON

## Response envelopes (finals project guide)

```json
// success
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 20, "total": 13, "totalPages": 1, "hasNext": false } }
// error
{ "success": false, "error": { "code": "COUPON_EXPIRED", "message": "This coupon has expired", "details": null }, "requestId": "9b1c..." }
```

| Status | When | Typical `error.code` |
|---|---|---|
| 200 / 201 / 204 | OK / created / deleted (no body) | |
| 400 | Malformed JSON, missing/invalid `Idempotency-Key` | `BAD_JSON`, `IDEMPOTENCY_KEY_REQUIRED` |
| 401 | Missing/invalid/expired token, bad login, bad webhook secret | `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `WEBHOOK_UNAUTHORIZED` |
| 403 | Logged in but not staff | `FORBIDDEN` |
| 404 | Unknown id/route | `PRODUCT_NOT_FOUND`, `ORDER_NOT_FOUND`, `ROUTE_NOT_FOUND` ... |
| 409 | Stock conflict / illegal state / duplicate | `INSUFFICIENT_STOCK`, `PRODUCT_UNAVAILABLE`, `CART_EMPTY`, `ILLEGAL_ORDER_STATE`, `EMAIL_TAKEN`, `ALREADY_CHECKED_IN`, `IDEMPOTENCY_KEY_REUSED` |
| 422 | Field validation, coupon problems | `VALIDATION_ERROR` (see `details[]` = `{field,message}`), `INVALID_OPTION`, `COUPON_INVALID`, `COUPON_EXPIRED`, `COUPON_ALREADY_USED`, `COUPON_MIN_SPEND`, `INSUFFICIENT_POINTS`, `PAYMENT_METHOD_NOT_ALLOWED` |
| 429 | Rate limit (`Retry-After` header) | `RATE_LIMITED` |
| 503 | AI provider down, payment provider down | `AI_UNAVAILABLE` (`details.fallback` = keyword search), `PAYMENT_GATEWAY_ERROR` |

Pagination: `?page=1&limit=20` (max 50). Lists return `meta`.

## Endpoints (Auth column: · public, o optional, ✔ login, S staff)

| Method | Path | Auth | Figma screen / purpose |
|---|---|---|---|
| GET | /health | · | health check |
| POST | /auth/register | · | **Sign In** screen. Creates account, +50 bonus pts, returns token |
| POST | /auth/login | · | **Login** (`identifier` = email or phone) |
| POST | /auth/logout | ✔ | Profile > Sign Out |
| GET | /users/me | ✔ | **Profile**: user, stats (orders/favorites/cards), perks card |
| PATCH | /users/me | ✔ | Personal Information |
| GET/POST | /users/me/payment-methods | ✔ | Payment Methods (brand + last 4 only) |
| DELETE | /users/me/payment-methods/:id | ✔ | |
| GET | /home | o | **Dashboard**: greeting, points, categories, best sellers, favorites, live order |
| GET | /branches, /branches/:id | · | Pickup branch picker |
| GET | /categories | · | Hot / Iced / Pastries tabs |
| GET | /products | o | **Menu**: `?category=&search=&bestSeller=&available=&sort=name\|price_asc\|price_desc&page=&limit=` |
| GET | /products/:id | o | Product detail + `optionGroups` (size, milk, sweetness, ice, warmed) |
| POST/PUT/PATCH/DELETE | /products[/:id] | S | Staff menu management |
| GET/POST | /favorites | ✔ | Favorites (POST `{productId}`: 201 new, 200 already) |
| DELETE | /favorites/:productId | ✔ | |
| GET | /cart?fulfillment=pickup\|delivery | ✔ | **Cart / Order Summary** with server totals |
| DELETE | /cart | ✔ | clear (204) |
| POST | /cart/items | ✔ | `{productId, quantity?, options?, note?}` |
| PATCH/DELETE | /cart/items/:itemId | ✔ | edit / remove (returns updated cart) |
| POST/DELETE | /cart/coupon | ✔ | Coupon box. POST `{code}` |
| POST | /checkout | ✔ | **Checkout**. Header `Idempotency-Key` required |
| GET | /orders?status=active\|past | ✔ | **Orders** tabs. `meta.counts`, `meta.summary` |
| GET | /orders/:id | ✔ | Order detail. Payment return pages use this |
| POST | /orders/:id/cancel | ✔ | only `pending_payment` / `paid` |
| POST | /orders/:id/reorder | ✔ | "Reorder in 1-Tap" |
| POST | /orders/:id/reconcile | ✔ | re-check payment with gateway |
| PATCH | /orders/:id/status | S | preparing / ready / completed |
| GET | /payments/sandbox/:sessionId | · | sandbox hosted payment page (stand-in for PayMongo/Maya) |
| POST | /payments/sandbox/:sessionId/pay \| cancel | · | 303 redirect to `{FRONTEND_URL}/payment/success\|cancelled?orderId=` |
| POST | /webhooks/payments | secret | mock gateway webhook, header `X-Webhook-Secret` |
| POST | /webhooks/maya?token=… | secret | Maya webhook (body never trusted; the API re-checks with Maya) |
| GET | /rewards | ✔ | **Rewards**: points, tier, next free drink, streak, missions |
| GET | /rewards/catalog | ✔ | Redeem Rewards (`canRedeem`, `pointsNeeded`) |
| POST | /rewards/redeem | ✔ | `{rewardId}` -> coupon code |
| GET | /rewards/coupons | ✔ | my coupons (`?status=active\|used\|expired`) |
| GET | /rewards/history | ✔ | Redeem History / points ledger |
| POST | /rewards/streak/check-in | ✔ | Daily Brew Streak |
| GET | /notifications | ✔ | bell icon (`?unread=true`), `meta.unreadCount` |
| POST | /notifications/read-all, PATCH /notifications/:id/read | ✔ | |
| POST | /ai/recommendations | o | AI discovery `{query}` 3-200 chars |
| GET | /contact/channels, POST /contact | · / o | **Contact Us** (chat / call / email) |

## Checkout in 4 steps (what the React app does)

1. `POST /checkout` with header `Idempotency-Key: <crypto.randomUUID()>` and body
   `{ "fulfillment": "pickup", "paymentMethod": "ewallet", "branchId": 1, "pickupTime": "ASAP", "couponCode": "BREWGO10" }`
   (delivery: `"fulfillment":"delivery","deliveryAddress":"..."`; cash only for pickup).
2. `201` -> `data.payment.checkoutUrl` (Maya's hosted page). Do `window.location.href = checkoutUrl`. (Cash: `checkoutUrl` is `null`, order starts as `preparing`.)
3. The customer pays on Maya's page; Maya sends the browser back to `FRONTEND_URL/payment/success?orderId=…` or `/payment/cancelled?orderId=…[&reason=failed|cancelled]`.
4. Those pages call `POST /orders/:id/reconcile` (the API asks Maya) and then `GET /orders/:id`, and show `status`. They never decide "paid" themselves. A cancelled or failed attempt leaves the order `pending_payment` so the customer can retry with `payment.checkoutUrl` or cancel.

## Order status flow

`pending_payment -> paid -> preparing -> ready -> completed`; `pending_payment|paid -> cancelled`. Cash orders begin at `preparing`. Anything else answers `409 ILLEGAL_ORDER_STATE` with `details.allowed`.

## Points and rewards rules

1 pt per ₱10 spent (after discount) when payment is confirmed (cash: when completed). Signup +50. 5-day streak +25. Weekly missions +5 each. Free-drink progress target: 150 pts.
