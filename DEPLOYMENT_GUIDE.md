# CycleOps — Full Deployment Guide

> From zero to: tap NFC tag → pay with Apple Pay → washer starts.

---

## Overview

This guide has six stages. Do them in order.

| Stage | What you'll do |
|---|---|
| 1 | Set up Square (payments) |
| 2 | Set up Supabase (database) |
| 3 | Run and test locally |
| 4 | Deploy to Vercel |
| 5 | Wire the relay & flash the ESP32 |
| 6 | Program the NFC tag and do a live test |

**Time estimate:** ~3–4 hours first time through.

---

## Stage 1 — Square Setup

### 1.1 Create a Square Developer Account

1. Go to [developer.squareup.com](https://developer.squareup.com) and click **Get Started**.
2. Sign in with your existing Square account, or create a free one.
3. Once inside the Developer Dashboard, click **Create Your First Application**.
4. Name it `CycleOps` and click **Save**.

### 1.2 Get your Sandbox credentials (for local testing)

1. In your app, click the **Sandbox** tab in the left sidebar.
2. Under **Sandbox Access Token**, copy the token — it starts with `EAAAl...`.  
   → This becomes `SQUARE_ACCESS_TOKEN` in your `.env.local`.
3. Under **Sandbox Application ID**, copy the value — it starts with `sandbox-sq0idb-...`.  
   → This becomes `SQUARE_APPLICATION_ID`.
4. Note the **Sandbox Location ID** — go to **Locations** in the left nav and copy the ID for your test location.  
   → This becomes `SQUARE_LOCATION_ID`.

### 1.3 Enable Apple Pay / Google Pay in Sandbox

1. Go to **Apple Pay** in the left nav of your app settings.
2. You'll need to register your domain. In sandbox, you can use any `ngrok` URL for local testing, and your Vercel URL later.
3. Square handles the Apple Pay domain verification automatically when you use the Square Web Payments SDK — no extra steps needed.

### 1.4 Set your webhook endpoint

You'll come back to this after deploying to Vercel. Leave it for now.

### 1.5 Note your production credentials (for later)

Once ready to go live, you'll switch to the **Production** tab and repeat 1.2–1.4 with real credentials. Don't use production keys until you've confirmed everything works in sandbox.

---

## Stage 2 — Supabase Setup

### 2.1 Create a project

1. Go to [supabase.com](https://supabase.com) and sign up for free.
2. Click **New Project**.
3. Name it `cycleops`, choose your region (pick one close to Australia — `ap-southeast-2` Sydney is ideal), set a strong database password. **Save this password.**
4. Click **Create Project** and wait ~2 minutes for it to provision.

### 2.2 Get your database connection string

1. In the Supabase dashboard, go to **Settings → Database**.
2. Scroll to **Connection String** and select the **URI** tab.
3. Copy the URI — it looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
4. Replace `[YOUR-PASSWORD]` with the password you set.  
   → This becomes `DATABASE_URL` in your `.env.local`.

### 2.3 Enable connection pooling (important for Vercel)

1. In **Settings → Database**, scroll to **Connection Pooling**.
2. Toggle it **on** (Mode: Transaction, Port: 6543).
3. Copy the pooled connection string — this is what you'll use in production (Vercel can't hold persistent connections).
   → In production, `DATABASE_URL` = the pooler URL (port 6543).
   → For local dev, either URL works.

---

## Stage 3 — Local Dev & Testing

### 3.1 Clone and install

```bash
# Copy the project out of the tasklet agent storage to somewhere you can work with it
# (The files are at /tasklet/agent/home/cycleops/)
# Then in your terminal:

cd cycleops
npm install
```

### 3.2 Create your `.env.local`

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:

```env
# Database
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"

# Square (use Sandbox values for now)
SQUARE_ACCESS_TOKEN="EAAAl..."
SQUARE_APPLICATION_ID="sandbox-sq0idb-..."
SQUARE_LOCATION_ID="..."
SQUARE_ENVIRONMENT="sandbox"
SQUARE_WEBHOOK_SIGNATURE_KEY=""   # fill in after Stage 4

# Internal secrets — generate these yourself
INTERNAL_API_SECRET="your-random-secret-min-32-chars"
NEXTAUTH_SECRET="another-random-secret-min-32-chars"

# App URL (local dev)
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

**Generating secrets:** Run this in your terminal to generate each one:
```bash
openssl rand -base64 32
```

### 3.3 Run database migrations and seed

```bash
# Push the schema to Supabase
npx prisma db push

# Seed the database (creates Washer 1 + ESP32 controller + prints auth token)
npm run db:seed
```

The seed output will look like:
```
✅ Machine created: Washer 1 (washer-1)
✅ Controller created
🔑 ESP32 Auth Token (copy this into config.h): co_live_xxxxxxxxxxxxxxxxxxxx
📋 Controller ID: ctrl_xxxxxxxxxxxxxxxxxxxx
```

**Copy both values.** You'll need them for the ESP32 in Stage 5.

### 3.4 Start the dev server

```bash
npm run dev
```

Open `http://localhost:3000/machine/washer-1` on your computer browser first to check it loads.

### 3.5 Test the payment flow with Square Sandbox

To test on your actual phone (needed for Apple Pay / Google Pay):

1. Install [ngrok](https://ngrok.com/download) and run:
   ```bash
   ngrok http 3000
   ```
2. Copy the `https://xxxx.ngrok.io` URL.
3. Open that URL on your phone — you should see the CycleOps payment screen.
4. Use Square's [sandbox test cards](https://developer.squareup.com/docs/devtools/sandbox/payments):
   - Card number: `4111 1111 1111 1111`
   - Expiry: any future date
   - CVV: `111`
5. Complete payment → you should see **"Starting washer…"** then **"Washer started!"** (even without an ESP32 connected, the command gets queued in the DB).

### 3.6 Verify the database state

In Supabase, go to **Table Editor** and check:
- `payment_sessions` — should show a row with `status: PAID`
- `machine_commands` — should show a row with `type: START, status: PENDING`

If both rows exist, your payment→command pipeline works perfectly. ✅

---

## Stage 4 — Vercel Deployment

### 4.1 Push your code to GitHub

```bash
git init
git add .
git commit -m "CycleOps MVP initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/cycleops.git
git push -u origin main
```

### 4.2 Import to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in.
2. Click **Add New → Project**.
3. Import your GitHub repo.
4. Vercel auto-detects Next.js — leave all settings as-is.
5. Before clicking **Deploy**, click **Environment Variables** and add all your `.env.local` values.

   **Important changes for production:**
   - `DATABASE_URL` → use the **pooler URL** (port 6543) from Supabase
   - `SQUARE_ENVIRONMENT` → keep as `sandbox` until you're confident, then switch to `production`
   - `NEXT_PUBLIC_APP_URL` → your Vercel URL, e.g. `https://cycleops.vercel.app`

6. Click **Deploy**. Wait ~2 minutes.

### 4.3 Test your production URL

Open `https://your-app.vercel.app/machine/washer-1` — you should see the payment screen.

### 4.4 Register your Square webhook

1. In the Square Developer Dashboard, go to **Webhooks → Subscriptions**.
2. Click **Add Subscription**.
3. Set the URL to:
   ```
   https://your-app.vercel.app/api/payment-webhooks/square
   ```
4. Subscribe to these events:
   - `payment.completed`
   - `payment.failed`
   - `refund.completed`
5. Click **Save**.
6. Copy the **Signature Key** shown.
7. In Vercel, go to your project **Settings → Environment Variables** and add:
   ```
   SQUARE_WEBHOOK_SIGNATURE_KEY = [paste the key]
   ```
8. Redeploy (Vercel → Deployments → click the three dots on the latest → Redeploy).

### 4.5 Test the webhook

In Square Dashboard → Webhooks → your subscription, click **Send Test Event** → `payment.completed`.

Check your Vercel logs (Vercel → your project → **Logs**) — you should see:
```
[webhook] payment.completed received
[webhook] payment verified, queuing machine command
```

---

## Stage 5 — ESP32 Wiring & Firmware

### 5.1 What you need to buy

| Part | Where to get | ~Cost |
|---|---|---|
| ESP32 dev board (ESP32-WROOM-32 or similar) | AliExpress, Core Electronics, Jaycar | $5–15 |
| 5V single-channel opto-isolated relay module | AliExpress, Core Electronics | $3–8 |
| Jumper wires (male-to-male, male-to-female) | AliExpress | $3 |
| Micro USB cable + 5V USB power supply | Anywhere | ~$5 |
| Electrical tape + 2-core wire (0.75–1.5mm²) | Bunnings | $5 |

**Total: ~$20–40 AUD**

### 5.2 Understand the relay module

A relay is an electronically-controlled switch. The opto-isolated module you buy will have two sides:

**Control side (low-voltage — safe to touch):**
- `VCC` — power (5V from ESP32 or USB)
- `GND` — ground
- `IN` (or `Signal`) — control pin from ESP32

**Switching side (mains voltage — DANGER, treat with respect):**
- `COM` — common terminal
- `NO` — Normally Open (circuit is open/off when relay is not triggered)
- `NC` — Normally Closed (circuit is closed/on when relay is not triggered)

You will use `COM` and `NO` to wire into the washing machine's start circuit.

### 5.3 ESP32 to relay wiring

```
ESP32 Pin       →   Relay Module
─────────────────────────────────
3.3V or 5V VIN  →   VCC
GND             →   GND
GPIO 26         →   IN (Signal)
```

> **Note:** Most opto-isolated relay modules work with 3.3V on the IN pin even if VCC is 5V. If your relay doesn't trigger, try powering VCC from the ESP32's 5V (VIN) pin instead of 3.3V.

### 5.4 Washing machine wiring — READ THIS FIRST

> ⚠️ **Safety warning:** You are working near mains voltage (230V AC in Australia). Always disconnect the machine from the wall before opening any panels or touching wiring. If you are not confident working with mains wiring, hire a licensed electrician for this step only.

**The goal:** Find the two wires that connect when the Start button is pressed, and wire the relay in parallel so the ESP32 can simulate pressing it.

**Step 1 — Identify your machine's start mechanism**

Open the machine's control panel (usually 2–4 screws on the back or underneath). Look at the Start button:

- **Older machines (pre-2010, mechanical buttons):** The button physically connects two wires. ✅ Easy to work with.
- **Newer machines (membrane/touch buttons):** The button sends a signal to a control board. ⚠️ More complex — see the note below.

**For mechanical buttons:**

1. Unplug the machine from the wall.
2. Using a multimeter set to continuity mode, probe the two terminals on the back of the Start button.
3. When you press the button manually, the multimeter should beep. Those are your two wires.
4. Cut a piece of 2-core wire (~30cm). Strip 5mm from each end.
5. Connect one wire to `COM` on the relay, the other to `NO`.
6. Connect the other ends of the 2-core wire in parallel with the Start button terminals (one wire to each terminal).
7. Wrap exposed connections with electrical tape.

**For touch/membrane buttons (important note):**

Many modern machines route touch button signals through a low-voltage control board (typically 5V or 12V logic). In this case:
- Do NOT connect the relay directly across the button — you may damage the PCB.
- Instead, find the control board's START signal trace and connect the relay there.
- Or: look for a service manual online for your exact machine model — search `[Brand] [Model] service manual`. Many laundromat machines (Speed Queen, Electrolux Commercial) have well-documented wiring diagrams.
- If in doubt, an appliance technician can identify the right connection point for ~$50.

### 5.5 Edit `config.h` with your settings

Open `esp32/cycleops-controller/config.h` and fill in:

```cpp
// Wi-Fi
#define WIFI_SSID        "YourLaundromat_WiFi"
#define WIFI_PASSWORD    "your_wifi_password"

// Server (your Vercel URL)
#define SERVER_URL       "https://your-app.vercel.app"

// From the seed output in Stage 3.3
#define CONTROLLER_ID    "ctrl_xxxxxxxxxxxxxxxxxxxx"
#define AUTH_TOKEN       "co_live_xxxxxxxxxxxxxxxxxxxx"

// Relay
#define RELAY_PIN        26         // GPIO pin wired to relay IN
#define RELAY_ACTIVE_LOW false      // Most relay modules: false (HIGH = trigger)
                                    // If relay triggers on LOW, set to true
#define RELAY_PULSE_MS   500        // How long to hold the relay closed (milliseconds)
                                    // 500ms simulates a firm button press
```

**Finding `RELAY_ACTIVE_LOW`:** Look at your relay module when powered:
- If the LED is ON when `IN` is disconnected → it's active-low → set `true`
- If the LED is OFF when `IN` is disconnected → it's active-high → set `false`
- Most modules from AliExpress/eBay are active-low.

### 5.6 Install Arduino IDE and ESP32 support

1. Download [Arduino IDE 2](https://www.arduino.cc/en/software).
2. Open Arduino IDE → **File → Preferences**.
3. In "Additional Boards Manager URLs", add:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
4. Go to **Tools → Board → Boards Manager**, search `esp32`, install **esp32 by Espressif Systems** (version 2.x).

### 5.7 Install required libraries

In Arduino IDE → **Tools → Manage Libraries**, install:
- `ArduinoJson` by Benoit Blanchon (version 6.x)
- `WiFi` — built-in, no install needed
- `HTTPClient` — built-in, no install needed

### 5.8 Flash the ESP32

1. Connect ESP32 to your computer via USB.
2. In Arduino IDE: **Tools → Board** → select `ESP32 Dev Module` (or your specific board).
3. **Tools → Port** → select the COM port / `/dev/ttyUSB0` that appears.
4. Open `esp32/cycleops-controller/cycleops-controller.ino`.
5. Click **Upload** (the arrow button).
6. If upload fails, hold the **BOOT** button on the ESP32 while clicking Upload, release after "Connecting…" appears.

### 5.9 Monitor the ESP32

Open **Tools → Serial Monitor**, set baud rate to `115200`. You should see:

```
[CycleOps] Booting...
[WiFi] Connecting to YourLaundromat_WiFi...
[WiFi] Connected! IP: 192.168.1.42
[HTTP] Registering with server...
[HTTP] Registered OK
[Loop] Polling for commands...
[Loop] No commands pending
[Loop] Polling for commands...
```

If you see `[HTTP] Registration failed` — double-check your `CONTROLLER_ID`, `AUTH_TOKEN`, and `SERVER_URL` in `config.h`.

---

## Stage 6 — NFC Tag & Live Test

### 6.1 What you need

- **NTAG213 NFC tag** (sticker form factor ideal) — ~$1 each from AliExpress or Amazon
- An Android phone (NFC writing) or an app like [NFC Tools](https://apps.apple.com/app/nfc-tools/id1252962749) on iPhone

### 6.2 Write the URL to the NFC tag

The tag needs to open this URL when tapped:
```
https://your-app.vercel.app/machine/washer-1
```

**Using NFC Tools (iOS or Android):**
1. Open NFC Tools → **Write** → **Add a record** → **URL / URI**.
2. Enter your URL and tap **OK**.
3. Tap **Write / XX bytes** and hold your phone over the NFC tag.
4. Done — the tag is programmed.

**Using NFC TagWriter by NXP (Android):**
1. Create new dataset → URL → enter your URL.
2. Write & protect (optional: make it read-only so it can't be accidentally overwritten).

### 6.3 Test the NFC tag

Tap your phone on the NFC tag. Your phone should:
1. Open Safari/Chrome automatically (no app needed — this is the beauty of NFC)
2. Load the CycleOps payment screen for Washer 1

If it doesn't open automatically, check that NFC is enabled in your phone settings. On iPhone: Settings → NFC → on. Background Tag Reading should be enabled by default from iOS 14+.

### 6.4 End-to-end live test (Sandbox mode first)

With the ESP32 connected, relay wired but **washing machine unplugged from the wall**:

1. Tap the NFC tag with your phone.
2. You see the payment screen — shows "Washer 1 · $X.XX".
3. Pay with a Square sandbox test card (or use Apple Pay with a sandbox tester account — set this up in App Store Connect if you want to test the full Apple Pay flow).
4. Screen shows "Starting washer…" then "Washer started! ✓"
5. Check the Serial Monitor — you should see:
   ```
   [Loop] Command received: START (cmd_xxxx)
   [Relay] Pulsing GPIO 26 for 500ms
   [Loop] Reporting result: SUCCESS
   ```
6. You should hear the relay click.

If the relay clicks → everything is working end-to-end. ✅

### 6.5 Go live

1. Plug the washing machine back in.
2. In Square Dashboard, switch your app to **Production** and get real credentials.
3. Update Vercel environment variables:
   - `SQUARE_ACCESS_TOKEN` → production token
   - `SQUARE_APPLICATION_ID` → production ID
   - `SQUARE_LOCATION_ID` → production location
   - `SQUARE_ENVIRONMENT` → `production`
   - `SQUARE_WEBHOOK_SIGNATURE_KEY` → new production webhook signature key
4. Update the webhook URL in Square to point to production.
5. Redeploy on Vercel.
6. Tap the tag, pay with real Apple Pay, watch the washer start.

🧺 **You're live.**

---

## Troubleshooting

### Payment screen doesn't load
- Check Vercel logs for errors.
- Confirm `DATABASE_URL` in Vercel env vars is the pooler URL (port 6543).
- Run `npx prisma db push` again if schema is out of sync.

### "Machine not found" error
- Make sure you ran `npm run db:seed`.
- Check the machine slug in the URL matches `washer-1` exactly.

### ESP32 won't connect to Wi-Fi
- Check SSID/password in `config.h`.
- Make sure it's a 2.4 GHz network (ESP32 doesn't support 5 GHz).

### ESP32 registration fails
- Confirm `SERVER_URL` has no trailing slash.
- Confirm `CONTROLLER_ID` and `AUTH_TOKEN` match exactly what the seed printed.

### Relay clicks but washer doesn't start
- Check that `RELAY_PULSE_MS` is long enough — try 1000ms (1 second).
- Verify the relay is wired to `COM` + `NO`, not `COM` + `NC`.
- Test manually: in Arduino IDE Serial Monitor, send `TEST` to trigger a relay pulse.

### Apple Pay button doesn't appear
- Apple Pay only works on HTTPS with a registered domain. Works on Vercel automatically.
- In sandbox, use a Square sandbox Apple Pay test account.
- Device must have a card added to Apple Wallet.

### Webhook signature validation fails
- Double-check `SQUARE_WEBHOOK_SIGNATURE_KEY` in Vercel env vars.
- Make sure the webhook URL in Square matches exactly (no trailing slash).

---

## Quick Reference

| Thing | Where to find it |
|---|---|
| Vercel logs | vercel.com → project → Logs |
| Supabase data | supabase.com → project → Table Editor |
| Square sandbox test cards | developer.squareup.com → docs → Sandbox |
| ESP32 serial output | Arduino IDE → Tools → Serial Monitor @ 115200 |
| Machine URL | `https://your-app.vercel.app/machine/washer-1` |

---

*CycleOps MVP — built to get one washer running. Everything else comes later.*
