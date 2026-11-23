/**
 * The WhatsApp connector. It reads a WhatsApp MCP server (the open-source
 * `whatsapp-mcp` daemon, which links a personal account as a companion
 * device) and logs a `message` interaction for each day you messaged with a
 * contact in a direct chat. It asks only for per-day counts through the
 * server's `list_chat_activity` tool, so no message text reaches Contrack.
 *
 * Each account adds its own server address and key, so one instance can
 * hold several people's WhatsApp history without mixing them.
 *
 * @module server/connectors/adapters/whatsapp
 */

import { z } from "zod";
import { safeFetch } from "../../utils/urlSafety.ts";
import {
  ConnectorAuthError,
  ConnectorConfigError,
  ConnectorUnavailableError,
} from "../errors.ts";
import type { ConnectorAdapter, SyncContext, SyncEvent } from "../types.ts";

export const whatsappConfigSchema = z.object({
  url: z
    .string()
    .url("Must be a valid URL")
    .describe("The WhatsApp MCP server's address, ending in /mcp"),
  lookbackDays: z.number().int().min(1).max(3650).default(90).optional(),
  /** The IANA zone where a day starts, such as Asia/Jerusalem. */
  timezone: z.string().min(1).max(64).default("UTC").optional(),
  /** Chats with a stranger before Contrack suggests them as a contact. */
  ghostThreshold: z.coerce.number().int().min(1).max(10).default(3).optional(),
  /**
   * Off: each chat day is already one interaction, and a rollup would key
   * days by UTC date instead of the chosen zone.
   */
  rollup: z.boolean().default(false).optional(),
});

export type WhatsappConfig = z.infer<typeof whatsappConfigSchema>;

export const whatsappSecretSchema = z.object({
  token: z.string().min(1).max(4096),
});

export type WhatsappSecret = z.infer<typeof whatsappSecretSchema>;

/** One direct chat's activity, as `list_chat_activity` returns it. */
const activitySchema = z.array(
  z.object({
    chat_jid: z.string(),
    phone_number: z.string().optional(),
    name: z.string().optional(),
    days: z.array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        sent: z.number().int().min(0),
        received: z.number().int().min(0),
        first_at: z.string(),
        last_at: z.string(),
      }),
    ),
  }),
);

export type ChatActivity = z.infer<typeof activitySchema>[number];

const MCP_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The JSON-RPC body of a reply that came as JSON or as one SSE event. */
export function parseRpcReply(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const data = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  if (!data) throw new ConnectorUnavailableError("Empty reply from WhatsApp");
  return JSON.parse(data);
}

/** The text a tool returned, or the error it reported. */
export function toolText(reply: unknown): string {
  const r = reply as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  if (r.error) {
    throw new ConnectorConfigError(
      `The WhatsApp server refused the call: ${r.error.message ?? "unknown error"}`,
    );
  }
  const text = r.result?.content?.map((c) => c.text ?? "").join("") ?? "";
  if (r.result?.isError) {
    throw new ConnectorUnavailableError(`WhatsApp: ${text || "tool failed"}`);
  }
  return text;
}

async function callTool(
  config: WhatsappConfig,
  secret: WhatsappSecret | null,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  if (!secret?.token) {
    throw new ConnectorAuthError("Add the WhatsApp server's API key");
  }
  let response: globalThis.Response;
  try {
    ({ response } = await safeFetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      allowPrivate: process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS === "true",
      timeoutMs: MCP_TIMEOUT_MS,
      maxRedirects: 0,
      signal,
    }));
  } catch (err) {
    throw new ConnectorConfigError(
      `Could not reach the WhatsApp server: ${(err as Error).message}`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new ConnectorAuthError("The WhatsApp server refused the API key");
  }
  if (!response.ok) {
    throw new ConnectorUnavailableError(
      `The WhatsApp server answered ${response.status}`,
    );
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new ConnectorUnavailableError("The WhatsApp reply is too large");
  }
  return toolText(parseRpcReply(body));
}

async function fetchActivity(
  config: WhatsappConfig,
  secret: WhatsappSecret | null,
  after: Date,
  signal?: AbortSignal,
): Promise<ChatActivity[]> {
  const text = await callTool(
    config,
    secret,
    "list_chat_activity",
    { after: after.toISOString(), timezone: config.timezone ?? "UTC" },
    signal,
  );
  const parsed = activitySchema.safeParse(JSON.parse(text || "[]") ?? []);
  if (!parsed.success) {
    throw new ConnectorUnavailableError(
      "The WhatsApp server's reply has an unexpected shape. Update whatsapp-mcp to a version with list_chat_activity.",
    );
  }
  return parsed.data;
}

/** The international form of a WhatsApp phone, which is digits only. */
function e164(phone: string | undefined): string | undefined {
  const digits = phone?.replace(/\D/g, "");
  return digits ? `+${digits}` : undefined;
}

/**
 * The events for a set of chats: one `message` interaction per chat and day.
 * A chat whose JID never resolved to a phone (a bare LID) is skipped, because
 * no contact can match it.
 */
export function* activityEvents(
  chats: ChatActivity[],
): Generator<SyncEvent, void> {
  for (const chat of chats) {
    const phone = e164(chat.phone_number);
    if (!phone) continue;
    for (const day of chat.days) {
      if (day.sent + day.received === 0) continue;
      yield {
        kind: "interaction",
        externalId: `${chat.chat_jid}:${day.date}`,
        type: "message",
        title: "WhatsApp messages",
        date: day.last_at,
        ...(day.received === 0
          ? { direction: "out" as const }
          : day.sent === 0
            ? { direction: "in" as const }
            : {}),
        participants: [{ phone, ...(chat.name ? { name: chat.name } : {}) }],
      };
    }
  }
}

export const whatsappAdapter: ConnectorAdapter<WhatsappConfig, WhatsappSecret> =
  {
    kind: "whatsapp",
    label: "WhatsApp",
    description:
      "Log the days you messaged each contact, from a WhatsApp MCP server",
    capabilities: {
      schedule: true,
    },
    configSchema: whatsappConfigSchema,
    secretSchema: whatsappSecretSchema,

    async test(config, secret) {
      if (config.timezone) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: config.timezone });
        } catch {
          throw new ConnectorConfigError(
            `Unknown time zone "${config.timezone}"`,
          );
        }
      }
      const chats = await fetchActivity(
        config,
        secret,
        new Date(Date.now() - 7 * DAY_MS),
      );
      return {
        ok: true,
        detail: `Connected. ${chats.length} direct chats had messages in the last 7 days.`,
      };
    },

    async *sync(
      ctx: SyncContext<WhatsappConfig, WhatsappSecret>,
    ): AsyncGenerator<SyncEvent, unknown> {
      const now = new Date();
      // A day logged by the last run may have gained messages since, and the
      // server can backfill history late, so each run looks one day further
      // back than its cursor. Interactions are keyed by chat and day, so the
      // overlap logs nothing twice.
      const since = new Date(new Date(ctx.since).getTime() - DAY_MS);
      ctx.log(`Reading WhatsApp activity since ${since.toISOString()}`);
      const chats = await fetchActivity(
        ctx.config,
        ctx.secret,
        since,
        ctx.signal,
      );
      let fetched = 0;
      for (const event of activityEvents(chats)) {
        ctx.signal.throwIfAborted();
        fetched++;
        yield event;
      }
      yield {
        kind: "progress",
        fetched,
        message: `Read ${chats.length} chats, ${fetched} chat days`,
      };
      return { lastSyncAt: now.toISOString() };
    },
  };
