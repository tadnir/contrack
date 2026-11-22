/**
 * ConnectionsCard: how this contact is connected to the person's other
 * contacts ("sister of Avi", "colleague of Dana"). A connection is stated
 * once and shows on both contacts. The network page draws them.
 */
import React, { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { useContactNames } from "../../../api/contacts";
import { SearchField } from "../../../components/ui/SearchField";
import {
  useConnections,
  useCreateConnection,
  useDeleteConnection,
} from "../../../api/network";
import {
  BTN_QUIET,
  CARD,
  INLINE_INPUT,
  SECTION_HEADING,
} from "../../../lib/styles";
import { cn, errorText } from "../../../lib/utils";
import { fallbackAvatarUrl } from "../../../lib/avatar";

/** Types offered as you type; any other word works too. */
const SUGGESTED_TYPES = [
  "partner",
  "spouse",
  "parent",
  "child",
  "sibling",
  "sister",
  "brother",
  "cousin",
  "friend",
  "colleague",
  "manager",
  "roommate",
  "neighbor",
];

export const ConnectionsCard = ({ contactId }: { contactId: string }) => {
  const { data: connections = [] } = useConnections(contactId);
  const { data: contacts = [] } = useContactNames();
  const create = useCreateConnection(contactId);
  const remove = useDeleteConnection();

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [type, setType] = useState("");

  const matches = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .filter(
        (c) =>
          c.id !== contactId && !c.isGhost && c.name.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [contacts, contactId, deferred]);

  const reset = () => {
    setAdding(false);
    setQuery("");
    setPicked(null);
    setType("");
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || !type.trim()) return;
    create.mutate(
      { relatedContactId: picked.id, type: type.trim() },
      {
        onSuccess: reset,
        onError: (err) => toast.error(errorText(err)),
      },
    );
  };

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between pb-2 mb-2">
        <h2 className={SECTION_HEADING}>Connections</h2>
        {!adding && (
          <div className="flex items-center gap-1">
            <Link to="/pulse/connections" className={BTN_QUIET}>
              Network
            </Link>
            <button
              type="button"
              className={BTN_QUIET}
              onClick={() => setAdding(true)}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Add
            </button>
          </div>
        )}
      </div>

      {connections.length === 0 && !adding && (
        <p className="text-sm text-on-surface-variant">
          Say how this person knows your other contacts, such as a sister or a
          colleague
        </p>
      )}

      <ul className="space-y-1.5">
        {connections.map((c) => (
          <li
            key={c.id}
            className="group/conn flex items-center gap-2 text-sm min-w-0"
          >
            <img
              src={c.other.avatarUrl || fallbackAvatarUrl(c.other.name)}
              alt=""
              className="w-6 h-6 rounded-full shrink-0 object-cover"
            />
            <span className="min-w-0 truncate">
              {c.direction === "out" ? (
                <>
                  <span className="font-semibold">{c.type}</span> of{" "}
                </>
              ) : null}
              <Link
                to={`/contact/${c.other.id}`}
                className="font-semibold text-on-surface hover:underline"
              >
                {c.other.name}
              </Link>
              {c.direction === "in" ? (
                <>
                  {" "}
                  is their <span className="font-semibold">{c.type}</span>
                </>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => remove.mutate(c.id)}
              className="hit-area ml-auto opacity-100 sm:pointer-fine:opacity-0 sm:pointer-fine:group-hover/conn:opacity-100 focus-visible:opacity-100 text-on-surface-variant hover:text-error transition-opacity"
              aria-label={`Remove the connection with ${c.other.name}`}
              title="Remove"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {adding && (
        <form onSubmit={save} className="mt-3 space-y-2">
          {picked ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold truncate">{picked.name}</span>
              <button
                type="button"
                className={BTN_QUIET}
                onClick={() => setPicked(null)}
              >
                Change
              </button>
            </div>
          ) : (
            <div>
              <SearchField
                aria-label="Search your contacts"
                placeholder="Search your contacts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery("")}
                className="w-full"
              />
              {matches.length > 0 && (
                <ul className="mt-1 rounded-md bg-surface-container-low">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="state-layer w-full text-left px-2 py-1.5 text-sm rounded-md"
                        onClick={() => setPicked({ id: m.id, name: m.name })}
                      >
                        {m.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <input
            aria-label="How they are connected"
            placeholder="This contact is their… (sister, colleague)"
            list={`connection-types-${contactId}`}
            value={type}
            maxLength={50}
            onChange={(e) => setType(e.target.value)}
            className={cn(INLINE_INPUT, "w-full")}
          />
          <datalist id={`connection-types-${contactId}`}>
            {SUGGESTED_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </datalist>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={reset}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!picked || !type.trim() || create.isPending}
            >
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
