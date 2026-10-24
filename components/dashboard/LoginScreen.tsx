"use client";

import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import type { AuthUser } from "@/lib/types";
import { api } from "./api-client";
import { Alert } from "./ui";
import { BrandTile } from "./BrandMark";
import { LoginBackdrop, Typewriter, LiveStatus, PinBars } from "./LoginFx";

export default function LoginScreen({
  notice,
  onLogin,
}: {
  notice: string | null;
  onLogin: (token: string, user: AuthUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.login({ username, pin });
      onLogin(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setErrorCount((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <div className="login-bg flex min-h-screen items-center justify-center px-4 py-10">
      <LoginBackdrop />
      <div className="login-rise relative z-10 w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="login-tile rounded-xl">
            <BrandTile size={56} />
          </div>
          <div className="relative">
            <h1 className="text-xl font-semibold">Varasidhi Enterprises</h1>
            <p className="font-mono-app text-[9px] uppercase tracking-[.2em] text-muted-foreground/70 login-sub">MT &middot; billing &amp; dispatch</p>
            <p className="mt-2 text-sm text-muted-foreground login-sub"><Typewriter /></p>
            <LiveStatus />
          </div>
        </div>

        <form key={errorCount} onSubmit={submit} className={`card space-y-4 p-5${errorCount > 0 ? " login-shake" : ""}`}>
          {notice && <Alert kind="warning">{notice}</Alert>}
          <div>
            <label className="label" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="login-pin">PIN</label>
            <div className="relative">
              <input
                id="login-pin"
                type="password"
                className="input"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                autoComplete="current-password"
                required
              />
              <PinBars length={pin.length} />
            </div>
          </div>
          {error && <Alert kind="error">{error}</Alert>}
          <button type="submit" className="btn btn-primary w-full" disabled={busy || !username || !pin}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in
          </button>
        </form>
        <p className="login-note text-center text-xs text-muted-foreground">Accounts are created by an admin. Ask them if you can&apos;t sign in.</p>
      </div>
    </div>
  );
}
