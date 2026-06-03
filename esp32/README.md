# CycleOps ESP32 Controller

## Hardware Required

| Component | Recommended | Notes |
|-----------|-------------|-------|
| ESP32 dev board | ESP32-WROOM-32 DevKitC | Any ESP32 with WiFi will work |
| Relay module | HiLetgo 1-Channel 5V Relay (opto-isolated) | **Must be opto-isolated** |
| Power supply | 5V 2A USB or USB-C | Power the ESP32 via USB initially |
| NFC tag | NTAG213 sticker | Programme with machine URL |
| Jumper wires | Dupont female-to-male | For relay module |
| Enclosure | IP44 rated | Once installed near machine |

## Wiring

```
ESP32 GPIO26  ──→  Relay IN
ESP32 5V/VIN  ──→  Relay VCC
ESP32 GND     ──→  Relay GND

Relay NO (Normally Open)  ──→  Machine start button terminal A
Relay COM (Common)        ──→  Machine start button terminal B
```

> ⚠️ **SAFETY**: The relay bridges the washing machine's START button contacts.
> Verify which terminals these are on your specific machine BEFORE wiring.
> If unsure, have a qualified electrician inspect the machine.
> NEVER connect relay contacts directly to mains voltage.

## Arduino IDE Setup

1. Install Arduino IDE 2.x
2. Add ESP32 board manager:
   - Go to **File → Preferences**
   - Add to "Additional boards manager URLs":
     ```
     https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
     ```
3. Go to **Tools → Board → Boards Manager** → search "esp32" → install

## Required Libraries

Install via **Tools → Manage Libraries**:

- `ArduinoJson` by Benoit Blanchon (version 7.x)
- HTTPClient and WiFiClientSecure are part of the ESP32 core (no install needed)

## Configuration

1. Run `npm run db:seed` in the main project — it prints a Controller ID and Auth Token
2. Open `config.h`
3. Fill in:
   - `WIFI_SSID` and `WIFI_PASSWORD`
   - `API_BASE_URL` (your deployed URL, or ngrok URL for testing)
   - `CONTROLLER_ID` and `CONTROLLER_AUTH_TOKEN` (from seed output)
4. Verify `RELAY_PIN` matches your wiring (default: GPIO26)
5. **Add `config.h` to `.gitignore`** — never commit credentials

## Flash

1. Connect ESP32 via USB
2. Select board: **Tools → Board → ESP32 Dev Module**
3. Select port: **Tools → Port → /dev/cu.usbserial-xxxx** (or COM port on Windows)
4. Click **Upload** (→)
5. Open Serial Monitor at **115200 baud** to observe startup

## Serial Monitor Output (expected)

```
╔══════════════════════════════╗
║  CycleOps Controller v1.0.0  ║
╚══════════════════════════════╝
Controller ID: ctrl-washer-1

[WiFi] Connecting to YourNetwork.......
[WiFi] Connected!
[WiFi] IP: 192.168.1.42
[Controller] Registering...
[Controller] Registration OK

[Poll] (every 3 seconds, silent if no command)
[Command] Received: cmd_xyz — type=START relay=500ms
🔴 RELAY ON — pulsing for 500ms
⚪ RELAY OFF
[Result] Reported: success=true
```

## Testing Relay (without machine)

Before wiring to any machine:

1. Flash firmware
2. Watch Serial Monitor — confirm registration
3. Manually trigger a test payment via the web interface
4. Verify relay clicks and LED blinks
5. Use a multimeter in continuity mode to verify NO contacts close and open

## Relay Pulse Duration

Default: 500ms (configured in `config.h` → `DEFAULT_RELAY_PULSE_MS`)

The backend can also override this per-command via the `relayDurationMs` field.

Adjust after testing on your specific machine. Typical range: 200ms–1500ms.
The firmware hard-caps at `MAX_RELAY_PULSE_MS` (default: 5000ms) regardless.

## Production Security Note

`config.h` sets `client.setInsecure()` which skips TLS certificate verification.
This is acceptable for MVP development. Before deploying permanently:

1. Download your server's CA certificate
2. Replace `client.setInsecure()` with `client.setCACert(root_ca_cert)`
3. Store the cert as a `const char*` in a `certs.h` file (excluded from git)
