import type { Metadata } from "next";
import { Suspense } from "react";
import { Callback } from "./callback";

export const metadata: Metadata = { title: "Connecting PayPal" };

export default function PayPalCallbackPage() {
  return (
    <main id="main" tabIndex={-1} className="outline-none mx-auto max-w-md px-4 py-16">
      <Suspense>
        <Callback />
      </Suspense>
    </main>
  );
}
