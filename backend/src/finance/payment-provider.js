import { createHmac, timingSafeEqual } from "node:crypto";

// V2-05-05 — payment service-provider contract. A provider implements:
//   createCharge({ topUpNo, amountMinor, currency, channel }) -> { providerTxnId, redirectUrl, channelStatus }
//   queryCharge(providerTxnId) -> { channelStatus }
//   refund({ providerTxnId, amountMinor }) -> { refundId, channelStatus }
//   verifyWebhook({ body, signature }) -> { valid, event }
// No card or wallet secret is ever returned or logged; only opaque provider ids
// and coarse channel statuses cross this seam. The webhook is signed over a
// deterministic (key-sorted) serialization of the parsed body, so it works
// through express.json without needing the raw bytes.

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function sign(secret, body) {
  return createHmac("sha256", secret).update(stableStringify(body)).digest("base64url");
}

export function verifyWebhookSignature(secret, body, signature) {
  if (!secret || !signature) return false;
  const a = Buffer.from(sign(secret, body), "base64url");
  const b = Buffer.from(String(signature), "base64url");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Deterministic dev/test provider — never a real charge. It maps a top-up to a
// stable opaque provider id and a fake redirect URL, and verifies webhooks with
// the shared secret. Swap for a licensed provider in production.
export function createStubPaymentProvider({ secret = "dev-secret" } = {}) {
  return {
    name: "stub",
    async createCharge({ topUpNo, amountMinor, currency, channel }) {
      return {
        providerTxnId: `stub_${topUpNo}`,
        redirectUrl: `https://pay.example.test/checkout/${encodeURIComponent(topUpNo)}`,
        channelStatus: "pending",
        echo: { amountMinor, currency, channel }
      };
    },
    async queryCharge(providerTxnId) {
      return { providerTxnId, channelStatus: "pending" };
    },
    async refund({ providerTxnId, amountMinor }) {
      return { refundId: `stub_refund_${providerTxnId}`, amountMinor, channelStatus: "refunded" };
    },
    // body is the parsed webhook payload; the signature covers its stable form.
    verifyWebhook({ body, signature }) {
      if (!body || !verifyWebhookSignature(secret, body, signature)) {
        return { valid: false, event: null };
      }
      return {
        valid: true,
        event: {
          providerTxnId: body.provider_txn_id,
          amountMinor: Number(body.amount_minor),
          currency: body.currency,
          status: body.status,
          userRef: body.user_ref,
          topUpNo: body.top_up_no
        }
      };
    },
    // Test/helper: produce a valid signature for a payload.
    signBody(body) {
      return sign(secret, body);
    }
  };
}

// Default when no provider is licensed/configured: creation degrades explicitly
// instead of pretending to charge.
export function createNotConfiguredPaymentProvider() {
  return {
    name: "not_configured",
    async createCharge() {
      const error = new Error("No payment provider is configured.");
      error.code = "PROVIDER_NOT_CONFIGURED";
      throw error;
    },
    async queryCharge() {
      return { channelStatus: "not_configured" };
    },
    async refund() {
      const error = new Error("No payment provider is configured.");
      error.code = "PROVIDER_NOT_CONFIGURED";
      throw error;
    },
    verifyWebhook() {
      return { valid: false, event: null };
    }
  };
}
