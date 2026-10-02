import { createContext, useContext } from "react";
import type { ResolvedCatalog, ResolvedStyle } from "../../shared/catalog";
import type { Design, DesignElement } from "../../shared/design";
import type { Dieline, DielinePanel } from "../../shared/dieline";
import type { ImageCache } from "../lib/images";
import { elementSize } from "../render/renderDesign";

export interface Studio {
  catalog: ResolvedCatalog;
  styles: ResolvedStyle[];
  style: ResolvedStyle;
  design: Design;
  dieline: Dieline;
  update: (fn: (d: Design) => Design, mergeKey?: string) => void;
  selected: DesignElement | null;
  select: (id: string | null) => void;
  activePanel: DielinePanel;
  setActivePanel: (id: string) => void;
  images: ImageCache;
  toast: (msg: string, kind?: "info" | "error" | "success") => void;
  readOnly: boolean;
}

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const s = useContext(StudioContext);
  if (!s) throw new Error("Studio context missing");
  return s;
}

export function useElementOps() {
  const s = useStudio();
  return {
    add(el: DesignElement) {
      // Don't stack new items on top of existing ones: try spots along the panel and take
      // the first that overlaps nothing (or, on a crowded panel, the least-covered one).
      const panel = s.dieline.byId[el.panelId];
      if (el.x === 0 && el.y === 0 && panel) {
        const box = (e: DesignElement, x = e.x, y = e.y) => {
          const [w, h] = elementSize(e);
          const a = (e.rotation * Math.PI) / 180;
          const c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
          return { cx: x * panel.bbox.w, cy: y * panel.bbox.h, hw: (w * c + h * sn) / 2, hh: (w * sn + h * c) / 2 };
        };
        const others = s.design.elements.filter((e) => e.panelId === el.panelId && !e.hidden).map((e) => box(e));
        const cover = (x: number, y: number) => {
          const b = box(el, x, y);
          return others.reduce((sum, o) => {
            const ox = Math.min(b.cx + b.hw, o.cx + o.hw) - Math.max(b.cx - b.hw, o.cx - o.hw);
            const oy = Math.min(b.cy + b.hh, o.cy + o.hh) - Math.max(b.cy - b.hh, o.cy - o.hh);
            return sum + (ox > 0 && oy > 0 ? ox * oy : 0);
          }, 0);
        };
        // Step along the panel's longer side (in its reading orientation) first.
        const turned = el.rotation % 180 !== 0;
        const pw = turned ? panel.bbox.h : panel.bbox.w;
        const ph = turned ? panel.bbox.w : panel.bbox.h;
        const alongY = turned ? pw > ph * 1.2 : ph >= pw * 0.8;
        const steps = [0, 0.3, -0.3, 0.4, -0.4, 0.15, -0.15];
        const spots = [
          ...steps.map((k) => (alongY ? [0, k] : [k, 0])),
          ...steps.flatMap((k) => [0.3, -0.3].map((j) => (alongY ? [j, k] : [k, j]))),
        ];
        let best = spots[0], bestCover = Infinity;
        const fits = (x: number, y: number) => {
          const b = box(el, x, y);
          return Math.abs(b.cx) + b.hw <= panel.bbox.w / 2 + 0.5 && Math.abs(b.cy) + b.hh <= panel.bbox.h / 2 + 0.5;
        };
        for (const [x, y] of spots) {
          if (x !== 0 || y !== 0 ? !fits(x, y) : false) continue;
          const c = cover(x, y);
          if (c < bestCover - 1e-6) [best, bestCover] = [[x, y], c];
          if (c === 0) break;
        }
        el = { ...el, x: best[0], y: best[1] };
      }
      s.update((d) => ({ ...d, elements: [...d.elements, el] }));
      s.select(el.id);
    },
    patch(id: string, patch: Partial<DesignElement>, mergeKey?: string) {
      s.update(
        (d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)) }),
        mergeKey,
      );
    },
    remove(id: string) {
      s.update((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== id) }));
      s.select(null);
    },
  };
}
