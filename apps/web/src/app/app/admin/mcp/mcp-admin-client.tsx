"use client";

import { Copy, KeyRound, LoaderCircle, RefreshCw, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, type ReactNode } from "react";

import {
  ApiRequestError,
  createMcpOauthClient,
  createMcpPat,
  isUnauthorized,
  listMcpOauthClients,
  listMcpOauthGrants,
  listMcpPats,
  revokeMcpOauthGrant,
  revokeMcpPat,
  updateMcpOauthClient,
  type McpOauthClient,
  type McpOauthGrant,
  type McpPat
} from "@/lib/openkb-api";
import { useI18n } from "@/lib/i18n-provider";

const inputClass =
  "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function McpAdminClient() {
  const router = useRouter();
  const { t } = useI18n();
  const [pats, setPats] = useState<McpPat[]>([]);
  const [clients, setClients] = useState<McpOauthClient[]>([]);
  const [grants, setGrants] = useState<McpOauthGrant[]>([]);
  const [patForm, setPatForm] = useState({
    user_email: "",
    name: "",
    scopes: "kb:read,kb:search,doc:read",
    expires_at: ""
  });
  const [clientForm, setClientForm] = useState({
    client_id: "",
    client_name: "",
    redirect_uris: "",
    allowed_scopes: "kb:read,kb:search,doc:read",
    status: "active"
  });
  const [rawToken, setRawToken] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingPat, setIsCreatingPat] = useState(false);
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setIsLoading(true);
    setMessage("");
    try {
      const [nextPats, nextClients, nextGrants] = await Promise.all([
        listMcpPats({ limit: 100 }),
        listMcpOauthClients({ limit: 100 }),
        listMcpOauthGrants({ limit: 100 })
      ]);
      setPats(nextPats.items);
      setClients(nextClients.items);
      setGrants(nextGrants.items);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function createPat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreatingPat(true);
    setRawToken("");
    setMessage("");
    try {
      const result = await createMcpPat({
        user_email: patForm.user_email.trim(),
        name: patForm.name.trim(),
        scopes: parseCsv(patForm.scopes),
        expires_at: patForm.expires_at || null
      });
      setRawToken(result.token ?? "");
      setPatForm({
        user_email: "",
        name: "",
        scopes: "kb:read,kb:search,doc:read",
        expires_at: ""
      });
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setIsCreatingPat(false);
    }
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreatingClient(true);
    setMessage("");
    try {
      await createMcpOauthClient({
        client_id: clientForm.client_id.trim() || undefined,
        client_name: clientForm.client_name.trim(),
        redirect_uris: parseCsv(clientForm.redirect_uris),
        allowed_scopes: parseCsv(clientForm.allowed_scopes),
        status: clientForm.status
      });
      setClientForm({
        client_id: "",
        client_name: "",
        redirect_uris: "",
        allowed_scopes: "kb:read,kb:search,doc:read",
        status: "active"
      });
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setIsCreatingClient(false);
    }
  }

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setMessage("");
    try {
      await action();
      await load();
    } catch (error) {
      handleError(error);
    } finally {
      setBusyId(null);
    }
  }

  async function copyToken() {
    if (!rawToken) return;
    await navigator.clipboard.writeText(rawToken);
    setMessage(t("Secret copied."));
  }

  function handleError(error: unknown) {
    if (isUnauthorized(error)) {
      router.replace("/login");
      return;
    }
    if (error instanceof ApiRequestError && error.status === 403) {
      setMessage(error.body.message || t("Admin role is required."));
      return;
    }
    setMessage(error instanceof Error ? error.message : t("Request failed."));
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-500">{t("Admin")}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t("MCP")}</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {t("Manage MCP personal access tokens, OAuth clients, and grants.")}
          </p>
        </div>
        <button
          className="icon-button"
          onClick={() => void load()}
          title={t("Refresh")}
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {rawToken ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">{t("PAT token shown once")}</div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <code className="max-w-full overflow-auto rounded bg-white px-2 py-1 text-xs">
              {rawToken}
            </code>
            <button
              className="icon-button"
              onClick={() => void copyToken()}
              title={t("Copy")}
              type="button"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <form className="rounded-md border border-zinc-200 bg-white p-4" onSubmit={createPat}>
          <h2 className="text-sm font-semibold">{t("Create MCP PAT")}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextInput
              label={t("User email")}
              onChange={(value) => setPatForm({ ...patForm, user_email: value })}
              value={patForm.user_email}
            />
            <TextInput
              label={t("Name")}
              onChange={(value) => setPatForm({ ...patForm, name: value })}
              value={patForm.name}
            />
            <TextInput
              label={t("Scopes")}
              onChange={(value) => setPatForm({ ...patForm, scopes: value })}
              value={patForm.scopes}
            />
            <TextInput
              label={t("Expires at")}
              onChange={(value) => setPatForm({ ...patForm, expires_at: value })}
              type="datetime-local"
              value={patForm.expires_at}
            />
          </div>
          <button
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
            disabled={isCreatingPat}
            type="submit"
          >
            {isCreatingPat ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {t("Create PAT")}
          </button>
        </form>

        <form className="rounded-md border border-zinc-200 bg-white p-4" onSubmit={createClient}>
          <h2 className="text-sm font-semibold">{t("Create OAuth client")}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <TextInput
              label={t("Client id optional")}
              onChange={(value) => setClientForm({ ...clientForm, client_id: value })}
              value={clientForm.client_id}
            />
            <TextInput
              label={t("Client name")}
              onChange={(value) => setClientForm({ ...clientForm, client_name: value })}
              value={clientForm.client_name}
            />
            <TextInput
              label={t("Redirect URIs")}
              onChange={(value) => setClientForm({ ...clientForm, redirect_uris: value })}
              value={clientForm.redirect_uris}
            />
            <TextInput
              label={t("Allowed scopes")}
              onChange={(value) => setClientForm({ ...clientForm, allowed_scopes: value })}
              value={clientForm.allowed_scopes}
            />
          </div>
          <button
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white disabled:bg-zinc-400"
            disabled={isCreatingClient}
            type="submit"
          >
            {isCreatingClient ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {t("Create client")}
          </button>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Panel title={t("PATs")}>
          {pats.map((pat) => (
            <article className="rounded-md border border-zinc-200 p-3 text-sm" key={pat.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{pat.name}</strong>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">{pat.status}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{pat.user?.email ?? pat.user_id}</p>
              <p className="mt-1 text-xs text-zinc-500">{pat.scopes.join(", ")}</p>
              <SmallButton
                disabled={busyId === pat.id}
                onClick={() => run(pat.id, () => revokeMcpPat(pat.id))}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                {t("Revoke")}
              </SmallButton>
            </article>
          ))}
          {!pats.length && !isLoading ? <Empty>{t("No PATs")}</Empty> : null}
        </Panel>

        <Panel title={t("OAuth clients")}>
          {clients.map((client) => (
            <article className="rounded-md border border-zinc-200 p-3 text-sm" key={client.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{client.client_name}</strong>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">
                  {client.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{client.client_id}</p>
              <p className="mt-1 text-xs text-zinc-500">{client.allowed_scopes.join(", ")}</p>
              <SmallButton
                disabled={busyId === client.id}
                onClick={() =>
                  run(client.id, () => updateMcpOauthClient(client.id, { status: "disabled" }))
                }
              >
                <ShieldOff className="h-3.5 w-3.5" />
                {t("Disable")}
              </SmallButton>
            </article>
          ))}
          {!clients.length && !isLoading ? <Empty>{t("No OAuth clients")}</Empty> : null}
        </Panel>

        <Panel title={t("OAuth grants")}>
          {grants.map((grant) => (
            <article className="rounded-md border border-zinc-200 p-3 text-sm" key={grant.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{grant.client_id}</strong>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">{grant.status}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{grant.user?.email ?? grant.user_id}</p>
              <p className="mt-1 text-xs text-zinc-500">{grant.scopes.join(", ")}</p>
              <SmallButton
                disabled={busyId === grant.id}
                onClick={() => run(grant.id, () => revokeMcpOauthGrant(grant.id))}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                {t("Revoke")}
              </SmallButton>
            </article>
          ))}
          {!grants.length && !isLoading ? <Empty>{t("No OAuth grants")}</Empty> : null}
        </Panel>
      </section>
      {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
    </div>
  );
}

function TextInput({
  label,
  onChange,
  type = "text",
  value
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-700">{label}</span>
      <input
        className={inputClass}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function SmallButton({
  children,
  disabled,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="mt-2 inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-500">{children}</div>;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
