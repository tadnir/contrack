// Connections between contacts, and the network view that draws them.

import { defineModule } from "../module.ts";
import { networkRouter } from "../../routes/network.ts";

export const networkModule = defineModule({
  id: "network",
  routers: [{ path: "/api", router: networkRouter }],
});
