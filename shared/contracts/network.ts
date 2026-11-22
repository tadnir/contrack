// Contracts: connections and the network
// How the person's contacts are tied to each other. A connection is one the
// person states, such as "Dana is Avi's sister". The network adds the ties
// Contrack sees on its own: contacts who share notes, meetings or messages.

import { z } from "zod";
import { route } from "./route.ts";
import { INTERNAL, okSchema } from "./common.ts";

// Request bodies

const connectionCreateSchema = z.object({
  /** The other contact. */
  relatedContactId: z.string().trim().min(1).max(200),
  /** How the two are connected, such as "sister" or "colleague". */
  type: z.string().trim().min(1, "Say how they are connected").max(50),
});

const NETWORK_MIN_SHARED_MESSAGE = "minShared must be an integer from 1 to 50";

const networkQuerySchema = z.object({
  minShared: z
    .string({ error: NETWORK_MIN_SHARED_MESSAGE })
    .regex(/^\d+$/, NETWORK_MIN_SHARED_MESSAGE)
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, NETWORK_MIN_SHARED_MESSAGE)
        .max(50, NETWORK_MIN_SHARED_MESSAGE),
    )
    .default(1)
    .describe(
      "1 to 50, 1 when absent: how many notes two contacts share before the network draws a tie",
    ),
});

// Answers

/** The other contact of a connection, as a contact page lists it. */
const connectionPersonSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});

const connectionSchema = z
  .strictObject({
    id: z.string(),
    /** The contact the connection was read from. */
    contactId: z.string(),
    /** How `contactId` is to the other one, as the person wrote it. */
    type: z.string(),
    /**
     * `out`: this contact is the `type` of the other ("sister of Avi").
     * `in`: the other is the `type` of this one.
     */
    direction: z.enum(["out", "in"]),
    other: connectionPersonSchema,
    createdAt: z.string().nullable(),
    ownerId: z.string().meta(INTERNAL),
  })
  .meta({ id: "Connection" });

const networkNodeSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    themeColor: z.string().nullable(),
    company: z.string().nullable(),
    /** The relationship score, 0 to 100. */
    score: z.number().nullable(),
    /** The ids of the lists the contact is in. */
    listIds: z.array(z.string()),
  })
  .meta({ id: "NetworkNode" });

const networkEdgeSchema = z
  .strictObject({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    /**
     * `connection`: a tie the person stated. `shared`: the two appear on
     * the same notes, meetings or messages.
     */
    kind: z.enum(["connection", "shared"]),
    /** The connection's type, or how many notes the two share. */
    label: z.string(),
    /** 1 for a connection; the shared count for `shared`. */
    weight: z.number().int(),
  })
  .meta({ id: "NetworkEdge" });

const networkSchema = z
  .strictObject({
    nodes: z.array(networkNodeSchema),
    edges: z.array(networkEdgeSchema),
    lists: z.array(
      z.strictObject({ id: z.string(), name: z.string(), icon: z.string() }),
    ),
  })
  .meta({ id: "Network" });

// Routes

export const networkRoutes = {
  connections: route({
    method: "GET",
    path: "/api/contacts/:id/connections",
    summary: "The connections the person stated for this contact, both ways",
    response: z.array(connectionSchema),
  }),
  createConnection: route({
    method: "POST",
    path: "/api/contacts/:id/connections",
    summary:
      "State how this contact is connected to another, such as their sister",
    status: 201,
    body: connectionCreateSchema,
    response: connectionSchema,
  }),
  deleteConnection: route({
    method: "DELETE",
    path: "/api/connections/:id",
    summary: "Remove a connection",
    response: okSchema,
  }),
  network: route({
    method: "GET",
    path: "/api/network",
    summary:
      "Every contact with a tie to another, the stated connections, and the contacts who share notes",
    query: networkQuerySchema,
    response: networkSchema,
  }),
};

export type Connection = z.infer<typeof connectionSchema>;
export type NetworkNode = z.infer<typeof networkNodeSchema>;
export type NetworkEdge = z.infer<typeof networkEdgeSchema>;
export type Network = z.infer<typeof networkSchema>;
