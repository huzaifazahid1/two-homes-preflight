"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useState } from "react";
import { Money } from "@/components/domain/money";
import { PayPalFrame } from "@/components/payments/paypal-frame";
import { api, ApiError, errorMessage } from "@/hooks/api";
import { publicEnv } from "@/lib/public-env";
import type { FeeBreakdown } from "@/types/views";

// PayPal Buttons for the payer's share (Section G.3). The server creates the order (amount from
// the server only) and captures it; the browser only passes the order id back. The PayPal SDK is
// loaded on this component only (P.11).

type Result = { state: string; status: "COMPLETED" | "PENDING" | "DECLINED" };

export function PayPalCheckout({ token, breakdown, receiver, onDone }: { token: string; breakdown: FeeBreakdown; receiver: string; onDone: () => Promise<void> }) {
  const [note, setNote] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section aria-labelledby="pay-h" className="space-y-4 rounded-[14px] border border-border bg-surface p-5">
      <h2 id="pay-h" className="t-h3">Pay {receiver} with PayPal</h2>
      <dl className="space-y-2 text-[15px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Your share</dt>
          <dd><Money cents={breakdown.owedCents} /></dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">
            Processing fee
            {breakdown.feeLineCents > 0 ? (
              <span className="t-small block">
                The plan covers fees on <Money cents={breakdown.coveredCents} /> this month; this is the estimate for the rest.
              </span>
            ) : (
              <span className="t-small block">Covered by the Family plan</span>
            )}
          </dt>
          <dd><Money cents={breakdown.feeLineCents} /></dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 font-medium">
          <dt>Total</dt>
          <dd><Money cents={breakdown.totalCents} /></dd>
        </div>
      </dl>
      <p className="t-small text-muted-foreground">
        {receiver} receives exactly <Money cents={breakdown.owedCents} /> in their PayPal account.
      </p>

      <div aria-live="polite">
        {note ? <p className={`t-small rounded-md px-3 py-2 ${note.kind === "error" ? "bg-danger-bg text-danger" : "bg-surface-2 text-muted-foreground"}`}>{note.text}</p> : null}
        {busy ? <p className="t-small text-muted-foreground">Confirming the payment with PayPal…</p> : null}
      </div>

      <PayPalScriptProvider
        options={{ clientId: publicEnv().NEXT_PUBLIC_PAYPAL_CLIENT_ID, currency: "USD", intent: "capture", components: "buttons", disableFunding: "paylater,credit" }}
        deferLoading={false}
      >
        <PayPalFrame>
          <PayPalButtons
            style={{ layout: "vertical", shape: "rect", label: "pay", height: 48 }}
            disabled={busy}
            createOrder={async () => {
              setNote(null);
              try {
                const r = await api<{ orderId: string }>(`/api/links/${token}/orders`, { method: "POST", body: {}, redirectOn401: false });
                return r.orderId;
              } catch (e) {
                setNote({ kind: "error", text: errorWithId(e) });
                throw e;
              }
            }}
            onApprove={async (data, actions) => {
              setBusy(true);
              try {
                const r = await api<Result>(`/api/links/${token}/orders/${data.orderID}/capture`, { method: "POST", redirectOn401: false });
                if (r.status === "PENDING") setNote({ kind: "info", text: "PayPal is still processing this payment. This page updates when it is confirmed." });
                await onDone();
              } catch (e) {
                if (e instanceof ApiError && e.details?.restart) {
                  // INSTRUMENT_DECLINED: PayPal asks the payer to choose another way to pay.
                  setNote({ kind: "error", text: "PayPal declined that payment method. Choose another one." });
                  setBusy(false);
                  return actions.restart();
                }
                setNote({ kind: "error", text: errorWithId(e) });
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => setNote({ kind: "info", text: "Payment cancelled. Nothing was charged." })}
            onError={() => setNote((n) => n ?? { kind: "error", text: "PayPal could not start the payment. Nothing was charged. Please try again." })}
          />
        </PayPalFrame>
      </PayPalScriptProvider>
    </section>
  );
}

function errorWithId(e: unknown) {
  const id = e instanceof ApiError && e.requestId ? ` (reference ${e.requestId})` : "";
  return `${errorMessage(e)}${id}`;
}
