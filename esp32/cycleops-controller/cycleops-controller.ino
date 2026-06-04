/**
 * CycleOps ESP32 Controller Firmware
 * ====================================
 * Version: 1.0.2
 *
 * What this does:
 *   1. Connects to Wi-Fi
 *   2. Registers with the CycleOps backend
 *   3. Sends heartbeats every 30 seconds
 *   4. Polls for machine start commands every 3 seconds
 *   5. On command: pulses relay for configured duration
 *   6. Reports command result back to backend
 *
 * Required libraries (install via Arduino Library Manager):
 *   - ArduinoJson  (by Benoit Blanchon) — version 7.x
 *   - HTTPClient   (built into ESP32 Arduino core)
 *   - WiFi         (built into ESP32 Arduino core)
 *   - WiFiClientSecure (built into ESP32 Arduino core)
 *
 * Board: ESP32 Dev Module (or WROOM-32, WROVER, etc.)
 * Board Manager URL: https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
 *
 * SAFETY NOTES:
 *   - Always use an opto-isolated relay module (e.g. Keyestudio 5V Relay)
 *   - Test relay operation WITHOUT the washing machine first
 *   - Do NOT connect relay COM/NO to mains without verifying correct wiring
 *   - The relay should bridge the machine's start button contacts only
 *   - Have an electrician verify the wiring if unsure
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"

// ─── State machine ────────────────────────────────────────────────────────

enum ControllerState {
  STATE_WIFI_CONNECTING,
  STATE_REGISTERING,
  STATE_IDLE,
  STATE_EXECUTING,
};

ControllerState currentState = STATE_WIFI_CONNECTING;

// ─── Timing ───────────────────────────────────────────────────────────────

unsigned long lastHeartbeatMs = 0;
unsigned long lastPollMs      = 0;

// ─── HTTP failure tracking ────────────────────────────────────────────────

int consecutiveHttpFailures = 0;
const int MAX_HTTP_FAILURES = 5;

// ─── Safety flag: ensure command is only executed once ────────────────────

String lastExecutedCommandId = "";

// ─── Forward declarations ─────────────────────────────────────────────────

bool connectWifi();
bool registerController();
bool sendHeartbeat();
void pollForCommand();
void executeCommand(const String& commandId, int relayDurationMs);
bool reportCommandResult(const String& commandId, bool success, const String& message);
String makeAuthHeader();
int httpPost(const String& path, const String& body, String& responseOut);
int httpGet(const String& path, String& responseOut);
void setLed(bool on);
void blinkLed(int times, int delayMs = 150);
void handleHttpFailure(int statusCode);

// ─── Setup ────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n╔══════════════════════════════╗");
  Serial.println("║  CycleOps Controller v" FIRMWARE_VERSION "  ║");
  Serial.println("╚══════════════════════════════╝");
  Serial.printf("Controller ID: %s\n\n", CONTROLLER_ID);

  // Configure relay pin — start in inactive state
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? LOW : HIGH);

  // Status LED
  if (STATUS_LED_ENABLED) {
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);
  }

  currentState = STATE_WIFI_CONNECTING;
}

// ─── Main loop ────────────────────────────────────────────────────────────

void loop() {
  unsigned long now = millis();

  switch (currentState) {

    case STATE_WIFI_CONNECTING:
      if (connectWifi()) {
        Serial.println("[WiFi] Connected!");
        blinkLed(3);
        consecutiveHttpFailures = 0;
        currentState = STATE_REGISTERING;
      } else {
        Serial.println("[WiFi] Connection failed. Retrying...");
        delay(WIFI_RETRY_DELAY_MS);
      }
      break;

    case STATE_REGISTERING:
      if (registerController()) {
        Serial.println("[Controller] Registered successfully.");
        blinkLed(5);
        consecutiveHttpFailures = 0;
        currentState = STATE_IDLE;
        lastHeartbeatMs = now;
        lastPollMs      = now;
      } else {
        Serial.println("[Controller] Registration failed. Retrying...");
        delay(REGISTER_RETRY_DELAY_MS);
      }
      break;

    case STATE_IDLE:
      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WiFi] Disconnected. Reconnecting...");
        currentState = STATE_WIFI_CONNECTING;
        break;
      }

      if (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
        sendHeartbeat();
        lastHeartbeatMs = now;
      }

      if (now - lastPollMs >= POLL_INTERVAL_MS) {
        pollForCommand();
        lastPollMs = now;
      }

      break;

    case STATE_EXECUTING:
      currentState = STATE_IDLE;
      break;
  }
}

// ─── Wi-Fi ────────────────────────────────────────────────────────────────

bool connectWifi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.disconnect(true);
  delay(500);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  return false;
}

// ─── Controller Registration ──────────────────────────────────────────────

bool registerController() {
  Serial.println("[Controller] Registering...");

  StaticJsonDocument<256> payload;
  payload["controllerId"]     = CONTROLLER_ID;
  payload["firmwareVersion"]  = FIRMWARE_VERSION;

  String body;
  serializeJson(payload, body);

  String response;
  int statusCode = httpPost("/api/controllers/register", body, response);

  if (statusCode == 200) {
    Serial.println("[Controller] Registration OK");
    return true;
  }

  Serial.printf("[Controller] Registration failed: HTTP %d — %s\n", statusCode, response.c_str());
  return false;
}

// ─── Heartbeat ────────────────────────────────────────────────────────────

bool sendHeartbeat() {
  String response;
  int statusCode = httpPost(
    "/api/controllers/" CONTROLLER_ID "/heartbeat",
    "{}",
    response
  );

  if (statusCode == 200) {
    setLed(true);
    delay(50);
    setLed(false);
    consecutiveHttpFailures = 0;
    return true;
  }

  Serial.printf("[Heartbeat] Failed: HTTP %d\n", statusCode);
  handleHttpFailure(statusCode);
  return false;
}

// ─── Poll for Commands ────────────────────────────────────────────────────

void pollForCommand() {
  String response;
  int statusCode = httpGet(
    "/api/controllers/" CONTROLLER_ID "/commands/next",
    response
  );

  if (statusCode != 200) {
    Serial.printf("[Poll] HTTP %d\n", statusCode);
    handleHttpFailure(statusCode);
    return;
  }

  // Success — reset failure counter
  consecutiveHttpFailures = 0;

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) {
    Serial.printf("[Poll] JSON parse error: %s\n", err.c_str());
    return;
  }

  if (doc["command"].isNull()) {
    return;
  }

  const char* commandId   = doc["command"]["id"];
  const char* commandType = doc["command"]["type"];
  int relayDurationMs     = doc["command"]["relayDurationMs"] | DEFAULT_RELAY_PULSE_MS;

  if (!commandId || !commandType) {
    Serial.println("[Poll] Malformed command payload");
    return;
  }

  Serial.printf("[Command] Received: %s — type=%s relay=%dms\n",
    commandId, commandType, relayDurationMs);

  if (relayDurationMs > MAX_RELAY_PULSE_MS) {
    relayDurationMs = MAX_RELAY_PULSE_MS;
  }

  if (String(commandId) == lastExecutedCommandId) {
    Serial.printf("[Command] DUPLICATE — already executed %s, ignoring.\n", commandId);
    return;
  }

  if (strcmp(commandType, "START") == 0) {
    executeCommand(String(commandId), relayDurationMs);
  } else {
    Serial.printf("[Command] Unknown command type: %s\n", commandType);
    reportCommandResult(String(commandId), false, "Unknown command type");
  }
}

// ─── Execute Command (Relay Pulse) ────────────────────────────────────────

void executeCommand(const String& commandId, int relayDurationMs) {
  currentState = STATE_EXECUTING;

  Serial.printf("\n🔴 RELAY ON — pulsing for %dms\n", relayDurationMs);
  blinkLed(2, 100);

  digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? HIGH : LOW);
  delay(relayDurationMs);
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? LOW : HIGH);

  Serial.println("⚪ RELAY OFF");
  blinkLed(3, 200);

  lastExecutedCommandId = commandId;

  bool reported = reportCommandResult(commandId, true, "Relay pulsed OK");
  if (!reported) {
    Serial.println("[Command] Warning: failed to report result.");
  }

  currentState = STATE_IDLE;
}

// ─── Report Command Result ────────────────────────────────────────────────

bool reportCommandResult(const String& commandId, bool success, const String& message) {
  StaticJsonDocument<256> payload;
  payload["success"] = success;
  payload["message"] = message;

  String body;
  serializeJson(payload, body);

  String path = "/api/controllers/" CONTROLLER_ID "/commands/" + commandId + "/result";

  String response;
  int statusCode = httpPost(path, body, response);

  if (statusCode == 200) {
    Serial.printf("[Result] Reported: success=%s\n", success ? "true" : "false");
    return true;
  }

  Serial.printf("[Result] Report failed: HTTP %d\n", statusCode);
  return false;
}

// ─── HTTP Failure Handler ─────────────────────────────────────────────────

void handleHttpFailure(int statusCode) {
  if (statusCode < 0) {
    consecutiveHttpFailures++;
    Serial.printf("[Net] Connection failure #%d\n", consecutiveHttpFailures);

    if (consecutiveHttpFailures >= MAX_HTTP_FAILURES) {
      Serial.println("[Net] Too many failures — forcing WiFi reconnect...");
      consecutiveHttpFailures = 0;
      WiFi.disconnect(true);
      delay(1000);
      currentState = STATE_WIFI_CONNECTING;
    }
  }
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────
// Each request creates its own WiFiClientSecure and destroys it after.
// This prevents the shared-client state corruption that causes -1 errors
// after a few minutes of operation.

String makeAuthHeader() {
  return String("Bearer ") + CONTROLLER_AUTH_TOKEN;
}

int httpPost(const String& path, const String& body, String& responseOut) {
  if (WiFi.status() != WL_CONNECTED) return 0;

  WiFiClientSecure client;
  client.setInsecure();  // Skip cert verification for MVP

  HTTPClient http;
  String url = String(API_BASE_URL) + path;
  http.begin(client, url);
  http.setTimeout(API_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", makeAuthHeader());

  int statusCode = http.POST(body);
  if (statusCode > 0) {
    responseOut = http.getString();
  }
  http.end();
  client.stop();  // Fully close the TCP connection

  return statusCode;
}

int httpGet(const String& path, String& responseOut) {
  if (WiFi.status() != WL_CONNECTED) return 0;

  WiFiClientSecure client;
  client.setInsecure();  // Skip cert verification for MVP

  HTTPClient http;
  String url = String(API_BASE_URL) + path;
  http.begin(client, url);
  http.setTimeout(API_TIMEOUT_MS);
  http.addHeader("Authorization", makeAuthHeader());

  int statusCode = http.GET();
  if (statusCode > 0) {
    responseOut = http.getString();
  }
  http.end();
  client.stop();  // Fully close the TCP connection

  return statusCode;
}

// ─── LED Helpers ──────────────────────────────────────────────────────────

void setLed(bool on) {
  if (!STATUS_LED_ENABLED) return;
  digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
}

void blinkLed(int times, int delayMs) {
  if (!STATUS_LED_ENABLED) return;
  for (int i = 0; i < times; i++) {
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(delayMs);
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(delayMs);
  }
}
