# CycleOps MVP

> Customer taps NFC tag → pays on phone → washing machine starts automatically.

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/cycleops
cd cycleops
npm install
```

### 2. Set up environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:
- `DATABASE_URL` — your Supabase PostgreSQL connection string
- `SQUARE_ACCESS_TOKEN` — from [Square Developer Dashboard](https://developer.squareup.com/apps)
- `SQUARE_LOCATION_ID` — your Square location
- `SQUARE_APPLICATION_ID` — your Square app ID
- `SQUARE_WEBHOOK_SIGNATURE_KEY` — from Square Dashboard → Webhooks
- `NEXT_PUBLIC_*` equivalents of the above (safe for browser)
- `INTERNAL_API_SECRET` — generate with `openssl rand -hex 32`

### 3. Set up database

```bash
npm run db:generate   # Generate Prisma client
npm run db:push       # Push schema to database
npm run db:seed       # Create Washer 1 + controller
```

**Save the auth token printed by the seed command** — you'll need it for `esp32/config.h`.

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000/machine/washer-1](http://localhost:3000/machine/washer-1)

### 5. Configure ESP32

See [`esp32/README.md`](esp32/README.md) for hardware setup and flashing instructions.

---

## Project Structure

```
cycleops/
├── prisma/
│   ├── schema.prisma        # Database schema
│   └── seed.ts              # Creates Washer 1 + controller
│
├── src/
│   ├── app/
│   │   ├── machine/[machineId]/
│   │   │   ├── page.tsx         # NFC landing page (server component)
│   │   │   └── PaymentForm.tsx  # Payment UI (client component)
│   │   │
│   │   └── api/
│   │       ├── machines/[machineId]/route.ts
│   │       ├── payment-sessions/
│   │       │   ├── route.ts                         # POST — create session
│   │       │   └── [sessionId]/
│   │       │       ├── route.ts                     # GET — session status
│   │       │       └── pay/route.ts                 # POST — charge payment
│   │       ├── payment-webhooks/[provider]/route.ts # Webhook receiver
│   │       └── controllers/
│   │           ├── register/route.ts
│   │           └── [controllerId]/
│   │               ├── heartbeat/route.ts
│   │               └── commands/
│   │                   ├── next/route.ts
│   │                   └── [commandId]/result/route.ts
│   │
│   └── lib/
│       ├── db.ts                  # Prisma client singleton
│       ├── machine-control.ts     # Machine start logic
│       ├── auth.ts                # Controller token validation
│       ├── rate-limit.ts          # In-memory rate limiter
│       └── payments/
│           ├── types.ts           # PaymentProvider interface
│           ├── square.ts          # Square implementation
│           └── index.ts           # Provider factory
│
└── esp32/
    ├── cycleops-controller/
    │   ├── cycleops-controller.ino   # Main firmware
    │   └── config.h                  # ⚠️ Fill in and keep secret
    └── README.md
```

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Set all environment variables in the Vercel dashboard (same as `.env.local`).

After deploying, configure your Square webhook:
- URL: `https://your-app.vercel.app/api/payment-webhooks/square`
- Events: `payment.updated`
- Copy the signature key into `SQUARE_WEBHOOK_SIGNATURE_KEY`

---

## NFC Tag Setup

1. Use any NTAG213 sticker (available from AliExpress, ~$0.50 each)
2. Programme the URL: `https://mvp.cycleops.app/machine/washer-1`
3. Use any NFC writing app (e.g. NFC Tools on iOS/Android)
4. Stick to the front of the washing machine

---

## Payment Flow

```
Customer taps NFC tag
        ↓
GET /api/machines/washer-1         (machine details + availability)
        ↓
POST /api/payment-sessions          (create session, lock machine)
        ↓
Square Web Payments SDK             (Apple Pay / Google Pay / card)
        ↓
POST /api/payment-sessions/:id/pay  (tokenise → charge → create command)
        ↓
GET /api/payment-sessions/:id       (frontend polls for machine status)
        ↓
GET /api/controllers/:id/commands/next  (ESP32 polls every 3s)
        ↓
Relay pulses for configured duration
        ↓
POST /api/controllers/:id/commands/:id/result  (ESP32 reports back)
        ↓
Machine status → RUNNING ✅
```

---

## Adding a Payment Provider

1. Create `src/lib/payments/my-provider.ts` implementing `PaymentProvider`
2. Add it to the `providers` map in `src/lib/payments/index.ts`
3. Set `PAYMENT_PROVIDER=my-provider` in your environment
4. Machine control logic requires zero changes

---

## Acceptance Criteria

- [ ] NFC tap opens mobile payment page
- [ ] Machine name and price are displayed correctly
- [ ] Apple Pay / Google Pay / card are offered
- [ ] Payment session created and stored in database
- [ ] Duplicate payment sessions are blocked
- [ ] Payment webhook received and verified
- [ ] Successful payment creates machine start command
- [ ] ESP32 receives and claims the command
- [ ] Relay pulses for configured duration
- [ ] Washing machine starts
- [ ] ESP32 reports success
- [ ] Transaction logged in database
- [ ] Failed payment does not start machine
- [ ] Expired session does not start machine
- [ ] Duplicate webhook does not start machine twice
- [ ] Operator can disable machine via database
