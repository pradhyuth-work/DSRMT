"use client";

import { useState } from "react";
import { Loader2, LogIn, ReceiptText } from "lucide-react";
import type { AuthUser } from "@/lib/types";
import { api } from "./api-client";
import { Alert } from "./ui";

export default function LoginScreen({
  notice,
  onLogin,
}: {
  notice: string | null;
  onLogin: (token: string, user: AuthUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.login({ username, password });
      onLogin(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-xl bg-indigo-600 p-3 text-white">
            <ReceiptText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">DSRMT Billing</h1>
            <p className="text-sm text-slate-500">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-5">
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
            <label className="label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <Alert kind="error">{error}</Alert>}
          <button type="submit" className="btn btn-primary w-full" disabled={busy || !username || !password}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in
          </button>
        </form>
        <p className="text-center text-xs text-slate-500">Accounts are created by an admin. Ask them if you can&apos;t sign in.</p>
      </div>
    </div>
  );
}
