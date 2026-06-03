/**
 * Payment provider factory.
 * Returns the active PaymentProvider based on environment config.
 * To swap providers, change PAYMENT_PROVIDER env var — nothing else changes.
 */

import type { PaymentProvider } from "./types";
import { SquareProvider } from "./square";

export type { PaymentProvider, VerifyPaymentResult, WebhookResult } from "./types";

const providers: Record<string, () => PaymentProvider> = {
  square: () => new SquareProvider(),
  // Future providers — uncomment when implemented:
  // stripe: () => new StripeProvider(),
  // tyro: () => new TyroProvider(),
  // windcave: () => new WindcaveProvider(),
  // latpay: () => new LatpayProvider(),
};

export function getPaymentProvider(name?: string): PaymentProvider {
  const providerName = name ?? process.env.PAYMENT_PROVIDER ?? "square";
  const factory = providers[providerName];
  if (!factory) {
    throw new Error(`Unknown payment provider: ${providerName}`);
  }
  return factory();
}
