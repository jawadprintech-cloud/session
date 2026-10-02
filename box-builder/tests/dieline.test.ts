import { describe, expect, it } from "vitest";
import { evaluate } from "../shared/expr";
import { buildDieline, mirrorDieline } from "../shared/dieline";
import { applySurfaceView, hasInsidePrint, surfaceView, type Design } from "../shared/design";
import { foldedBounds } from "../shared/fold";
import { pointInPolygon, bboxOf, type Pt } from "../shared/geom";
import { BUILTIN_TEMPLATES } from "../shared/templates";
import { validateDims, validateTemplate } from "../shared/validate";
import { DEFAULT_CATALOG } from "../shared/catalog";

const opts = { bleed: 3, safe: 3 };
const settings = DEFAULT_CATALOG.settings;

describe("expression evaluator", () => {
  it("handles precedence, functions and ternaries", () => {
    expect(evaluate("2 + 3 * 4", {})).toBe(14);
    expect(evaluate("(2 + 3) * 4", {})).toBe(20);
    expect(evaluate("-L / 2", { L: 10 })).toBe(-5);
    expect(evaluate("clamp(W * 0.3, 12, 20)", { W: 100 })).toBe(20);
    expect(evaluate("min(1, 2, -3)", {})).toBe(-3);
    expect(evaluate("H <= W ? 1 : 0", { H: 1, W: 2 })).toBe(1);
    expect(evaluate("2 ^ 3 ^ 2", {})).toBe(512);
    expect(evaluate("W > 1 && H > 1", { W: 2, H: 0 })).toBe(0);
  });
  it("rejects unknown identifiers and code", () => {
    expect(() => evaluate("process.exit()", {})).toThrow();
    expect(() => evaluate("foo + 1", {})).toThrow(/Unknown variable/);
    expect(() => evaluate("constructor", {})).toThrow();
  });
});

/** Sample interior points of a polygon on a grid. */
function interiorSamples(poly: Pt[], n = 7): Pt[] {
  const bb = bboxOf(poly);
  const out: Pt[] = [];
  for (let i = 1; i < n; i++)
    for (let j = 1; j < n; j++) {
      const p: Pt = [bb.x + (bb.w * i) / n, bb.y + (bb.h * j) / n];
      if (pointInPolygon(p, poly)) out.push(p);
    }
  return out;
}

for (const t of BUILTIN_TEMPLATES) {
  describe(`template ${t.id}`, () => {
    const sizes = [
      { label: "default", dims: Object.fromEntries(t.dimensions.map((d) => [d.key, d.default])) },
      ...(t.standardSizes ?? []).map((s) => ({ label: s.label, dims: s.dims })),
    ];

    it("passes structural validation", () => {
      expect(validateTemplate(t, settings)).toEqual([]);
    });

    for (const { label, dims } of sizes) {
      it(`builds a sane dieline at ${label}`, () => {
        const v = validateDims(t, dims, settings);
        expect(v.general).toEqual([]);
        expect(v.ok).toBe(true);
        const dl = buildDieline(t, dims, opts);
        expect(dl.panels.length).toBe(t.panels.length);
        expect(dl.cutLines.length).toBeGreaterThan(3);
        // every child panel shares a fold with its parent
        const folds = dl.foldLines.length;
        expect(folds).toBeGreaterThanOrEqual(dl.panels.filter((p) => p.parent).length);
        // panels never overlap on the flat sheet
        for (const a of dl.panels) {
          for (const pt of interiorSamples(a.polygon)) {
            for (const b of dl.panels) {
              if (a === b) continue;
              const inside = pointInPolygon(pt, b.polygon);
              if (inside) throw new Error(`${a.id} overlaps ${b.id} at ${pt.map((n) => n.toFixed(1))}`);
            }
          }
        }
        // everything lies on the sheet
        for (const p of dl.panels) {
          expect(p.bbox.x).toBeGreaterThanOrEqual(0);
          expect(p.bbox.y).toBeGreaterThanOrEqual(0);
          expect(p.bbox.x + p.bbox.w).toBeLessThanOrEqual(dl.width + 1e-6);
          expect(p.bbox.y + p.bbox.h).toBeLessThanOrEqual(dl.height + 1e-6);
        }
      });
    }

    it("folds into a box of the requested size", () => {
      const dims = Object.fromEntries(t.dimensions.map((d) => [d.key, d.default]));
      const dl = buildDieline(t, dims, opts);
      const b = foldedBounds(dl, { progress: 1, open: 0 });
      const [sx, sy, sz] = b.size;
      const tol = 12; // clearances, cover wraps and flap stacking
      if (t.id === "pillow-box") {
        expect(Math.abs(sx - dims.L)).toBeLessThan(tol);
        expect(Math.abs(sy - dims.W)).toBeLessThan(tol);
        expect(Math.abs(sz - dims.H)).toBeLessThan(tol);
      } else if (t.id === "french-fry-box" || t.id === "burger-box") {
        expect(Math.abs(sx - dims.L)).toBeLessThan(tol);
        expect(Math.abs(sy - dims.H)).toBeLessThan(tol);
        expect(Math.abs(sz - dims.W)).toBeLessThan(tol);
      } else {
        expect(Math.abs(sx - dims.L)).toBeLessThan(tol);
        expect(Math.abs(sy - dims.H)).toBeLessThan(tol);
        expect(Math.abs(sz - dims.W)).toBeLessThan(tol);
      }
    });

    it("flat state lies in a plane", () => {
      const dims = Object.fromEntries(t.dimensions.map((d) => [d.key, d.default]));
      const dl = buildDieline(t, dims, opts);
      const b = foldedBounds(dl, { progress: 0, open: 0 });
      expect(b.size[2]).toBeLessThan(1e-6);
      expect(Math.abs(b.size[0] - (dl.width - 2 * (opts.bleed + 10)))).toBeLessThan(1);
    });
  });
}

describe("validation", () => {
  const rte = BUILTIN_TEMPLATES.find((t) => t.id === "reverse-tuck-end")!;
  it("rejects out-of-range dimensions", () => {
    const v = validateDims(rte, { L: 5, W: 60, H: 150 }, settings);
    expect(v.ok).toBe(false);
    expect(v.fields.L).toMatch(/at least/);
  });
  it("rejects constraint violations", () => {
    const mailer = BUILTIN_TEMPLATES.find((t) => t.id === "mailer-box")!;
    const v = validateDims(mailer, { L: 300, W: 100, H: 150 }, settings);
    expect(v.ok).toBe(false);
    expect(v.general.join(" ")).toMatch(/Height/);
  });
  it("rejects dielines larger than the maximum sheet", () => {
    const v = validateDims(rte, { L: 500, W: 350, H: 600 }, settings);
    expect(v.ok).toBe(false);
    expect(v.general.join(" ")).toMatch(/maximum sheet/);
  });
  it("reports bad admin templates", () => {
    expect(validateTemplate({ schema: 1, id: "X", name: "" }, settings).length).toBeGreaterThan(0);
    const broken = { ...rte, id: "broken", panels: [...rte.panels, { id: "x", label: "X", parent: "nope", edge: "top", depth: 10 }] };
    expect(validateTemplate(broken, settings).join(" ")).toMatch(/Unknown panel/);
  });
});

describe("interior (mirrored) dieline", () => {
  const t = BUILTIN_TEMPLATES.find((x) => x.id === "reverse-tuck-end")!;
  const dl = buildDieline(t, { L: 90, W: 60, H: 150 }, opts);
  const m = mirrorDieline(dl);
  it("mirrors every panel left-to-right and keeps sizes", () => {
    for (const p of dl.panels) {
      const q = m.byId[p.id];
      expect(q.bbox.w).toBeCloseTo(p.bbox.w, 6);
      expect(q.center[0]).toBeCloseTo(dl.width - p.center[0], 6);
      expect(q.center[1]).toBeCloseTo(p.center[1], 6);
    }
    expect(m.cutLines.length).toBe(dl.cutLines.length);
    expect(mirrorDieline(dl)).toBe(m); // cached
  });
  it("swaps the left-to-right order of panels when seen from inside", () => {
    expect(dl.byId["right"].center[0]).toBeLessThan(dl.byId["back"].center[0]);
    expect(m.byId["right"].center[0]).toBeGreaterThan(m.byId["back"].center[0]);
  });
});

describe("surface views", () => {
  const design = {
    version: 1, name: "x", styleId: "mailer-box", dims: {}, sizeMode: "custom", unit: "mm", materialId: "kraft",
    colors: { base: { hex: "#ffffff" }, panels: {} }, laminationId: null, elements: [],
  } as unknown as Design;
  it("edits to the interior never touch the exterior and vice versa", () => {
    const inside = surfaceView(design, "inside");
    expect(inside.elements).toEqual([]);
    expect(inside.colors.base).toBeNull();
    const edited = applySurfaceView(design, "inside", { ...inside, colors: { base: { hex: "#ff0000" }, panels: {} } });
    expect(edited.colors.base?.hex).toBe("#ffffff");
    expect(edited.inside?.colors.base?.hex).toBe("#ff0000");
    expect(hasInsidePrint(edited)).toBe(true);
    const out = applySurfaceView(edited, "outside", { ...surfaceView(edited, "outside"), name: "y" });
    expect(out.inside?.colors.base?.hex).toBe("#ff0000");
    expect(hasInsidePrint(design)).toBe(false);
  });
});
