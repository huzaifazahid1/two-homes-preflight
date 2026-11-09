import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { buttonVariants } from "@/components/ui/button";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Logo compact />
        <nav aria-label="Main" className="flex items-center gap-1">
          <Link href="/pricing" className="hidden min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:text-foreground sm:inline-flex">
            Pricing
          </Link>
          <Link href="/login" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
          <Link href="/signup" className={buttonVariants({ className: "h-10 px-4" })}>
            Get started
          </Link>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Sandbox demo for the PayPal AI Hackathon 2026. All data is synthetic. Not legal advice.</p>
          <nav aria-label="Footer" className="flex gap-4">
            <Link className="hover:text-foreground" href="/pricing">Pricing</Link>
            <Link className="hover:text-foreground" href="/legal/terms">Terms</Link>
            <Link className="hover:text-foreground" href="/legal/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
