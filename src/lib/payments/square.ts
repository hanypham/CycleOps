/**
 * SquareProvider — Square Payments implementation.
 *
 * Uses the Square Node.js SDK.
 * Supports: Apple Pay, Google Pay, manual card entry (via Square Web Payments SDK on frontend).
 * Australia: Square supports AUD and Australian merchant accounts.
 */

import {
  Client,
  Environment,
  ApiError,
} from "square";
import crypto from "crypto";
import type {
  PaymentProvider,
  ChargePaymentParams,
  VerifyPaymentResult,
  RefundPaymentResult,
  WebhookResult,
} from "./types";

function getSquareClient() {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) throw new Error("SQUARE_ACCESS_TOKEN is not set");

  const environment =
    process.env.SQUARE_ENVIRONMENT === "production"
      ? Environment.Production
      : Environment.Sandbox;

  return new Client({ accessToken, environment });
}

export class SquareProvider implements PaymentProvider {
  readonly name = "square";

  private get locationId(): string {
    const id = process.env.SQUARE_LOCATION_ID;
    if (!id) throw new Error("SQUARE_LOCATION_ID is not set");
    return id;
  }

  // ─── Charge ──────────────────────────────────────────────────────────────

  async chargePayment(params: ChargePaymentParams): Promise<VerifyPaymentResult> {
    const client = getSquareClient();
    const { paymentsApi } = client;

    try {
      const response = await paymentsApi.createPayment({
        sourceId: params.sourceId,
        idempotencyKey: params.idempotencyKey,
        amountMoney: {
          amount: BigInt(params.amountCents),
          currency: params.currency,
        },
        locationId: this.locationId,
        note: params.note ?? "CycleOps — Laundry Cycle",
      });

      const payment = response.result.payment;
      if (!payment || !payment.id) {
        return {
          success: false,
          providerTransactionId: "",
          amountCents: params.amountCents,
          currency: params.currency,
          status: "FAILED",
        };
      }

      return {
        success: payment.status === "COMPLETED",
        providerTransactionId: payment.id,
        amountCents: Number(payment.amountMoney?.amount ?? params.amountCents),
        currency: payment.amountMoney?.currency ?? params.currency,
        status: payment.status === "COMPLETED" ? "COMPLETED" : "FAILED",
      };
    } catch (err) {
      if (err instanceof ApiError) {
        console.error("[Square] chargePayment error:", err.errors);
      }
      return {
        success: false,
        providerTransactionId: "",
        amountCents: params.amountCents,
        currency: params.currency,
        status: "FAILED",
      };
    }
  }

  // ─── Verify ───────────────────────────────────────────────────────────────

  async verifyPayment(providerPaymentId: string): Promise<VerifyPaymentResult> {
    const client = getSquareClient();
    const { paymentsApi } = client;

    try {
      const response = await paymentsApi.getPayment(providerPaymentId);
      const payment = response.result.payment;

      if (!payment) {
        return {
          success: false,
          providerTransactionId: providerPaymentId,
          amountCents: 0,
          currency: "AUD",
          status: "FAILED",
        };
      }

      return {
        success: payment.status === "COMPLETED",
        providerTransactionId: payment.id!,
        amountCents: Number(payment.amountMoney?.amount ?? 0),
        currency: payment.amountMoney?.currency ?? "AUD",
        status: payment.status === "COMPLETED" ? "COMPLETED" : "FAILED",
      };
    } catch (err) {
      if (err instanceof ApiError) {
        console.error("[Square] verifyPayment error:", err.errors);
      }
      return {
        success: false,
        providerTransactionId: providerPaymentId,
        amountCents: 0,
        currency: "AUD",
        status: "FAILED",
      };
    }
  }

  // ─── Refund ───────────────────────────────────────────────────────────────

  async refundPayment(
    providerTransactionId: string,
    amountCents: number
  ): Promise<RefundPaymentResult> {
    const client = getSquareClient();
    const { refundsApi } = client;

    try {
      const response = await refundsApi.refundPayment({
        paymentId: providerTransactionId,
        idempotencyKey: `refund-${providerTransactionId}`,
        amountMoney: {
          amount: BigInt(amountCents),
          currency: "AUD",
        },
        reason: "CycleOps refund",
      });

      const refund = response.result.refund;
      return {
        success: refund?.status === "COMPLETED" || refund?.status === "PENDING",
        providerRefundId: refund?.id ?? "",
      };
    } catch (err) {
      if (err instanceof ApiError) {
        console.error("[Square] refundPayment error:", err.errors);
      }
      return { success: false, providerRefundId: "" };
    }
  }

  // ─── Webhook ──────────────────────────────────────────────────────────────

  async receiveWebhook(
    rawBody: string,
    headers: Record<string, string>
  ): Promise<WebhookResult> {
    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (!signatureKey) throw new Error("SQUARE_WEBHOOK_SIGNATURE_KEY is not set");

    // Square signature verification
    const signature = headers["x-square-hmacsha256-signature"] || headers["x-square-signature"];
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const notificationUrl = `${appUrl}/api/payment-webhooks/square`;

    const expectedSig = crypto
      .createHmac("sha256", signatureKey)
      .update(notificationUrl + rawBody)
      .digest("base64");

    if (signature !== expectedSig) {
      throw new Error("Square webhook signature verification failed");
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const eventId = payload.event_id as string;
    const eventType = payload.type as string;

    // Extract payment ID from the event
    const data = payload.data as Record<string, unknown>;
    const object = data?.object as Record<string, unknown>;
    const paymentObj = object?.payment as Record<string, unknown>;
    const paymentId = paymentObj?.id as string;
    const paymentStatus = paymentObj?.status as string;

    return {
      eventId,
      eventType,
      paymentId: paymentId ?? "",
      success: eventType === "payment.updated" && paymentStatus === "COMPLETED",
      rawPayload: payload,
    };
  }
}
