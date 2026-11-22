/**
 * Connections: the person's network as a picture. Each contact with a tie to
 * another is a dot. Solid lines are connections the person stated; dashed
 * lines join contacts who share notes, meetings or messages, thicker the
 * more they share. Pointing at a contact lights up its ties, a click opens
 * it, and a drag on the background moves the picture.
 */
import React, { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { PageHeader } from "../../../components/layout/PageHeader";
import { Segmented } from "../../../components/ui/Segmented";
import { useNetwork } from "../../../api/network";
import { PAGE_TOP, PAGE_X } from "../../../lib/styles";
import { NAMES } from "../../../lib/names";
import { cn } from "../../../lib/utils";
import { fallbackAvatarUrl } from "../../../lib/avatar";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { forceLayout } from "../lib/networkLayout";

const SIZE = 1000;
const PAD = 80;

interface View {
  x: number;
  y: number;
  zoom: number;
}

const HOME: View = { x: 0, y: 0, zoom: 1 };

export const ConnectionsPage = () => {
  usePageTitle(NAMES.connections.title);
  const navigate = useNavigate();
  const [minShared, setMinShared] = useState(1);
  const [listId, setListId] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<View>(HOME);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { data, isLoading } = useNetwork(minShared);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    if (!listId) return data;
    const inList = new Set(
      data.nodes.filter((n) => n.listIds.includes(listId)).map((n) => n.id),
    );
    const kept = data.edges.filter(
      (e) => inList.has(e.source) && inList.has(e.target),
    );
    const linked = new Set(kept.flatMap((e) => [e.source, e.target]));
    return {
      nodes: data.nodes.filter((n) => linked.has(n.id)),
      edges: kept,
    };
  }, [data, listId]);

  const positions = useMemo(
    () => forceLayout(nodes, edges, SIZE),
    [nodes, edges],
  );

  // Fit the picture: the layout's extent, with room for the names.
  const box = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX))
      return { x: -SIZE / 2, y: -SIZE / 2, w: SIZE, h: SIZE };
    return {
      x: minX - PAD,
      y: minY - PAD,
      w: Math.max(maxX - minX, 200) + PAD * 2,
      h: Math.max(maxY - minY, 200) + PAD * 2,
    };
  }, [positions]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  const neighbors = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    for (const e of edges) {
      if (e.source === hover) set.add(e.target);
      if (e.target === hover) set.add(e.source);
    }
    return set;
  }, [hover, edges]);

  const w = box.w / view.zoom;
  const h = box.h / view.zoom;
  const viewBox = `${box.x + (box.w - w) / 2 + view.x} ${box.y + (box.h - h) / 2 + view.y} ${w} ${h}`;
  const zoomBy = (factor: number) =>
    setView((v) => ({
      ...v,
      zoom: Math.min(6, Math.max(0.5, v.zoom * factor)),
    }));

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-node]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const start = drag.current;
    const svg = svgRef.current;
    if (!start || !svg) return;
    const scale = w / svg.clientWidth;
    setView({
      ...start.view,
      x: start.view.x - (e.clientX - start.x) * scale,
      y: start.view.y - (e.clientY - start.y) * scale,
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const lists = data?.lists ?? [];
  const empty = !isLoading && nodes.length === 0;

  return (
    <div className="w-full h-full overflow-y-auto bg-surface relative">
      <div
        className={cn(
          "max-w-6xl mx-auto flex flex-col gap-4 pb-16 h-full",
          PAGE_X,
          PAGE_TOP,
        )}
      >
        <PageHeader
          back={{ to: "/pulse", label: NAMES.pulse.label }}
          title={NAMES.connections.label}
          description={NAMES.connections.description}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Shared notes before a tie"
              value={minShared}
              onChange={setMinShared}
              options={[
                { value: 1, label: "1+" },
                { value: 2, label: "2+" },
                { value: 3, label: "3+" },
                { value: 5, label: "5+" },
              ]}
            />
            {lists.length > 0 && (
              <select
                aria-label="Only this list"
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                className="h-9 rounded-md bg-surface-container-low px-2 text-sm"
              >
                <option value="">Everyone</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </PageHeader>

        {empty ? (
          <p className="text-sm text-on-surface-variant max-w-prose">
            No ties yet. Add a connection on a contact's page, or log a note or
            meeting with two people, and they show up here
          </p>
        ) : (
          <div className="relative flex-1 min-h-[420px] rounded-2xl bg-surface-container-low overflow-hidden">
            <svg
              ref={svgRef}
              viewBox={viewBox}
              role="img"
              aria-label={`${nodes.length} contacts and ${edges.length} ties`}
              className="w-full h-full touch-none select-none cursor-grab active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
            >
              <defs>
                <clipPath id="network-avatar" clipPathUnits="objectBoundingBox">
                  <circle cx="0.5" cy="0.5" r="0.5" />
                </clipPath>
              </defs>
              <g>
                {edges.map((e) => {
                  const a = positions.get(e.source);
                  const b = positions.get(e.target);
                  if (!a || !b) return null;
                  const lit =
                    !neighbors ||
                    (neighbors.has(e.source) &&
                      neighbors.has(e.target) &&
                      (e.source === hover || e.target === hover));
                  return (
                    <line
                      key={e.id}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={cn(
                        e.kind === "connection"
                          ? "stroke-primary"
                          : "stroke-on-surface-variant",
                        "transition-opacity",
                      )}
                      strokeWidth={
                        e.kind === "connection"
                          ? 2.5
                          : Math.min(6, 1 + Math.log2(e.weight))
                      }
                      strokeDasharray={e.kind === "shared" ? "6 5" : undefined}
                      opacity={lit ? 0.7 : 0.08}
                    >
                      <title>{e.label}</title>
                    </line>
                  );
                })}
              </g>
              <g>
                {nodes.map((n) => {
                  const p = positions.get(n.id);
                  if (!p) return null;
                  const r = 14 + Math.min(10, (degree.get(n.id) ?? 0) * 1.5);
                  const dim = neighbors && !neighbors.has(n.id);
                  return (
                    <g
                      key={n.id}
                      data-node
                      transform={`translate(${p.x} ${p.y})`}
                      opacity={dim ? 0.2 : 1}
                      className="cursor-pointer transition-opacity focus:outline-none"
                      tabIndex={0}
                      role="link"
                      aria-label={n.name}
                      onPointerEnter={() => setHover(n.id)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(n.id)}
                      onBlur={() => setHover(null)}
                      onClick={() => navigate(`/contact/${n.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") navigate(`/contact/${n.id}`);
                      }}
                    >
                      <circle
                        r={r + 2.5}
                        className={n.themeColor ? undefined : "fill-primary"}
                        fill={n.themeColor ?? undefined}
                      />
                      <image
                        href={n.avatarUrl || fallbackAvatarUrl(n.name)}
                        x={-r}
                        y={-r}
                        width={r * 2}
                        height={r * 2}
                        clipPath="url(#network-avatar)"
                        preserveAspectRatio="xMidYMid slice"
                      />
                      <text
                        y={r + 16}
                        textAnchor="middle"
                        className="fill-on-surface text-[13px] font-semibold"
                        paintOrder="stroke"
                        stroke="var(--color-surface-container-low, white)"
                        strokeWidth={4}
                      >
                        {n.name}
                      </text>
                      <title>
                        {n.company ? `${n.name}, ${n.company}` : n.name}
                      </title>
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className="absolute right-3 bottom-3 flex flex-col gap-1">
              <button
                type="button"
                className="btn-secondary btn-sm"
                aria-label="Zoom in"
                onClick={() => zoomBy(1.25)}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                aria-label="Zoom out"
                onClick={() => zoomBy(0.8)}
              >
                <Minus className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                aria-label="Fit the picture"
                onClick={() => setView(HOME)}
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="absolute left-3 bottom-3 flex gap-4 text-xs text-on-surface-variant">
              <span className="flex items-center gap-1.5">
                <svg width="24" height="6" aria-hidden="true">
                  <line
                    x1="0"
                    y1="3"
                    x2="24"
                    y2="3"
                    className="stroke-primary"
                    strokeWidth={2.5}
                  />
                </svg>
                Connection
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="24" height="6" aria-hidden="true">
                  <line
                    x1="0"
                    y1="3"
                    x2="24"
                    y2="3"
                    className="stroke-on-surface-variant"
                    strokeWidth={2}
                    strokeDasharray="6 5"
                  />
                </svg>
                Shared notes
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
