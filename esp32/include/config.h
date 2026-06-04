/**
 * CycleOps ESP32 Controller — Configuration
 *
 * ⚠️  FILL IN YOUR WI-FI CREDENTIALS BEFORE FLASHING ⚠️
 *
 * Steps:
 *  1. Replace YourWiFiName and YourWiFiPassword below
 *  2. Save the file
 *  3. Click Upload in PlatformIO
 */

#pragma once

// ─── Wi-Fi ────────────────────────────────────────────────────────────────
#define WIFI_SSID       "YourWiFiName"
#define WIFI_PASSWORD   "YourWiFiPassword"

// ─── Backend API ──────────────────────────────────────────────────────────
#define API_BASE_URL    "https://cycle-ops-iota.vercel.app"

// ─── Controller Identity ──────────────────────────────────────────────────
#define CONTROLLER_ID         "ctrl-washer-1"
#define CONTROLLER_AUTH_TOKEN "62d7161464756a78db28b2f7998ed3e51218b0efde2f79f2d024f2b22aa48048"

// ─── Relay Configuration ──────────────────────────────────────────────────
#define RELAY_PIN              26
#define RELAY_ACTIVE_HIGH      false        // Most opto-isolated relay modules are active LOW
#define DEFAULT_RELAY_PULSE_MS 500
#define MAX_RELAY_PULSE_MS     5000

// ─── Status LED ───────────────────────────────────────────────────────────
#define STATUS_LED_PIN        2             // GPIO2 = built-in LED on most ESP32 boards
#define STATUS_LED_ENABLED    true

// ─── Timing ───────────────────────────────────────────────────────────────
#define HEARTBEAT_INTERVAL_MS   30000
#define POLL_INTERVAL_MS         3000
#define WIFI_RETRY_DELAY_MS      5000
#define API_TIMEOUT_MS           8000
#define REGISTER_RETRY_DELAY_MS 10000

// ─── Firmware ─────────────────────────────────────────────────────────────
#define FIRMWARE_VERSION "1.0.0"
