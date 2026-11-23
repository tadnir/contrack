/**
 * Unit: the WhatsApp adapter reads per-day counts from a WhatsApp MCP server
 * and turns each chat day into one message interaction.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const safeFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../server/utils/urlSafety.ts", () => ({ safeFetch }));

import {
  activityEvents,
  parseRpcReply,
  toolText,
  whatsappAdapter,
  whatsappConfigSchema,
} from "../../../../server/connectors/adapters/whatsapp.ts";
import type { SyncEvent } from "../../../../server/connectors/types.ts";

const ACTIVITY = [
  {
    chat_jid: "447700000001@s.whatsapp.net",
    phone_number: "447700000001",
    name: "Ada Lovelace",
    days: [
      {
        date: "2026-03-01",
        sent: 2,
        received: 3,
        first_at: "2026-03-01T08:00:00Z",
        last_at: "2026-03-01T09:30:00Z",
      },
      {
        date: "2026-03-02",
        sent: 0,
        received: 1,
        first_at: "2026-03-02T10:00:00Z",
        last_at: "2026-03-02T10:00:00Z",
      },
    ],
  },
  // A bare LID that never resolved to a phone: no contact can match it.
  {
    chat_jid: "55443322@lid",
    days: [
      {
        date: "2026-03-01",
        sent: 1,
        received: 0,
        first_at: "2026-03-01T08:00:00Z",
        last_at: "2026-03-01T08:00:00Z",
      },
    ],
  },
];

/** A server reply carrying `payload` as the tool's text, framed as SSE. */
function sseReply(payload: unknown): Response {
  const rpc = {
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  };
  return new Response(`event: message\ndata: ${JSON.stringify(rpc)}\n\n`, {
    status: 200,
  });
}

const config = whatsappConfigSchema.parse({
  url: "https://mcp.example.com/whatsapp/mcp",
  timezone: "Europe/London",
});

describe("whatsappAdapter", () => {
  afterEach(() => {
    safeFetch.mockReset();
  });

  it("turns off the day rollup by default", () => {
    expect(config.rollup).toBe(false);
  });

  it("reads JSON and SSE replies, and reports tool errors", () => {
    expect(parseRpcReply('{"jsonrpc":"2.0","id":1,"result":{}}')).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
    expect(() =>
      toolText({ result: { isError: true, content: [{ text: "offline" }] } }),
    ).toThrow(/offline/);
    expect(() => toolText({ error: { message: "no such tool" } })).toThrow(
      /no such tool/,
    );
  });

  it("yields one interaction per chat day, keyed by chat and day", () => {
    const events = [...activityEvents(ACTIVITY)];
    expect(events).toEqual([
      {
        kind: "interaction",
        externalId: "447700000001@s.whatsapp.net:2026-03-01",
        type: "message",
        title: "WhatsApp messages",
        date: "2026-03-01T09:30:00Z",
        participants: [{ phone: "+447700000001", name: "Ada Lovelace" }],
      },
      {
        kind: "interaction",
        externalId: "447700000001@s.whatsapp.net:2026-03-02",
        type: "message",
        title: "WhatsApp messages",
        date: "2026-03-02T10:00:00Z",
        direction: "in",
        participants: [{ phone: "+447700000001", name: "Ada Lovelace" }],
      },
    ]);
  });

  it("asks for a day before the cursor with the key, and returns a new cursor", async () => {
    safeFetch.mockResolvedValue({ response: sseReply(ACTIVITY) });
    const events: SyncEvent[] = [];
    const gen = whatsappAdapter.sync({
      config,
      secret: { token: "k3y" },
      cursor: null,
      since: "2026-03-02T00:00:00.000Z",
      selfAddresses: { emails: [], phones: [] },
      signal: new AbortController().signal,
      log: () => {},
    });
    let next = await gen.next();
    while (!next.done) {
      events.push(next.value);
      next = await gen.next();
    }
    expect(events.filter((e) => e.kind === "interaction")).toHaveLength(2);
    expect(next.value).toHaveProperty("lastSyncAt");

    const [url, options] = safeFetch.mock.calls[0];
    expect(url).toBe("https://mcp.example.com/whatsapp/mcp");
    expect(options.headers.Authorization).toBe("Bearer k3y");
    const body = JSON.parse(options.body);
    expect(body.params).toEqual({
      name: "list_chat_activity",
      arguments: {
        after: "2026-03-01T00:00:00.000Z",
        timezone: "Europe/London",
      },
    });
  });

  it("names a refused key, and a server without the tool", async () => {
    safeFetch.mockResolvedValue({
      response: new Response("unauthorized", { status: 401 }),
    });
    await expect(
      whatsappAdapter.test(config, { token: "wrong" }),
    ).rejects.toThrow(/refused the API key/);

    safeFetch.mockResolvedValue({ response: sseReply({ not: "a list" }) });
    await expect(whatsappAdapter.test(config, { token: "k" })).rejects.toThrow(
      /list_chat_activity/,
    );
  });

  it("refuses an unknown time zone before calling the server", async () => {
    await expect(
      whatsappAdapter.test(
        { ...config, timezone: "Mars/Olympus" },
        { token: "k" },
      ),
    ).rejects.toThrow(/time zone/);
    expect(safeFetch).not.toHaveBeenCalled();
  });
});
