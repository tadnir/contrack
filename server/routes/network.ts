import { Router } from "express";
import { log } from "../utils/logger.ts";
import { networkService } from "../services/networkService.ts";
import { parseQuery, validateBody } from "../utils/validators.ts";
import { networkRoutes } from "../../shared/contracts/network.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";

const router = Router();

router.get(
  "/contacts/:id/connections",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const rows = networkService.listConnections(
      scopeOf(req),
      String(req.params.id),
    );
    log.debug(
      "API",
      `[${rid}] GET /api/contacts/${String(req.params.id)}/connections → ${rows.length}`,
    );
    res.json(rows);
  }),
);

router.post(
  "/contacts/:id/connections",
  validateBody(networkRoutes.createConnection.body),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const made = networkService.createConnection(
      scopeOf(req),
      String(req.params.id),
      req.body.relatedContactId,
      req.body.type,
    );
    log.info(
      "API",
      `[${rid}] POST /api/contacts/${String(req.params.id)}/connections → ${made.id}`,
    );
    res.status(201).json(made);
  }),
);

router.delete(
  "/connections/:id",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    networkService.deleteConnection(scopeOf(req), String(req.params.id));
    log.info(
      "API",
      `[${rid}] DELETE /api/connections/${String(req.params.id)}`,
    );
    res.json({ success: true });
  }),
);

router.get(
  "/network",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const { minShared } = parseQuery(networkRoutes.network.query, req.query);
    const network = networkService.getNetwork(scopeOf(req), minShared);
    log.debug(
      "API",
      `[${rid}] GET /api/network → ${network.nodes.length} people, ${network.edges.length} ties`,
    );
    res.json(network);
  }),
);

export const networkRouter = router;
