import { Logo } from "@/components/layout/logo";
import { SignOutButton } from "@/components/layout/sign-out-button";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
        <Logo href="/onboarding" />
        <SignOutButton variant="ghost" />
      </header>
      <main id="main" tabIndex={-1} className="outline-none mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-2 sm:px-6 sm:pb-12">{children}</main>
    </div>
  );
}
