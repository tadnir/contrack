/**
 * WhatsappFormModal: adds or edits a WhatsApp connector, which reads a
 * WhatsApp MCP server. The API key is masked and, when editing, an empty key
 * keeps the saved one.
 */

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { NO_AUTOCORRECT } from "../../../components/ui/SearchField";
import {
  useCreateConnector,
  useTestConnector,
  useUpdateConnector,
} from "../../../api/connectors";
import type {
  ConnectorDetail,
  ConnectorSummary,
} from "../../../../shared/connectors";
import { FORM_INPUT, TONE_WASH } from "../../../lib/styles";
import { cn, errorText } from "../../../lib/utils";
import {
  FIELD_HEADING,
  FormError,
  LookbackField,
  SyncScheduleField,
  isValidHttpUrl,
} from "./ConnectorFormFields";

interface WhatsappFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  connector?: ConnectorDetail | ConnectorSummary | null;
}

/** The browser's own time zone, the default for where a day starts. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const WhatsappFormModal: React.FC<WhatsappFormModalProps> = ({
  isOpen,
  onClose,
  connector,
}) => {
  const isEditing = Boolean(connector);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [intervalMinutes, setIntervalMinutes] = useState<number>(60);
  const [lookbackDays, setLookbackDays] = useState<number>(90);
  const [ghostThreshold, setGhostThreshold] = useState<number>(3);

  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createConnector = useCreateConnector();
  const updateConnector = useUpdateConnector();
  const testConnector = useTestConnector();

  useEffect(() => {
    if (connector) {
      const cfg = (connector.config ?? {}) as Record<string, unknown>;
      setName(connector.name);
      setIntervalMinutes(connector.intervalMinutes ?? 60);
      setUrl(typeof cfg.url === "string" ? cfg.url : "");
      setTimezone(typeof cfg.timezone === "string" ? cfg.timezone : "UTC");
      setLookbackDays(
        typeof cfg.lookbackDays === "number" ? cfg.lookbackDays : 90,
      );
      setGhostThreshold(
        typeof cfg.ghostThreshold === "number" ? cfg.ghostThreshold : 3,
      );
    } else {
      setName("WhatsApp");
      setUrl("");
      setTimezone(localZone());
      setIntervalMinutes(60);
      setLookbackDays(90);
      setGhostThreshold(3);
    }
    setToken("");
    setShowToken(false);
    setTestResult(null);
    setFormError(null);
  }, [connector, isOpen]);

  const hasToken = token.trim().length > 0;

  const formConfig = () => ({
    url: url.trim(),
    timezone: timezone.trim() || "UTC",
    lookbackDays,
    ghostThreshold,
    rollup: false,
  });

  /** The first problem with the form, or null. */
  const problem = (): string | null => {
    if (!isValidHttpUrl(url.trim())) {
      return "Enter the WhatsApp server's https:// address";
    }
    if (!hasToken && !isEditing) return "Enter the server's API key";
    return null;
  };

  const handleTest = async () => {
    setFormError(null);
    const p = problem();
    if (p) {
      setFormError(p);
      return;
    }
    try {
      const res = await testConnector.mutateAsync({
        kind: "whatsapp",
        config: formConfig(),
        secret: hasToken ? { token: token.trim() } : undefined,
        connectorId: !hasToken && isEditing ? connector?.id : undefined,
      });
      setTestResult({ ok: true, message: res.detail });
      toast.success(res.detail);
    } catch (err) {
      const msg = errorText(err) || "Could not test the connection";
      setTestResult({ ok: false, message: msg });
      toast.error(`Could not test connection: ${errorText(err)}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("Enter a name for this connector");
      return;
    }
    const p = problem();
    if (p) {
      setFormError(p);
      return;
    }
    try {
      if (isEditing && connector) {
        await updateConnector.mutateAsync({
          id: connector.id,
          name: trimmedName,
          config: formConfig(),
          secret: hasToken ? { token: token.trim() } : undefined,
          intervalMinutes,
        });
        toast.success(`Updated ${trimmedName}`);
      } else {
        await createConnector.mutateAsync({
          kind: "whatsapp",
          name: trimmedName,
          config: formConfig(),
          secret: { token: token.trim() },
          intervalMinutes,
        });
        toast.success(`Connected ${trimmedName}`);
      }
      onClose();
    } catch (err) {
      const msg = errorText(err) || "Could not save the connector";
      setFormError(msg);
      toast.error(`Could not save connector: ${errorText(err)}`);
    }
  };

  const isSaving = createConnector.isPending || updateConnector.isPending;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit ${connector?.name}` : "Connect WhatsApp"}
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4 pt-2">
        <div className="rounded-lg bg-surface-container p-3 text-xs text-on-surface-variant leading-relaxed">
          <p>
            <strong>Privacy:</strong> Only how many messages you sent and got
            each day in direct chats is read. Message text and groups are never
            imported
          </p>
        </div>

        <FormError message={formError} />

        <div>
          <label htmlFor="connector-name" className={FIELD_HEADING}>
            Connector name
          </label>
          <input
            id="connector-name"
            type="text"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFormError(null);
            }}
            placeholder="e.g. My WhatsApp"
            className={FORM_INPUT}
          />
        </div>

        <div>
          <label htmlFor="connector-whatsapp-url" className={FIELD_HEADING}>
            WhatsApp MCP server address
          </label>
          <input
            id="connector-whatsapp-url"
            type="url"
            required
            autoComplete="off"
            {...NO_AUTOCORRECT}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTestResult(null);
              setFormError(null);
            }}
            placeholder="https://mcp.example.com/whatsapp/mcp"
            className={cn(FORM_INPUT, "font-mono")}
          />
          <p className="mt-1 text-xs text-on-surface-variant">
            A whatsapp-mcp server linked to your own WhatsApp account
          </p>
        </div>

        <div>
          <label htmlFor="connector-whatsapp-token" className={FIELD_HEADING}>
            API key
          </label>
          <div className="relative">
            <input
              id="connector-whatsapp-token"
              type={showToken ? "text" : "password"}
              autoComplete="off"
              {...NO_AUTOCORRECT}
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setTestResult(null);
                setFormError(null);
              }}
              placeholder={isEditing ? "Leave empty to keep the saved key" : ""}
              className={cn(FORM_INPUT, "pr-11 font-mono")}
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              aria-label={showToken ? "Hide key" : "Show key"}
              className="hit-area state-layer absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-lg text-on-surface-variant hover:text-on-surface transition-colors"
            >
              {showToken ? (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Eye className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="mt-1 text-xs text-on-surface-variant">
            Sent as a Bearer token on every request
          </p>
        </div>

        <div>
          <label htmlFor="connector-whatsapp-zone" className={FIELD_HEADING}>
            Time zone
          </label>
          <input
            id="connector-whatsapp-zone"
            type="text"
            {...NO_AUTOCORRECT}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Europe/London"
            className={FORM_INPUT}
          />
          <p className="mt-1 text-xs text-on-surface-variant">
            Where a day starts, as an IANA name
          </p>
        </div>

        <SyncScheduleField
          value={intervalMinutes}
          onChange={setIntervalMinutes}
        />
        <LookbackField value={lookbackDays} onChange={setLookbackDays} />

        <div>
          <label htmlFor="connector-ghost-threshold" className={FIELD_HEADING}>
            Suggest a new person after
          </label>
          <div className="flex items-center gap-2">
            <input
              id="connector-ghost-threshold"
              type="number"
              min={1}
              max={10}
              value={ghostThreshold}
              onChange={(e) =>
                setGhostThreshold(
                  Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 3)),
                )
              }
              className={cn(FORM_INPUT, "w-24")}
            />
            <span className="text-xs text-on-surface-variant">chat days</span>
          </div>
        </div>

        {testResult && (
          <div
            role="status"
            className={cn(
              "rounded-lg p-3 text-xs",
              TONE_WASH[testResult.ok ? "success" : "error"],
            )}
          >
            {testResult.message}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testConnector.isPending || isSaving}
            className="btn-secondary"
          >
            {testConnector.isPending ? (
              <>
                <Loader2
                  className="w-3.5 h-3.5 animate-spin"
                  aria-hidden="true"
                />
                <span>Testing…</span>
              </>
            ) : (
              <span>Test connection</span>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || testConnector.isPending}
              className="btn-primary"
            >
              {isSaving ? (
                <>
                  <Loader2
                    className="w-3.5 h-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  <span>Saving…</span>
                </>
              ) : (
                <span>{isEditing ? "Save changes" : "Connect"}</span>
              )}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
