"use client";

import { cn } from "cn";

// Segmented choice built from native radio inputs (keyboard and screen readers work as usual).

export function Segmented<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  className,
}: {
  name: string;
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-[10px] bg-surface-2 p-1">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center justify-center rounded-md px-3 text-center text-sm transition-[background-color,color,box-shadow] duration-150 has-focus-visible:outline-2 has-focus-visible:outline-ring",
              value === o.value ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(21_32_30/0.08),0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input type="radio" className="sr-only" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
