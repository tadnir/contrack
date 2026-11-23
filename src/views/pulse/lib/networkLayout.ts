/**
 * A force layout for the network page: contacts repel each other, ties pull
 * them together, and a weak pull to the middle keeps loose groups on the
 * page. It runs a fixed number of steps from a seeded start, so the same
 * network always lands the same way, with no physics library.
 */

export interface LayoutNode {
  id: string;
}

export interface LayoutEdge {
  source: string;
  target: string;
  weight: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A small deterministic generator, so a reload keeps the picture. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100_000) / 100_000;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Places each node in a square of side `size` centered on 0,0. Fruchterman
 * and Reingold's method, with a cooling step size. Quadratic in the nodes,
 * which is quick for the few hundred people a person keeps up with.
 */
export function forceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  size = 1000,
  steps = 300,
): Map<string, Point> {
  const n = nodes.length;
  const pos = new Map<string, Point>();
  if (n === 0) return pos;
  const rand = seeded(hash(nodes.map((x) => x.id).join("|")));
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = (rand() - 0.5) * size;
    ys[i] = (rand() - 0.5) * size;
  }
  const links = edges
    .map((e) => ({
      a: index.get(e.source),
      b: index.get(e.target),
      w: Math.min(4, 1 + Math.log2(Math.max(1, e.weight))),
    }))
    .filter(
      (l): l is { a: number; b: number; w: number } =>
        l.a !== undefined && l.b !== undefined,
    );

  const k = Math.sqrt((size * size) / n) * 0.6;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  let temperature = size / 10;
  const cooling = temperature / (steps + 1);

  for (let step = 0; step < steps; step++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = xs[i] - xs[j];
        let ddy = ys[i] - ys[j];
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < 0.01) {
          ddx = rand() - 0.5;
          ddy = rand() - 0.5;
          d2 = 0.01;
        }
        const force = (k * k) / d2;
        dx[i] += ddx * force;
        dy[i] += ddy * force;
        dx[j] -= ddx * force;
        dy[j] -= ddy * force;
      }
    }
    for (const { a, b, w } of links) {
      const ddx = xs[a] - xs[b];
      const ddy = ys[a] - ys[b];
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const force = (d / k) * w;
      dx[a] -= ddx * force;
      dy[a] -= ddy * force;
      dx[b] += ddx * force;
      dy[b] += ddy * force;
    }
    for (let i = 0; i < n; i++) {
      // Gravity, so separate groups stay near each other.
      dx[i] -= xs[i] * 0.02 * (k / 10);
      dy[i] -= ys[i] * 0.02 * (k / 10);
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const move = Math.min(len, temperature);
      xs[i] += (dx[i] / len) * move;
      ys[i] += (dy[i] / len) * move;
    }
    temperature -= cooling;
  }
  nodes.forEach((node, i) => pos.set(node.id, { x: xs[i], y: ys[i] }));
  return pos;
}
