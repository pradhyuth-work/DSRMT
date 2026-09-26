"use client";

import { useCallback, useState } from "react";
import { KeyRound, Loader2, UserPlus, UserRound } from "lucide-react";
import type { AuthUser, Role, StaffDTO } from "@/lib/types";
import { api } from "./api-client";
import { Alert, EmptyState, Modal } from "./ui";

const ROLES: { id: Role; label: string }[] = [
  { id: "admin", label: "Admin" },
  { id: "stock", label: "Stock incharge" },
  { id: "agent", label: "Field agent" },
];

export default function UsersManager({
  staff,
  user,
  onSaved,
  onOwnTokenChanged,
}: {
  staff: StaffDTO[];
  user: AuthUser;
  onSaved: () => Promise<void>;
  onOwnTokenChanged: (token: string) => void;
}) {
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<StaffDTO | null>(null);
  const closeCredentials = useCallback(() => setCredentialsFor(null), []);

  async function update(s: StaffDTO, patch: { role?: Role; active?: boolean }, text: string) {
    setBusyId(s.id);
    setMessage(null);
    try {
      await api.updateStaff(s.id, patch);
      setMessage({ kind: "success", text });
      await onSaved();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Update failed" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <CreateUserForm
        onSaved={async (text) => {
          setMessage({ kind: "success", text });
          await onSaved();
        }}
      />

      <div className="space-y-3 lg:col-span-2">
        {message && <Alert kind={message.kind}>{message.text}</Alert>}
        {staff.length === 0 && (
          <div className="card">
            <EmptyState>No users yet.</EmptyState>
          </div>
        )}
        {staff.map((s) => {
          const isMe = s.id === user.id;
          const busy = busyId === s.id;
          return (
            <div key={s.id} className={`card space-y-3 p-4 ${s.active ? "" : "opacity-70"}`}>
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-secondary p-2 text-primary">
                  <UserRound className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <span className="truncate">{s.name}</span>
                    {isMe && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-primary">You</span>}
                    {!s.active && <span className="rounded-full bg-danger px-2 py-0.5 text-xs text-danger-foreground">Disabled</span>}
                    {!s.canLogin && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">No login</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.username ? `@${s.username}` : "No username"}
                    {s.phone && <> · {s.phone}</>}
                  </p>
                </div>
                {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  className="input"
                  value={s.role}
                  disabled={isMe || busy}
                  title={isMe ? "You can't change your own role" : undefined}
                  onChange={(e) => {
                    const role = e.target.value as Role;
                    void update(s, { role }, `${s.name} is now ${ROLES.find((r) => r.id === role)?.label ?? role}`);
                  }}
                  aria-label={`Role for ${s.name}`}
                >
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary"
                  disabled={isMe || busy}
                  title={isMe ? "You can't disable your own account" : undefined}
                  onClick={() =>
                    void update(s, { active: !s.active }, `${s.name} ${s.active ? "disabled" : "enabled"}`)
                  }
                >
                  {s.active ? "Disable" : "Enable"}
                </button>
                <button className="btn btn-secondary" disabled={busy} onClick={() => setCredentialsFor(s)}>
                  <KeyRound className="h-4 w-4" />
                  {s.canLogin ? "Reset password" : "Set up login"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!credentialsFor}
        title={credentialsFor ? `${credentialsFor.canLogin ? "Reset password" : "Set up login"} — ${credentialsFor.name}` : ""}
        onClose={closeCredentials}
      >
        {credentialsFor && (
          <CredentialsForm
            key={credentialsFor.id}
            person={credentialsFor}
            onDone={async (text, token) => {
              if (token && credentialsFor.id === user.id) onOwnTokenChanged(token);
              setCredentialsFor(null);
              setMessage({ kind: "success", text });
              await onSaved();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function CredentialsForm({
  person,
  onDone,
}: {
  person: StaffDTO;
  onDone: (message: string, token?: string) => Promise<void>;
}) {
  const [username, setUsername] = useState(person.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = username.trim().length >= 3 && password.length >= 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const wanted = username.trim().toLowerCase();
      if (wanted !== person.username) await api.updateStaff(person.id, { username: wanted });
      const { token } = await api.resetPassword(person.id, password);
      await onDone(
        person.canLogin ? `Password reset for ${person.name}. Their other sessions were signed out.` : `${person.name} can now sign in as @${wanted}`,
        token,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="cred-username">Username</label>
        <input
          id="cred-username"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <div>
        <label className="label" htmlFor="cred-password">New password</label>
        <input
          id="cred-password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          autoFocus
        />
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Save
      </button>
    </form>
  );
}

function CreateUserForm({ onSaved }: { onSaved: (text: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0 && username.trim().length >= 3 && password.length >= 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createStaff({ name: name.trim(), phone: phone.trim(), username: username.trim(), password, role });
      setName("");
      setPhone("");
      setUsername("");
      setPassword("");
      setRole("agent");
      await onSaved(`Created ${created.name} (@${created.username})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card h-fit space-y-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <UserPlus className="h-5 w-5 text-primary" /> Add user
      </h2>
      <div>
        <label className="label" htmlFor="u-name">Name</label>
        <input id="u-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="u-phone">Phone</label>
        <input id="u-phone" type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
      </div>
      <div>
        <label className="label" htmlFor="u-username">Username</label>
        <input
          id="u-username"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <div>
        <label className="label" htmlFor="u-password">Password</label>
        <input
          id="u-password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="At least 8 characters"
        />
      </div>
      <div>
        <label className="label" htmlFor="u-role">Role</label>
        <select id="u-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary w-full" disabled={!valid || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
        Create user
      </button>
    </form>
  );
}
