"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n-provider";
import {
  ApiRequestError,
  getShare,
  isUnauthorized,
  verifySharePassword,
  type DocumentDetail,
  type DocumentSummary,
  type ShareResponse,
  type SharedKnowledgeBase,
  type SharedWorkspace
} from "@/lib/openkb-api";

export function ShareClient({ token }: { token: string }) {
  const { t } = useI18n();
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setMessage("");
      try {
        const next = await getShare(token, selectedDocumentId);
        if (!cancelled) {
          setShare(next);
          setNeedsPassword(false);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiRequestError && error.body.error === "SHARE_PASSWORD_REQUIRED") {
          setNeedsPassword(true);
          setShare(null);
        } else if (isUnauthorized(error)) {
          window.location.href = `/login?next=${encodeURIComponent(`/share/${token}`)}`;
        } else {
          setMessage(formatError(error, t("Share link not available.")));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedDocumentId, t, token]);

  async function handleVerifyPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsVerifying(true);
    setMessage("");
    try {
      await verifySharePassword(token, password);
      setPassword("");
      setNeedsPassword(false);
      setShare(await getShare(token, selectedDocumentId));
    } catch (error) {
      setMessage(formatError(error, t("Password verification failed.")));
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-8 text-zinc-950">
      <div className="mx-auto flex max-w-5xl items-start justify-between gap-4 border-b border-zinc-200 pb-5">
        <div>
          <p className="text-xs font-medium uppercase text-sky-700">OpenKB</p>
          <h1 className="mt-2 text-2xl font-semibold">{t("Shared content")}</h1>
        </div>
        <LanguageSwitcher />
      </div>

      <section className="mx-auto mt-6 max-w-5xl">
        {isLoading ? (
          <div className="rounded-md border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
            {t("Loading...")}
          </div>
        ) : needsPassword ? (
          <form
            className="max-w-md rounded-md border border-zinc-200 bg-white p-6 shadow-sm"
            onSubmit={handleVerifyPassword}
          >
            <h2 className="text-lg font-semibold">{t("Password required")}</h2>
            <p className="mt-2 text-sm text-zinc-500">
              {t("Enter the share password to view this read-only content.")}
            </p>
            <input
              className="mt-4 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-500"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
            <button
              className="mt-4 inline-flex h-10 items-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              disabled={isVerifying}
              type="submit"
            >
              {isVerifying ? t("Verifying...") : t("Verify password")}
            </button>
          </form>
        ) : share ? (
          <SharedContent
            response={share}
            selectedDocumentId={selectedDocumentId}
            onSelectDocument={setSelectedDocumentId}
          />
        ) : null}

        {message ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {message}
          </p>
        ) : null}

        <Link
          className="mt-6 inline-block text-sm font-medium text-zinc-600 hover:text-zinc-950"
          href="/login"
        >
          {t("Log in")}
        </Link>
      </section>
    </main>
  );
}

function SharedContent({
  onSelectDocument,
  response,
  selectedDocumentId
}: {
  onSelectDocument: (documentId: string | null) => void;
  response: ShareResponse;
  selectedDocumentId: string | null;
}) {
  const { t } = useI18n();
  if (response.share.object_type === "document" && isDocumentDetail(response.object)) {
    return <ReadOnlyDocument document={response.object} />;
  }
  if (response.share.object_type === "knowledge_base" && isSharedKnowledgeBase(response.object)) {
    const knowledgeBase = response.object;
    return (
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-md border border-zinc-200 bg-white p-3">
          <h2 className="px-2 text-sm font-semibold">{knowledgeBase.title}</h2>
          <div className="mt-3 space-y-1">
            {knowledgeBase.documents.map((document) => (
              <DocumentButton
                active={
                  selectedDocumentId
                    ? selectedDocumentId === document.id
                    : knowledgeBase.selectedDocument?.id === document.id
                }
                document={document}
                key={document.id}
                onClick={() => onSelectDocument(document.id)}
              />
            ))}
          </div>
        </aside>
        {knowledgeBase.selectedDocument ? (
          <ReadOnlyDocument document={knowledgeBase.selectedDocument} />
        ) : (
          <div className="rounded-md border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
            {t("No document selected")}
          </div>
        )}
      </div>
    );
  }
  if (response.share.object_type === "workspace" && isSharedWorkspace(response.object)) {
    return (
      <section className="rounded-md border border-zinc-200 bg-white p-6">
        <h2 className="text-xl font-semibold">{response.object.name}</h2>
        <p className="mt-2 text-sm text-zinc-500">{t("Shared workspace knowledge bases")}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(response.object.knowledge_bases ?? []).map((knowledgeBase) => (
            <div className="rounded-md border border-zinc-200 p-3" key={knowledgeBase.id}>
              <p className="font-medium">{knowledgeBase.title}</p>
              <p className="mt-1 text-xs text-zinc-500">{t(knowledgeBase.visibility)}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
      {t("Share link not available.")}
    </div>
  );
}

function DocumentButton({
  active,
  document,
  onClick
}: {
  active: boolean;
  document: DocumentSummary;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
        active ? "bg-sky-50 text-sky-800" : "text-zinc-600 hover:bg-zinc-100"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="truncate">{document.title}</span>
      <span className="ml-2 text-xs text-zinc-400">{t(document.type)}</span>
    </button>
  );
}

function ReadOnlyDocument({ document }: { document: DocumentDetail }) {
  const { t } = useI18n();
  return (
    <article className="rounded-md border border-zinc-200 bg-white p-6">
      <div className="border-b border-zinc-200 pb-4">
        <h2 className="text-2xl font-semibold">{document.title}</h2>
        <p className="mt-2 text-sm text-zinc-500">
          {t("View only")} · {t(document.status)}
        </p>
      </div>
      <pre className="mt-5 whitespace-pre-wrap font-sans text-base leading-7 text-zinc-800">
        {document.currentVersion?.markdown ?? t("No content")}
      </pre>
    </article>
  );
}

function isDocumentDetail(value: ShareResponse["object"]): value is DocumentDetail {
  return "currentVersion" in value;
}

function isSharedKnowledgeBase(value: ShareResponse["object"]): value is SharedKnowledgeBase {
  return "documents" in value && "selectedDocument" in value;
}

function isSharedWorkspace(value: ShareResponse["object"]): value is SharedWorkspace {
  return "knowledge_bases" in value;
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return error.body.message || error.body.error || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
