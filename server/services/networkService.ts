/**
 * Connections and the network. A connection is a tie the person states
 * between two of their contacts ("Dana is Avi's sister"). The network adds
 * the ties Contrack sees itself: contacts who appear on the same notes,
 * meetings or messages, through `interaction_mentions`.
 *
 * Every statement names the owner. A connection's two contacts are proved in
 * one statement each, so a foreign id is a 404 like one that does not exist.
 *
 * @module server/services/networkService
 */

import crypto from "node:crypto";
import { sqlite } from "../db.ts";
import type { Scope } from "../tenancy/scope.ts";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../utils/AppError.ts";
import { ACTIVE_CONTACT_SQL } from "./search/ftsIndex.ts";
import { assertOwnedContact } from "./contactGuard.ts";
import type {
  Connection,
  Network,
  NetworkEdge,
} from "../../shared/contracts/network.ts";

interface ConnectionRow {
  id: string;
  contactId: string;
  relatedContactId: string;
  type: string;
  createdAt: string | null;
  ownerId: string;
  otherId: string;
  otherName: string;
  otherAvatarUrl: string | null;
}

function toConnection(row: ConnectionRow, viewedFrom: string): Connection {
  return {
    id: row.id,
    contactId: viewedFrom,
    type: row.type,
    direction: row.contactId === viewedFrom ? "out" : "in",
    other: {
      id: row.otherId,
      name: row.otherName,
      avatarUrl: row.otherAvatarUrl,
    },
    createdAt: row.createdAt,
    ownerId: row.ownerId,
  };
}

/** The connections of a contact, both ways, with the other contact live. */
function connectionsOf(scope: Scope, contactId: string): Connection[] {
  const rows = sqlite
    .prepare(
      `SELECT r.id, r.contactId, r.relatedContactId, r.type, r.createdAt, r.ownerId,
              o.id AS otherId, o.name AS otherName, o.avatarUrl AS otherAvatarUrl
         FROM contact_connections r
         JOIN contacts o
           ON o.id = CASE WHEN r.contactId = ? THEN r.relatedContactId ELSE r.contactId END
          AND o.ownerId = r.ownerId
        WHERE r.ownerId = ? AND (r.contactId = ? OR r.relatedContactId = ?)
          AND o.deletedAt IS NULL AND o.canonicalId IS NULL
        ORDER BY r.type, o.name`,
    )
    .all(contactId, scope.ownerId, contactId, contactId) as ConnectionRow[];
  return rows.map((row) => toConnection(row, contactId));
}

export const networkService = {
  listConnections(scope: Scope, contactId: string): Connection[] {
    assertOwnedContact(scope, contactId);
    return connectionsOf(scope, contactId);
  },

  createConnection(
    scope: Scope,
    contactId: string,
    relatedContactId: string,
    type: string,
  ): Connection {
    assertOwnedContact(scope, contactId);
    if (relatedContactId === contactId) {
      throw new ValidationError("A contact cannot be connected to itself");
    }
    assertOwnedContact(scope, relatedContactId);
    const cleanType = type.trim();
    const id = crypto.randomUUID();
    try {
      sqlite
        .prepare(
          `INSERT INTO contact_connections (id, contactId, relatedContactId, type, ownerId)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, contactId, relatedContactId, cleanType, scope.ownerId);
    } catch (err) {
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new ConflictError("These two already have that connection");
      }
      throw err;
    }
    const made = connectionsOf(scope, contactId).find((c) => c.id === id);
    if (!made) throw new NotFoundError("Contact");
    return made;
  },

  /** Removes a connection. A foreign or unknown id is a 404. */
  deleteConnection(scope: Scope, id: string): void {
    const result = sqlite
      .prepare("DELETE FROM contact_connections WHERE id = ? AND ownerId = ?")
      .run(id, scope.ownerId);
    if (result.changes === 0) throw new NotFoundError("Connection");
  },

  /**
   * The network: every active contact with a tie to another active contact,
   * the stated connections, and the pairs who share at least `minShared`
   * notes. A merged contact's ties count for the contact it was merged into.
   */
  getNetwork(scope: Scope, minShared: number): Network {
    // A contact and the active contact it stands for: itself, or the one it
    // was merged into.
    const resolve = `CASE WHEN c.canonicalId IS NULL THEN c.id ELSE c.canonicalId END`;

    const connections = sqlite
      .prepare(
        `SELECT r.id, r.type, r.contactId AS source, r.relatedContactId AS target
           FROM contact_connections r
          WHERE r.ownerId = ?`,
      )
      .all(scope.ownerId) as Array<{
      id: string;
      type: string;
      source: string;
      target: string;
    }>;

    // Pairs on one interaction: its contact with each mention, and two
    // mentions with each other. `interaction_mentions` has no owner, so each
    // arm starts at an interaction the owner holds.
    const shared = sqlite
      .prepare(
        `WITH people AS (
           SELECT i.id AS interactionId, i.contactId AS contactId
             FROM interactions i
            WHERE i.ownerId = ?
           UNION
           SELECT im.interactionId, im.contactId
             FROM interaction_mentions im
             JOIN interactions i ON i.id = im.interactionId
            WHERE i.ownerId = ?
         ),
         resolved AS (
           SELECT p.interactionId, ${resolve} AS contactId
             FROM people p
             JOIN contacts c ON c.id = p.contactId AND c.ownerId = ?
         )
         SELECT a.contactId AS source, b.contactId AS target,
                COUNT(DISTINCT a.interactionId) AS weight
           FROM resolved a
           JOIN resolved b
             ON a.interactionId = b.interactionId AND a.contactId < b.contactId
          GROUP BY a.contactId, b.contactId
         HAVING COUNT(DISTINCT a.interactionId) >= ?`,
      )
      .all(scope.ownerId, scope.ownerId, scope.ownerId, minShared) as Array<{
      source: string;
      target: string;
      weight: number;
    }>;

    const active = new Map(
      (
        sqlite
          .prepare(
            `SELECT c.id, c.name, c.avatarUrl, c.themeColor, c.company,
                    c.relationshipScore AS score
               FROM contacts c
              WHERE c.ownerId = ? AND ${ACTIVE_CONTACT_SQL}`,
          )
          .all(scope.ownerId) as Array<{
          id: string;
          name: string;
          avatarUrl: string | null;
          themeColor: string | null;
          company: string | null;
          score: number | null;
        }>
      ).map((c) => [c.id, c]),
    );

    // Connections were made between active contacts, but either may have
    // been merged since: draw it from the contact each stands for.
    const canonical = new Map(
      (
        sqlite
          .prepare(
            `SELECT c.id, c.canonicalId FROM contacts c
              WHERE c.ownerId = ? AND c.canonicalId IS NOT NULL`,
          )
          .all(scope.ownerId) as Array<{ id: string; canonicalId: string }>
      ).map((r) => [r.id, r.canonicalId]),
    );
    const standFor = (id: string) => canonical.get(id) ?? id;

    const edges: NetworkEdge[] = [];
    const linked = new Set<string>();
    const keep = (source: string, target: string) =>
      source !== target && active.has(source) && active.has(target);

    for (const r of connections) {
      const source = standFor(r.source);
      const target = standFor(r.target);
      if (!keep(source, target)) continue;
      edges.push({
        id: `c-${r.id}`,
        source,
        target,
        kind: "connection",
        label: r.type,
        weight: 1,
      });
      linked.add(source).add(target);
    }
    for (const s of shared) {
      if (!keep(s.source, s.target)) continue;
      edges.push({
        id: `s-${s.source}-${s.target}`,
        source: s.source,
        target: s.target,
        kind: "shared",
        label: `${s.weight} shared`,
        weight: s.weight,
      });
      linked.add(s.source).add(s.target);
    }

    const ids = [...linked];
    const listsByContact = new Map<string, string[]>();
    if (ids.length > 0) {
      const rows = sqlite
        .prepare(
          `SELECT lm.contactId, lm.listId
             FROM list_members lm
             JOIN lists l ON l.id = lm.listId
            WHERE l.ownerId = ?`,
        )
        .all(scope.ownerId) as Array<{ contactId: string; listId: string }>;
      for (const row of rows) {
        if (!linked.has(row.contactId)) continue;
        const list = listsByContact.get(row.contactId) ?? [];
        list.push(row.listId);
        listsByContact.set(row.contactId, list);
      }
    }

    const lists = sqlite
      .prepare(
        "SELECT id, name, icon FROM lists WHERE ownerId = ? ORDER BY sortOrder",
      )
      .all(scope.ownerId) as Array<{ id: string; name: string; icon: string }>;

    return {
      nodes: ids
        .map((id) => active.get(id)!)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          id: c.id,
          name: c.name,
          avatarUrl: c.avatarUrl,
          themeColor: c.themeColor,
          company: c.company,
          score: c.score,
          listIds: listsByContact.get(c.id) ?? [],
        })),
      edges,
      lists,
    };
  },
};
