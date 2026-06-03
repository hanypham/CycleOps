/**
 * PaymentProvider — abstract interface.
 *
 * All payment logic routes through this interface.
 * Machine control never knows which provider is active.
 * To add a new provider (Stripe, Tyro, etc.), implement this interface.
 */

export interface CreatePaymentResult {
  providerPaymentId: string;    // Provider's internal payment/order ID
  clientSecret?: string;        // For client-side SDK initialisation (if needed)
  redirectUrl?: string;         // For redirect-based flows (if needed)
}

export interface VerifyPaymentResult {
  success: boolean;
  providerTransactionId: string;
  amountCents: number;
  currency: string;
  status: "COMPLETED" | "FAILED" | "PENDING";
}

export interface RefundPaymentResult {
  success: boolean;
  providerRefundId: string;
}

export interface WebhookResult {
  eventId: string;              // Provider's unique event ID (for idempotency)
  eventType: string;            // e.g. "payment.completed"
  paymentId: string;            // Provider's payment/order ID
  success: boolean;             // Was this a successful payment?
  rawPayload: Record<string, unknown>;
}

export interface ChargePaymentParams {
  sourceId: string;             // Square nonce / Stripe token
  amountCents: number;
  currency: string;
  idempotencyKey: string;       // Session ID — prevents double-charging
  note?: string;
}

export interface PaymentProvider {
  readonly name: string;

  /**
   * Charge a payment using a client-side tokenised payment method.
   * Called when the frontend sends a nonce/token to the backend.
   */
  chargePayment(params: ChargePaymentParams): Promise<VerifyPaymentResult>;

  /**
   * Verify the status of an existing payment by provider ID.
   */
  verifyPayment(providerPaymentId: string): Promise<VerifyPaymentResult>;

  /**
   * Refund a completed payment.
   */
  refundPayment(providerTransactionId: string, amountCents: number): Promise<RefundPaymentResult>;

  /**
   * Parse and verify an inbound webhook event.
   * Throws if signature verification fails.
   */
  receiveWebhook(
    rawBody: string,
    headers: Record<string, string>
  ): Promise<WebhookResult>;
}
