import { Money } from "@/components/domain/money";
import type { Role } from "@/types/firestore";

// The dispute record: every message with who wrote it and any proposed amount. Read-only.
export function DisputeThread({ rounds, names, me }: { rounds: { by: Role; reason: string; proposedCents: number | null; at: string }[]; names: Record<Role, string>; me?: Role }) {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <ol className="space-y-3">
      {rounds.map((r, i) => (
        <li key={`${r.at}-${i}`} className={`max-w-[92%] rounded-[10px] border border-border p-3 ${r.by === me ? "ml-auto bg-primary-soft" : "bg-surface"}`}>
          <p className="t-label text-muted-foreground">
            {r.by === me ? "You" : names[r.by]}, {i === 0 ? "opened the dispute" : `answer ${i}`} · <time dateTime={r.at}>{fmt.format(new Date(r.at))}</time>
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words">{r.reason}</p>
          {r.proposedCents !== null ? (
            <p className="t-small mt-1 text-muted-foreground">
              Proposes <Money cents={r.proposedCents} />
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
