/** Hooks for the connections between contacts, and the network they draw. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson, jsonBody } from "./client";
import type {
  Connection,
  Network,
  networkRoutes,
} from "../../shared/contracts/network";

/** The network: everyone with a tie, the stated connections, shared notes. */
export const useNetwork = (minShared = 1) =>
  useQuery({
    queryKey: ["network", minShared],
    queryFn: ({ signal }): Promise<Network> =>
      apiJson<typeof networkRoutes.network>(
        "GET",
        `/network?minShared=${minShared}`,
        { signal },
      ),
  });

/** The connections of one contact, both ways. */
export const useConnections = (contactId: string | undefined) =>
  useQuery({
    queryKey: ["connections", contactId],
    enabled: Boolean(contactId),
    queryFn: ({ signal }): Promise<Connection[]> =>
      apiJson<typeof networkRoutes.connections>(
        "GET",
        `/contacts/${contactId}/connections`,
        { signal },
      ),
  });

export const useCreateConnection = (contactId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      relatedContactId: string;
      type: string;
    }): Promise<Connection> =>
      apiJson<typeof networkRoutes.createConnection>(
        "POST",
        `/contacts/${contactId}/connections`,
        jsonBody(data),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
  });
};

export const useDeleteConnection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiJson<typeof networkRoutes.deleteConnection>(
        "DELETE",
        `/connections/${id}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      queryClient.invalidateQueries({ queryKey: ["network"] });
    },
  });
};
