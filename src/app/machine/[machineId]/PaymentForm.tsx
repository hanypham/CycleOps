"use client";

/**
 * PaymentForm — client-side payment component
 *
 * Handles the full customer flow:
 * 1. Fetch machine details
 * 2. Create payment session
 * 3. Load Square Web Payments SDK
 * 4. Show Apple Pay / Google Pay / card form
 * 5. Tokenise and send to backend
 * 6. Poll for machine start confirmation
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────

interface Machine {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  priceCents: number;
  currency: string;
  cycleDurationMinutes: number;
  canPay: boolean;
  unavailableReason: string | null;
}

interface PaymentSession {
  sessionId: string;
  amountCents: number;
  currency: string;
  expiresAt: string;
  squareAppId: string;
  squareLocationId: string;
  squareEnvironment: string;
}

type FlowState =
  | "loading"        // Fetching machine info
  | "unavailable"    // Machine not available
  | "ready"          // Ready to start payment
  | "paying"         // Payment in progress
  | "processing"     // Backend processing
  | "starting"       // Command issued, waiting for ESP32
  | "started"        // Relay pulsed — machine running!
  | "failed"         // Payment failed
  | "expired"        // Session expired
  | "error";         // Unexpected error

// ─── Square SDK types (minimal) ───────────────────────────────────────────
declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => Promise<SquarePayments>;
    };
  }
}
interface SquarePayments {
  card: () => Promise<SquareCard>;
  applePay: (request: SquarePaymentRequest) => Promise<SquareWalletButton>;
  googlePay: (request: SquarePaymentRequest) => Promise<SquareWalletButton>;
  paymentRequest: (opts: SquarePaymentRequestOptions) => SquarePaymentRequest;
}
interface SquareCard {
  attach: (selector: string) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: unknown[] }>;
  destroy: () => Promise<void>;
}
interface SquarePaymentRequest { /* opaque */ }
interface SquarePaymentRequestOptions {
  countryCode: string;
  currencyCode: string;
  total: { amount: string; label: string };
}
interface SquareWalletButton {
  attach: (selector: string) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: unknown[] }>;
  destroy: () => Promise<void>;
}

// ─── Helper: format cents ─────────────────────────────────────────────────
function formatPrice(cents: number, currency = "AUD"): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ─── Component ────────────────────────────────────────────────────────────

export default function PaymentForm({ machineSlug }: { machineSlug: string }) {
  const [flowState, setFlowState] = useState<FlowState>("loading");
  const [machine, setMachine] = useState<Machine | null>(null);
  const [session, setSession] = useState<PaymentSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const cardRef = useRef<SquareCard | null>(null);
  const applePayRef = useRef<SquareWalletButton | null>(null);
  const googlePayRef = useRef<SquareWalletButton | null>(null);
  const paymentsRef = useRef<SquarePayments | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Step 1: Load machine ──────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/machines/${machineSlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setFlowState("error");
          setErrorMessage(data.error);
          return;
        }
        setMachine(data as Machine);
        if (!data.canPay) {
          setFlowState("unavailable");
        } else {
          setFlowState("ready");
        }
      })
      .catch(() => {
        setFlowState("error");
        setErrorMessage("Could not connect. Please check your connection and try again.");
      });
  }, [machineSlug]);

  // ─── Step 2: Create session + load Square SDK ──────────────────────────

  const startPayment = useCallback(async () => {
    if (!machine) return;
    setFlowState("paying");
    setErrorMessage("");

    // Create payment session
    let sess: PaymentSession;
    try {
      const res = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId: machine.slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFlowState("ready");
        setErrorMessage(data.error ?? "Could not start payment. Please try again.");
        return;
      }
      sess = data as PaymentSession;
      setSession(sess);
    } catch {
      setFlowState("ready");
      setErrorMessage("Network error. Please try again.");
      return;
    }

    // Load Square Web Payments SDK
    const sdkUrl =
      sess.squareEnvironment === "production"
        ? "https://web.squarecdn.com/v1/square.js"
        : "https://sandbox.web.squarecdn.com/v1/square.js";

    await loadScript(sdkUrl);

    if (!window.Square) {
      setFlowState("error");
      setErrorMessage("Payment SDK failed to load. Please refresh and try again.");
      return;
    }

    const payments = await window.Square.payments(sess.squareAppId, sess.squareLocationId);
    paymentsRef.current = payments;

    // Initialise card form
    const card = await payments.card();
    await card.attach("#sq-card-container");
    cardRef.current = card;

    // Initialise Apple Pay
    try {
      const paymentRequest = payments.paymentRequest({
        countryCode: "AU",
        currencyCode: sess.currency,
        total: {
          amount: formatAmount(sess.amountCents),
          label: machine.name,
        },
      });
      const applePay = await payments.applePay(paymentRequest);
      await applePay.attach("#apple-pay-button");
      applePayRef.current = applePay;
    } catch {
      // Apple Pay not available on this device — silently skip
    }

    // Initialise Google Pay
    try {
      const paymentRequest = payments.paymentRequest({
        countryCode: "AU",
        currencyCode: sess.currency,
        total: {
          amount: formatAmount(sess.amountCents),
          label: machine.name,
        },
      });
      const googlePay = await payments.googlePay(paymentRequest);
      await googlePay.attach("#google-pay-button");
      googlePayRef.current = googlePay;
    } catch {
      // Google Pay not available — silently skip
    }
  }, [machine]);

  // ─── Step 3: Tokenise and charge ──────────────────────────────────────

  const handlePayWithCard = useCallback(async () => {
    if (!cardRef.current || !session) return;
    await submitPayment(() => cardRef.current!.tokenize());
  }, [session]);

  const handlePayWithApplePay = useCallback(async () => {
    if (!applePayRef.current || !session) return;
    await submitPayment(() => applePayRef.current!.tokenize());
  }, [session]);

  const handlePayWithGooglePay = useCallback(async () => {
    if (!googlePayRef.current || !session) return;
    await submitPayment(() => googlePayRef.current!.tokenize());
  }, [session]);

  const submitPayment = useCallback(
    async (tokenizeFn: () => Promise<{ status: string; token?: string }>) => {
      if (!session) return;
      setFlowState("processing");

      const tokenResult = await tokenizeFn();
      if (tokenResult.status !== "OK" || !tokenResult.token) {
        setFlowState("paying");
        setErrorMessage("Payment could not be processed. Please try again.");
        return;
      }

      try {
        const res = await fetch(`/api/payment-sessions/${session.sessionId}/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: tokenResult.token }),
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          setFlowState("failed");
          setErrorMessage(data.error ?? "Payment failed. Please try again.");
          return;
        }

        // Payment succeeded — start polling for machine start
        setFlowState("starting");
        startPolling(session.sessionId);
      } catch {
        setFlowState("failed");
        setErrorMessage("Network error during payment. Please check your bank and try again.");
      }
    },
    [session]
  );

  // ─── Step 4: Poll for machine start ───────────────────────────────────

  const startPolling = useCallback((sessionId: string) => {
    let attempts = 0;
    const MAX_ATTEMPTS = 40; // 40 × 3s = 2 minutes

    pollIntervalRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(pollIntervalRef.current!);
        setFlowState("error");
        setErrorMessage("Machine start is taking longer than expected. Your payment was successful — please notify staff.");
        return;
      }

      try {
        const res = await fetch(`/api/payment-sessions/${sessionId}`);
        const data = await res.json();

        if (data.machineCommand?.status === "EXECUTED") {
          clearInterval(pollIntervalRef.current!);
          setFlowState("started");
        } else if (data.machineCommand?.status === "FAILED") {
          clearInterval(pollIntervalRef.current!);
          setFlowState("error");
          setErrorMessage("Machine start failed. Your payment was successful — please notify staff.");
        }
      } catch {
        // Network blip — keep polling
      }
    }, 3000);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      cardRef.current?.destroy().catch(() => {});
      applePayRef.current?.destroy().catch(() => {});
      googlePayRef.current?.destroy().catch(() => {});
    };
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Logo & Brand */}
      <div className="text-center mb-8">
        <div className="text-4xl mb-2">🧺</div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Laundry Day</h1>
        <p className="text-sm text-gray-500 mt-1">Tap. Pay. Wash.</p>
      </div>

      {/* ── LOADING ── */}
      {flowState === "loading" && (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full wash-spin" />
          <p className="text-gray-500 mt-4 text-sm">Finding your machine…</p>
        </div>
      )}

      {/* ── UNAVAILABLE ── */}
      {flowState === "unavailable" && machine && (
        <StateCard icon="🚫" title={machine.name} color="yellow">
          <p className="text-gray-600 text-sm text-center">{machine.unavailableReason}</p>
          <p className="text-gray-400 text-xs text-center mt-2">Status: {machine.status}</p>
        </StateCard>
      )}

      {/* ── READY ── */}
      {flowState === "ready" && machine && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-sky-500 to-sky-600 px-6 py-5 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sky-100 text-xs font-medium uppercase tracking-widest">
                  {machine.type === "WASHER" ? "Washing Machine" : "Dryer"}
                </p>
                <h2 className="text-2xl font-bold mt-0.5">{machine.name}</h2>
              </div>
              <div className="text-4xl">{machine.type === "WASHER" ? "🫧" : "♨️"}</div>
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-100">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Regular Wash</p>
                <p className="text-gray-600 text-sm mt-0.5">{machine.cycleDurationMinutes} min cycle</p>
              </div>
              <p className="text-3xl font-bold text-gray-900">
                {formatPrice(machine.priceCents, machine.currency)}
              </p>
            </div>

            <button
              onClick={startPayment}
              className="w-full bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-semibold py-4 px-6 rounded-xl text-base transition-colors"
            >
              Pay {formatPrice(machine.priceCents, machine.currency)}
            </button>

            <p className="text-xs text-gray-400 text-center mt-3">
              Apple Pay · Google Pay · Card accepted
            </p>
          </div>
        </div>
      )}

      {/* ── PAYING — Square SDK form ── */}
      {flowState === "paying" && machine && session && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-sky-500 to-sky-600 px-6 py-4 text-white flex items-center justify-between">
            <div>
              <p className="font-semibold">{machine.name}</p>
              <p className="text-sky-100 text-sm">Regular Wash</p>
            </div>
            <p className="text-2xl font-bold">{formatPrice(session.amountCents, session.currency)}</p>
          </div>

          <div className="px-6 py-5 space-y-3">
            {/* Wallet buttons (Apple Pay / Google Pay — rendered by Square SDK) */}
            <div id="apple-pay-button" onClick={handlePayWithApplePay} />
            <div id="google-pay-button" onClick={handlePayWithGooglePay} />

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-gray-100" />
              <span className="flex-shrink text-gray-400 text-xs px-3">or pay by card</span>
              <div className="flex-grow border-t border-gray-100" />
            </div>

            {/* Square card form */}
            <div id="sq-card-container" className="w-full" />

            {errorMessage && (
              <p className="text-red-500 text-sm text-center py-1">{errorMessage}</p>
            )}

            <button
              onClick={handlePayWithCard}
              className="w-full bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-semibold py-4 rounded-xl text-base transition-colors"
            >
              Pay {formatPrice(session.amountCents, session.currency)}
            </button>

            <p className="text-xs text-gray-400 text-center">
              🔒 Payments secured by Square. We never store your card details.
            </p>
          </div>
        </div>
      )}

      {/* ── PROCESSING ── */}
      {flowState === "processing" && (
        <StateCard icon="💳" title="Processing payment…" color="sky">
          <Spinner />
          <p className="text-gray-500 text-sm text-center mt-2">Please don't close this page.</p>
        </StateCard>
      )}

      {/* ── STARTING ── */}
      {flowState === "starting" && (
        <StateCard icon="⚡️" title="Payment confirmed!" color="sky">
          <Spinner />
          <p className="text-gray-700 font-medium text-center">Starting your machine…</p>
          <p className="text-gray-400 text-sm text-center mt-1">This usually takes a few seconds.</p>
        </StateCard>
      )}

      {/* ── STARTED ── */}
      {flowState === "started" && machine && (
        <StateCard icon="✅" title="You're all set!" color="green">
          <p className="text-gray-700 text-center font-medium">{machine.name} is running!</p>
          <p className="text-gray-500 text-sm text-center mt-2">
            Your {machine.cycleDurationMinutes}-minute cycle has started.
          </p>
          <div className="mt-4 bg-green-50 rounded-xl p-4 text-center">
            <p className="text-green-600 text-xs font-medium uppercase tracking-wide">Payment successful</p>
            <p className="text-green-800 text-sm mt-1">
              {session && formatPrice(session.amountCents, session.currency)} charged
            </p>
          </div>
          <p className="text-gray-400 text-xs text-center mt-4">
            You can close this page. 🧺
          </p>
        </StateCard>
      )}

      {/* ── FAILED ── */}
      {flowState === "failed" && (
        <StateCard icon="❌" title="Payment failed" color="red">
          <p className="text-gray-600 text-sm text-center">{errorMessage}</p>
          <button
            onClick={() => {
              setFlowState("ready");
              setErrorMessage("");
              setSession(null);
            }}
            className="mt-4 w-full bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
          >
            Try again
          </button>
        </StateCard>
      )}

      {/* ── EXPIRED ── */}
      {flowState === "expired" && (
        <StateCard icon="⏱" title="Session expired" color="yellow">
          <p className="text-gray-600 text-sm text-center">Your payment session timed out. Please tap the tag again to start a new session.</p>
        </StateCard>
      )}

      {/* ── ERROR ── */}
      {flowState === "error" && (
        <StateCard icon="⚠️" title="Something went wrong" color="red">
          <p className="text-gray-600 text-sm text-center">{errorMessage || "An unexpected error occurred."}</p>
          {machine && (
            <button
              onClick={() => {
                setFlowState("ready");
                setErrorMessage("");
                setSession(null);
              }}
              className="mt-4 w-full bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
            >
              Try again
            </button>
          )}
        </StateCard>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function StateCard({
  icon, title, color, children
}: {
  icon: string;
  title: string;
  color: "sky" | "green" | "yellow" | "red";
  children: React.ReactNode;
}) {
  const bgMap = {
    sky:    "from-sky-50 to-sky-100 border-sky-200",
    green:  "from-green-50 to-green-100 border-green-200",
    yellow: "from-yellow-50 to-yellow-100 border-yellow-200",
    red:    "from-red-50 to-red-100 border-red-200",
  };
  return (
    <div className={`bg-gradient-to-b ${bgMap[color]} border rounded-2xl px-6 py-8 flex flex-col items-center gap-3`}>
      <div className="text-5xl">{icon}</div>
      <h2 className="text-lg font-bold text-gray-900 text-center">{title}</h2>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-2">
      <div className="w-7 h-7 border-2 border-sky-400 border-t-transparent rounded-full wash-spin" />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}
