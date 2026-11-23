import { describe, expect, it } from "vitest";
import { forceLayout } from "../../../../src/views/pulse/lib/networkLayout";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("forceLayout", () => {
  it("places nothing for an empty network", () => {
    expect(forceLayout([], []).size).toBe(0);
  });

  it("gives the same picture for the same network", () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const edges = [{ source: "a", target: "b", weight: 1 }];
    expect([...forceLayout(nodes, edges)]).toEqual([
      ...forceLayout(nodes, edges),
    ]);
  });

  it("pulls tied contacts closer than untied ones", () => {
    const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));
    const edges = [
      { source: "a", target: "b", weight: 3 },
      { source: "b", target: "c", weight: 1 },
      { source: "a", target: "c", weight: 1 },
      { source: "d", target: "e", weight: 1 },
      { source: "e", target: "f", weight: 1 },
      { source: "d", target: "f", weight: 2 },
    ];
    const pos = forceLayout(nodes, edges);
    const within = dist(pos.get("a")!, pos.get("b")!);
    const across = dist(pos.get("a")!, pos.get("e")!);
    expect(within).toBeLessThan(across);
    for (const p of pos.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it("ignores ties to contacts it was not given", () => {
    const pos = forceLayout(
      [{ id: "a" }],
      [{ source: "a", target: "zz", weight: 1 }],
    );
    expect(pos.size).toBe(1);
  });
});
