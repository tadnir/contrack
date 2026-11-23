// Integration: connections between contacts, and the network that draws them.
// The network ties two contacts when the person states how they are connected,
// and when the two appear on the same notes, meetings or messages. A merged
// contact's ties move to the contact it was merged into.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const { makeTestApp } = await import("./helpers.ts");
const { sqlite } = await import("../../server/db.ts");
const { networkService } =
  await import("../../server/services/networkService.ts");
const { createActor, resetAccounts } = await import("./tenancy/helpers.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");

makeTestApp();

let owner: string;
let scope: ReturnType<typeof scopeForOwnerId>;
let n = 0;

function addContact(name: string, extra: { canonicalId?: string } = {}) {
  const id = `c-net-${++n}`;
  sqlite
    .prepare(
      "INSERT INTO contacts (id, name, ownerId, canonicalId) VALUES (?, ?, ?, ?)",
    )
    .run(id, name, owner, extra.canonicalId ?? null);
  return id;
}

/** A meeting logged on `contactId` that also names `mentions`. */
function addMeeting(contactId: string, mentions: string[]) {
  const id = `i-net-${++n}`;
  sqlite
    .prepare(
      `INSERT INTO interactions (id, contactId, type, title, date, ownerId)
       VALUES (?, ?, 'meeting', 'Dinner', '2026-01-01', ?)`,
    )
    .run(id, contactId, owner);
  for (const m of mentions) {
    sqlite
      .prepare(
        "INSERT INTO interaction_mentions (interactionId, contactId) VALUES (?, ?)",
      )
      .run(id, m);
  }
  return id;
}

beforeAll(async () => {
  resetAccounts();
  const a = await createActor(makeTestApp(), { username: "networkowner" });
  owner = a.user.id;
  scope = scopeForOwnerId(owner);
});

beforeEach(() => {
  sqlite.prepare("DELETE FROM contact_connections").run();
  sqlite.prepare("DELETE FROM interaction_mentions").run();
  sqlite.prepare("DELETE FROM interactions").run();
  sqlite.prepare("DELETE FROM contacts").run();
});

describe("connections", () => {
  it("lists a connection from both sides, and refuses a duplicate", () => {
    const dana = addContact("Dana");
    const avi = addContact("Avi");
    const made = networkService.createConnection(scope, dana, avi, "sister");
    expect(made).toMatchObject({
      direction: "out",
      type: "sister",
      other: { id: avi, name: "Avi" },
    });
    expect(networkService.listConnections(scope, avi)).toMatchObject([
      { id: made.id, direction: "in", other: { id: dana } },
    ]);
    expect(() =>
      networkService.createConnection(scope, dana, avi, "sister"),
    ).toThrow(/already/);
    expect(() =>
      networkService.createConnection(scope, dana, dana, "self"),
    ).toThrow(/itself/);
  });
});

describe("the network", () => {
  it("ties contacts who share meetings, counting each meeting once", () => {
    const a = addContact("Ana");
    const b = addContact("Ben");
    const c = addContact("Cal");
    addContact("Loner");
    addMeeting(a, [b, c]);
    addMeeting(b, [a]);

    const net = networkService.getNetwork(scope, 1);
    expect(net.nodes.map((x) => x.name)).toEqual(["Ana", "Ben", "Cal"]);
    const weights = Object.fromEntries(
      net.edges.map((e) => [[e.source, e.target].sort().join("+"), e.weight]),
    );
    expect(weights).toEqual({
      [[a, b].sort().join("+")]: 2,
      [[a, c].sort().join("+")]: 1,
      [[b, c].sort().join("+")]: 1,
    });

    const strong = networkService.getNetwork(scope, 2);
    expect(strong.edges).toHaveLength(1);
    expect(strong.nodes.map((x) => x.name)).toEqual(["Ana", "Ben"]);
  });

  it("draws a merged contact's ties on the contact it was merged into", () => {
    const keep = addContact("Kim");
    const dupe = addContact("Kim (old)");
    const lee = addContact("Lee");
    networkService.createConnection(scope, dupe, lee, "colleague");
    addMeeting(dupe, [lee]);
    sqlite
      .prepare("UPDATE contacts SET canonicalId = ? WHERE id = ?")
      .run(keep, dupe);

    const net = networkService.getNetwork(scope, 1);
    expect(net.nodes.map((x) => x.id).sort()).toEqual([keep, lee].sort());
    expect(net.edges.map((e) => e.kind).sort()).toEqual([
      "connection",
      "shared",
    ]);
    for (const e of net.edges) {
      expect([e.source, e.target].sort()).toEqual([keep, lee].sort());
    }
  });
});
