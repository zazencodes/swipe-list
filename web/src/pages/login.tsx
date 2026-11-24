import { useState, type FormEvent } from "react";
import { AlertCircleIcon, ArrowLeftIcon, Loader2Icon, MailIcon } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { authAttempt, authClient } from "@/lib/auth";

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const failure = await authAttempt(() => authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" }));
    setBusy(false);
    if (failure) return setError(failure);
    setCode("");
    setStep("code");
    setNotice(`We sent a 6-digit code to ${email.trim()}.`);
  }

  async function verify(otp: string) {
    setBusy(true);
    setError(null);
    const failure = await authAttempt(() => authClient.signIn.emailOtp({ email: email.trim(), otp }));
    setBusy(false);
    if (failure) {
      setCode("");
      return setError(failure);
    }
    onSignedIn();
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden border-r bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="font-semibold tracking-tight">Swipe List</span>
        </div>
        <SwipeArt />
        <p className="max-w-sm text-sm text-muted-foreground">
          Save what catches your eye. The worker pulls the media; you find it again when you need it.
        </p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex items-center gap-3 lg:hidden">
            <BrandMark />
            <span className="font-semibold tracking-tight">Swipe List</span>
          </div>

          <div className="space-y-1.5">
            <p className="eyebrow">Sign in</p>
            <h1 className="text-2xl font-semibold tracking-tight">{step === "email" ? "Welcome back" : "Check your email"}</h1>
            <p className="text-sm text-muted-foreground">
              {step === "email" ? "We will email you a one-time code. No password needed." : notice}
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === "email" ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-10"
                />
              </div>
              <Button type="submit" className="h-10 w-full" disabled={busy || !email.trim()}>
                {busy ? <Loader2Icon className="animate-spin" /> : <MailIcon />}
                Send code
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 6) void verify(code);
              }}
              className="space-y-5"
            >
              <div className="space-y-2">
                <Label htmlFor="otp">6-digit code</Label>
                <InputOTP
                  id="otp"
                  maxLength={6}
                  value={code}
                  onChange={setCode}
                  onComplete={(value: string) => void verify(value)}
                  disabled={busy}
                  autoFocus
                  inputMode="numeric"
                  pattern="^[0-9]+$"
                >
                  <InputOTPGroup>
                    {Array.from({ length: 6 }, (_, i) => (
                      <InputOTPSlot key={i} index={i} className="size-11 text-base" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button type="submit" className="h-10 w-full" disabled={busy || code.length !== 6}>
                {busy && <Loader2Icon className="animate-spin" />}
                Sign in
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0 text-muted-foreground"
                  onClick={() => {
                    setStep("email");
                    setError(null);
                  }}
                >
                  <ArrowLeftIcon />
                  Different email
                </Button>
                <Button type="button" variant="link" className="h-auto px-0" disabled={busy} onClick={() => void sendCode()}>
                  Send a new code
                </Button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

/** A faint contact sheet of saved cards: decorative, aria-hidden. */
function SwipeArt() {
  const cards: [string, string][] = [
    ["Glass logo concept", "x.com"],
    ["Launch film, 3D geometry", "x.com"],
    ["Dark gradient hero", "linear.app"],
    ["Pricing card grid", "upload"],
    ["Album art wall", "apple.com"],
    ["Type specimen", "upload"],
  ];
  return (
    <div aria-hidden className="pointer-events-none my-10 grid grid-cols-3 gap-3 select-none text-xs text-muted-foreground/70">
      {cards.map(([title, site], i) => (
        <div key={title} className="rounded-md border border-foreground/10 bg-background/40 p-2">
          <div className="rounded-sm bg-foreground/[0.06]" style={{ aspectRatio: i % 3 === 1 ? "3 / 4" : "4 / 3" }} />
          <p className="mt-2 truncate">{title}</p>
          <p className="truncate font-mono text-[10px] uppercase tracking-wider opacity-70">{site}</p>
        </div>
      ))}
    </div>
  );
}
