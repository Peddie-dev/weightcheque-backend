# WeightCheque Backend

Express + TypeScript + PostgreSQL + Prisma  
Payments: **Paystack** | CMS: **Strapi** | Push: **Expo** | Deploy: **Docker**

---

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Set up environment
cp .env.example .env
# Fill in all values in .env

# 3. Start database
docker compose up postgres redis -d

# 4. Run migrations + seed
npm run db:migrate
npm run db:seed

# 5. Start dev server
npm run dev
# → http://localhost:4000/api/v1
```

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express 4 |
| Database | PostgreSQL 16 |
| ORM | Prisma 5 |
| Auth | JWT (access + refresh tokens) |
| Payments | Paystack |
| Recipes CMS | Strapi (proxied) |
| Push Notifications | Expo Server SDK |
| Scheduling | node-cron |
| Containerisation | Docker + docker-compose |
| Reverse Proxy | Nginx |
| CI/CD | GitHub Actions |

---

## Project Structure

```
src/
├── config/
│   ├── index.ts          # Env validation (Zod)
│   ├── prisma.ts         # Prisma client singleton
│   └── logger.ts         # Winston logger
├── middleware/
│   ├── auth.ts           # JWT authenticate / optionalAuth / requireRole
│   └── errorHandler.ts   # Global error + 404 handler
├── modules/
│   ├── auth/             # register, login, refresh, logout, onboarding, me
│   ├── meals/            # browse, plan/today, plan/week, log, complete
│   ├── progress/         # weight, water, achievements, streak, summary
│   ├── grocery/          # list, generate, toggle, add, delete, reset
│   ├── recipes/          # Strapi proxy — list, detail, featured, categories
│   ├── subscription/     # Paystack plans, initiate, verify, cancel, webhook
│   └── notifications/    # register token, history, mark read, water reminders
├── jobs/
│   └── cron.ts           # Water reminders, meal reminders, streak, cleanup
├── utils/
│   ├── jwt.ts            # sign / verify helpers
│   └── response.ts       # sendSuccess / sendError helpers
├── app.ts                # Express app factory
└── server.ts             # Entry point — bootstrap, graceful shutdown
prisma/
├── schema.prisma         # Full DB schema
└── seed.ts               # Seed data + demo user
rn-client/
├── apiService.ts         # React Native Axios client (drop into RN project)
└── PaystackWebViewScreen.tsx  # WebView payment screen
nginx/nginx.conf          # Reverse proxy + rate limiting
docker-compose.yml
Dockerfile                # Multi-stage production build
.github/workflows/ci.yml  # Lint → Test → Build → Deploy
```

---

## API Reference

All routes prefixed with `/api/v1`. Protected routes require `Authorization: Bearer <token>`.

### Auth
| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | ✗ | Register new user |
| POST | `/auth/login` | ✗ | Login, returns tokens |
| POST | `/auth/refresh` | ✗ | Refresh access token |
| POST | `/auth/logout` | ✓ | Revoke refresh token |
| POST | `/auth/onboarding` | ✓ | Save goals + generate plan |
| GET | `/auth/me` | ✓ | Current user + profile |

### Meals
| Method | Route | Description |
|---|---|---|
| GET | `/meals` | Browse meals (filter: type, dietType, maxKcal, search) |
| GET | `/meals/:id` | Single meal |
| GET | `/meals/:id/alternatives` | Swap suggestions |
| GET | `/meals/plan/today` | Today's meal plan |
| GET | `/meals/plan/week` | Full week plan |
| POST | `/meals/plan/items/:id/complete` | Toggle meal complete |
| POST | `/meals/log` | Log a custom meal |
| GET | `/meals/log/today` | Today's logs + calorie summary |

### Progress
| Method | Route | Description |
|---|---|---|
| POST | `/progress/weight` | Log weight entry |
| GET | `/progress/weight?days=30` | Weight history + summary |
| POST | `/progress/water` | Log water intake (litres) |
| GET | `/progress/water/today` | Today's water + goal |
| GET | `/progress/achievements` | All achievements + unlock status |
| GET | `/progress/streak` | Current & longest streak |
| GET | `/progress/summary` | Dashboard summary |

### Grocery
| Method | Route | Description |
|---|---|---|
| GET | `/grocery` | Current week's list (auto-generates) |
| POST | `/grocery/generate` | Force regenerate from meal plan |
| POST | `/grocery/reset` | Uncheck all items |
| POST | `/grocery/items` | Add custom item |
| PATCH | `/grocery/items/:id` | Toggle item checked |
| DELETE | `/grocery/items/:id` | Remove item |

### Recipes (Strapi Proxy)
| Method | Route | Description |
|---|---|---|
| GET | `/recipes` | Browse (filter: search, category, dietType, mealType, maxKcal) |
| GET | `/recipes/:id` | Single recipe |
| GET | `/recipes/meta/featured` | Featured recipes |
| GET | `/recipes/meta/categories` | All categories |

### Subscription (Paystack)
| Method | Route | Description |
|---|---|---|
| GET | `/subscription/plans` | Available plans (public) |
| GET | `/subscription` | Current user subscription |
| POST | `/subscription/initiate` | Start payment → returns authorizationUrl |
| POST | `/subscription/verify` | Verify after WebView returns |
| POST | `/subscription/cancel` | Cancel at period end |
| GET | `/subscription/callback` | Paystack redirect target |
| POST | `/subscription/webhook` | Paystack event webhook |

### Notifications
| Method | Route | Description |
|---|---|---|
| POST | `/notifications/token` | Register Expo push token |
| DELETE | `/notifications/token` | Deactivate token |
| GET | `/notifications` | Notification history |
| PATCH | `/notifications/:id/read` | Mark one read |
| PATCH | `/notifications/read-all` | Mark all read |

---

## Paystack Setup

1. Create a Paystack account at [paystack.com](https://paystack.com)
2. Go to **Settings → API Keys** and copy your **Secret Key**
3. Go to **Products → Subscriptions → Plans** and create:
   - Monthly plan → copy the Plan Code (`PLN_xxx`)
   - Yearly plan → copy the Plan Code (`PLN_yyy`)
4. Go to **Settings → Webhooks** → add:
   - URL: `https://api.yourapp.com/api/v1/subscription/webhook`
   - Copy the **Webhook Secret**
5. Set all values in `.env`

---

## Cron Schedule (Africa/Nairobi)

| Job | Schedule | Description |
|---|---|---|
| Water reminders | 8,10,12,14,16,18,20h | Skips users who hit daily goal |
| Breakfast reminder | 7:30am | Push to all users with tokens |
| Lunch reminder | 12:30pm | Push to all users with tokens |
| Dinner reminder | 7:00pm | Push to all users with tokens |
| Streak update | Midnight | Extend/reset based on yesterday's logs |
| Token cleanup | 2:00am | Delete expired/revoked refresh tokens |
| Grocery generation | Mon 6:00am | Generate weekly lists for all users |
| Subscription check | 1:00am | Mark expired subscriptions as CANCELED |

---

## Strapi Integration

The `/recipes` routes act as a **proxy** to your existing Strapi instance.
- Set `STRAPI_BASE_URL` and `STRAPI_API_TOKEN` in `.env`
- Responses are normalised to match the app's `Meal` type
- 5-minute in-memory cache reduces Strapi load (replace with Redis for production)
- Same endpoint works for both the webapp and the React Native app

---

## React Native Integration

Copy from `rn-client/` into your RN project:

```bash
# API client (replaces src/api/apiService.ts)
cp rn-client/apiService.ts ../WeightCheque/src/api/apiService.ts

# Paystack payment screen
cp rn-client/PaystackWebViewScreen.tsx ../WeightCheque/src/screens/PaystackWebViewScreen.tsx
```

Install WebView for Paystack:
```bash
npx expo install react-native-webview
```

Add to stack navigator:
```tsx
<Stack.Screen name="PaystackWebView" component={PaystackWebViewScreen} />
```

Usage in SubscriptionScreen:
```tsx
const { authorizationUrl, reference } = await subscriptionApi.initiate('monthly');
navigation.navigate('PaystackWebView', { authorizationUrl, reference, planLabel: 'Monthly' });
```

---

## Deployment

```bash
# Build and start full stack
docker compose up -d

# Run migrations in container
docker compose exec api npx prisma migrate deploy

# Seed production DB
docker compose exec api npx ts-node prisma/seed.ts

# View logs
docker compose logs -f api
```

Set these GitHub Secrets for CI/CD:
- `PROD_HOST` — your server IP
- `PROD_USER` — SSH user
- `PROD_SSH_KEY` — private SSH key

---

## Demo credentials
```
Email:    henry@weightcheque.com
Password: password123
```

---

## Nutritionist API

All routes require `Authorization: Bearer <token>` with `role: NUTRITIONIST` or `role: ADMIN`.

### Member Management
| Method | Route | Description |
|---|---|---|
| GET | `/nutritionist/members` | List members (search, status filter, paginated) |
| GET | `/nutritionist/members/:id` | Member profile + subscription |
| GET | `/nutritionist/members/:id/progress` | Weight history, meal logs, achievements |
| GET | `/nutritionist/members/:id/plans` | All meal plans for a member |
| POST | `/nutritionist/members/:id/plans` | Create draft meal plan |
| PUT | `/nutritionist/members/:id/plans/:planId` | Update draft plan |
| POST | `/nutritionist/members/:id/plans/:planId/publish` | Publish plan → notifies member |
| DELETE | `/nutritionist/members/:id/plans/:planId` | Delete draft |
| POST | `/nutritionist/meals` | Add meal to the library |

### Messaging (Nutritionist aliases)
| Method | Route | Description |
|---|---|---|
| GET | `/nutritionist/conversations` | All conversations for this nutritionist |
| GET | `/nutritionist/conversations/:id/messages` | Paginated message history |
| POST | `/nutritionist/conversations/:id/messages` | Send message |
| PATCH | `/nutritionist/conversations/:id/read` | Mark messages as read |

### Messaging (Member-facing)
| Method | Route | Description |
|---|---|---|
| GET | `/messaging/conversations` | Member's conversations |
| POST | `/messaging/conversations` | Start a conversation |
| GET | `/messaging/conversations/:id/messages` | Message history |
| POST | `/messaging/conversations/:id/messages` | Send message |
| PATCH | `/messaging/conversations/:id/read` | Mark as read |
| GET | `/messaging/unread-count` | Total unread count |

### Socket.io Events
| Event | Direction | Payload | Description |
|---|---|---|---|
| `join_conversation` | client → server | `conversationId` | Subscribe to a room |
| `leave_conversation` | client → server | `conversationId` | Unsubscribe from a room |
| `send_message` | client → server | `{ conversationId, body }` | Send via socket |
| `new_message` | server → client | `Message` | New message received |
| `message_sent` | server → client | `Message` | Confirmation to sender |
| `user_typing` | server → client | `{ userId, userName }` | Typing indicator |
| `user_stop_typing` | server → client | `{ userId }` | Typing stopped |

---

## Publish Flow (End-to-End)

```
Nutritionist Dashboard          Backend                  Member App
─────────────────────           ──────────────────       ──────────────────
Build plan in grid
  └─ Save Draft          POST /nutritionist/.../plans   → DB: status=DRAFT

  └─ Publish             POST /nutritionist/.../plans/:id/publish
                           └─ DB: status=PUBLISHED
                           └─ Expo push notification ──→ Member gets push
                                                          Opens app
                                                          GET /meals/plan/today
                                                          ← Sees new plan ✓
```
