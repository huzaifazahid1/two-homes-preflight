"use client";

import { cn } from "cn";
import { useRef } from "react";

// 6-digit one-time code input. One field per digit, paste-friendly, numeric keyboard,
// autocomplete="one-time-code" so phones can fill it from the email/SMS banner.

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  id = "otp",
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  function setAt(index: number, chars: string) {
    const clean = chars.replace(/\D/g, "");
    if (!clean) return;
    const next = (value.slice(0, index) + clean + value.slice(index + clean.length)).slice(0, 6);
    onChange(next);
    const focusIndex = Math.min(index + clean.length, 5);
    refs.current[focusIndex]?.focus();
    if (next.length === 6) onComplete?.(next);
  }

  return (
    <div className="flex gap-2" role="group" aria-label="One-time code, 6 digits">
      {digits.map((d, i) => (
        <input
          key={i}
          id={i === 0 ? id : undefined}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          pattern="[0-9]*"
          maxLength={6}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          className={cn(
            "h-14 w-11 rounded-lg border border-input bg-surface text-center font-mono text-2xl tabular-nums outline-none transition-colors",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50",
            "aria-invalid:border-destructive",
          )}
          onChange={(e) => setAt(i, e.target.value.slice(-6))}
          onPaste={(e) => {
            e.preventDefault();
            setAt(0, e.clipboardData.getData("text"));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              if (d) onChange(value.slice(0, i) + value.slice(i + 1));
              else if (i > 0) {
                onChange(value.slice(0, i - 1) + value.slice(i));
                refs.current[i - 1]?.focus();
              }
            } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}
