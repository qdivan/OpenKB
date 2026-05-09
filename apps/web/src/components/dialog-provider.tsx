"use client";

import { AlertTriangle, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";

import { useI18n } from "@/lib/i18n-provider";

type DialogTone = "default" | "danger";

type ConfirmationOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

type TextInputOptions = ConfirmationOptions & {
  defaultValue?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
};

type FormInputField = {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
};

type FormInputOptions = ConfirmationOptions & {
  fields: FormInputField[];
};

type DialogContextValue = {
  requestConfirmation: (options: ConfirmationOptions) => Promise<boolean>;
  requestFormInput: (options: FormInputOptions) => Promise<Record<string, string> | null>;
  requestTextInput: (options: TextInputOptions) => Promise<string | null>;
};

type ActiveDialog =
  | {
      id: number;
      kind: "confirmation";
      options: ConfirmationOptions;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      kind: "text";
      options: TextInputOptions;
      resolve: (value: string | null) => void;
    }
  | {
      id: number;
      kind: "form";
      options: FormInputOptions;
      resolve: (value: Record<string, string> | null) => void;
    };

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [activeDialog, setActiveDialog] = useState<ActiveDialog | null>(null);
  const [textValue, setTextValue] = useState("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const nextIdRef = useRef(1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeDialog = useCallback(
    (dialog: ActiveDialog | null, value: boolean | string | Record<string, string> | null) => {
      if (!dialog) {
        return;
      }
      setActiveDialog(null);
      setError("");
      if (dialog.kind === "confirmation") {
        dialog.resolve(Boolean(value));
        return;
      }
      if (dialog.kind === "text") {
        dialog.resolve(typeof value === "string" ? value : null);
        return;
      }
      dialog.resolve(value && typeof value === "object" ? value : null);
    },
    []
  );

  const requestConfirmation = useCallback((options: ConfirmationOptions) => {
    return new Promise<boolean>((resolve) => {
      setActiveDialog({
        id: nextIdRef.current++,
        kind: "confirmation",
        options,
        resolve
      });
      setError("");
    });
  }, []);

  const requestTextInput = useCallback((options: TextInputOptions) => {
    return new Promise<string | null>((resolve) => {
      setTextValue(options.defaultValue ?? "");
      setActiveDialog({
        id: nextIdRef.current++,
        kind: "text",
        options,
        resolve
      });
      setError("");
    });
  }, []);

  const requestFormInput = useCallback((options: FormInputOptions) => {
    return new Promise<Record<string, string> | null>((resolve) => {
      setFormValues(
        Object.fromEntries(options.fields.map((field) => [field.name, field.defaultValue ?? ""]))
      );
      setActiveDialog({
        id: nextIdRef.current++,
        kind: "form",
        options,
        resolve
      });
      setError("");
    });
  }, []);

  useEffect(() => {
    if (!activeDialog) {
      return;
    }

    window.setTimeout(() => {
      if (activeDialog.kind === "text" || activeDialog.kind === "form") {
        inputRef.current?.focus();
        if (activeDialog.kind === "text") {
          inputRef.current?.select();
        }
        return;
      }
      cancelButtonRef.current?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDialog(activeDialog, null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeDialog, closeDialog]);

  const value = useMemo(
    () => ({ requestConfirmation, requestFormInput, requestTextInput }),
    [requestConfirmation, requestFormInput, requestTextInput]
  );

  function submitDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeDialog) {
      return;
    }

    if (activeDialog.kind === "confirmation") {
      closeDialog(activeDialog, true);
      return;
    }

    if (activeDialog.kind === "form") {
      const nextValues = Object.fromEntries(
        Object.entries(formValues).map(([key, value]) => [key, value.trim()])
      );
      const missingField = activeDialog.options.fields.find(
        (field) => field.required !== false && !nextValues[field.name]
      );
      if (missingField) {
        setError(t("This field is required."));
        return;
      }
      closeDialog(activeDialog, nextValues);
      return;
    }

    const nextValue = textValue.trim();
    if (activeDialog.options.required !== false && !nextValue) {
      setError(t("This field is required."));
      return;
    }
    closeDialog(activeDialog, nextValue);
  }

  const tone = activeDialog?.options.tone ?? "default";
  const confirmButtonClass =
    tone === "danger"
      ? "inline-flex h-9 items-center justify-center rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:bg-red-200"
      : "inline-flex h-9 items-center justify-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:bg-zinc-300";

  return (
    <DialogContext.Provider value={value}>
      {children}
      {activeDialog ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/30 px-4 py-6">
          <form
            aria-modal="true"
            className="w-full max-w-md rounded-md border border-zinc-200 bg-white shadow-xl"
            onSubmit={submitDialog}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {tone === "danger" ? <AlertTriangle className="h-4 w-4 text-red-600" /> : null}
                  <h2 className="text-base font-semibold text-zinc-950">
                    {activeDialog.options.title}
                  </h2>
                </div>
                {activeDialog.options.description ? (
                  <p className="mt-1 text-sm leading-6 text-zinc-500">
                    {activeDialog.options.description}
                  </p>
                ) : null}
              </div>
              <button
                aria-label={t("Close")}
                className="icon-button"
                onClick={() => closeDialog(activeDialog, null)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {activeDialog.kind === "text" ? (
              <div className="px-5 py-4">
                <label className="block text-sm font-medium text-zinc-700">
                  <span className="mb-1 block">{activeDialog.options.label ?? t("Value")}</span>
                  <input
                    ref={inputRef}
                    className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    onChange={(event) => {
                      setTextValue(event.target.value);
                      setError("");
                    }}
                    placeholder={activeDialog.options.placeholder}
                    value={textValue}
                  />
                </label>
                {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
              </div>
            ) : null}

            {activeDialog.kind === "form" ? (
              <div className="space-y-3 px-5 py-4">
                {activeDialog.options.fields.map((field, index) => (
                  <label className="block text-sm font-medium text-zinc-700" key={field.name}>
                    <span className="mb-1 block">{field.label}</span>
                    <input
                      ref={index === 0 ? inputRef : undefined}
                      className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      onChange={(event) => {
                        setFormValues((current) => ({
                          ...current,
                          [field.name]: event.target.value
                        }));
                        setError("");
                      }}
                      placeholder={field.placeholder}
                      value={formValues[field.name] ?? ""}
                    />
                  </label>
                ))}
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-5 py-4">
              <button
                ref={cancelButtonRef}
                className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                onClick={() => closeDialog(activeDialog, null)}
                type="button"
              >
                {activeDialog.options.cancelLabel ?? t("Cancel")}
              </button>
              <button className={confirmButtonClass} type="submit">
                {activeDialog.options.confirmLabel ?? t("Confirm")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const value = useContext(DialogContext);
  if (!value) {
    throw new Error("useDialog must be used within DialogProvider.");
  }
  return value;
}
