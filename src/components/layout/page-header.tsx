import { cn } from "cn";

export function PageHeader({ title, description, action, className }: { title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="t-h1 text-balance">{title}</h1>
        {description ? <p className="mt-1.5 max-w-prose text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  );
}
