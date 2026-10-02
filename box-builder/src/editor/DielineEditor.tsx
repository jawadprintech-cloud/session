import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ResolvedCatalog } from "../../shared/catalog";
import type { Dieline } from "../../shared/dieline";
import { elementCenter, panelPaint, relativeTo, type Design, type DesignElement } from "../../shared/design";
import { luminance } from "../lib/color";
import { pointInPolygon, type Pt } from "../../shared/geom";
import { elementCorners, elementSize, renderDesign, type RenderSources } from "../render/renderDesign";
import { bboxOf } from "../../shared/geom";

export interface Guides {
  cut: boolean;
  fold: boolean;
  bleed: boolean;
  safe: boolean;
  labels: boolean;
}

interface Props {
  dieline: Dieline;
  design: Design;
  catalog: ResolvedCatalog;
  sources: RenderSources;
  version: number;
  guides: Guides;
  selectedId: string | null;
  activePanelId: string | null;
  onSelectElement: (id: string | null) => void;
  onSelectPanel: (id: string) => void;
  onChangeElement: (id: string, patch: Partial<DesignElement>, mergeKey: string) => void;
  /** Quick actions shown next to the selected item (never on top of it). */
  selectionActions?: React.ReactNode;
}

type Gesture =
  | { kind: "pan"; startX: number; startY: number; pan0: Pt; moved: boolean; panelId: string | null }
  | { kind: "move"; id: string; start: Pt; center0: Pt; moved: boolean }
  | { kind: "resize"; id: string; anchor: Pt; sx: number; sy: number; w0: number; h0: number; rot: number; free: boolean; axis: "both" | "x" | "y"; font0?: number }
  | { kind: "rotate"; id: string; center: Pt }
  | { kind: "pinch"; d0: number; zoom0: number; mid: Pt };

const polyD = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("") + "Z";
const segsD = (segs: [Pt, Pt][]) => segs.map(([a, b]) => `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`).join("");

const MAX_CANVAS_PX = 30_000_000;

export function DielineEditor(p: Props) {
  const uid = useId().replace(/:/g, "");
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vp, setVp] = useState({ w: 800, h: 600 });
  // Zoom/pan live in a ref as well as state, so rapid wheel events and button clicks
  // always build on the latest view instead of a stale render (which made zoom jump).
  const [view, setViewState] = useState<{ zoom: number; pan: Pt }>({ zoom: 1, pan: [0, 0] });
  const viewRef = useRef(view);
  const geomRef = useRef({ fit: 1, vp: { w: 800, h: 600 }, W: 1, H: 1 });
  const setView = useCallback((v: { zoom: number; pan: Pt }) => {
    // Keep at least part of the sheet on screen so it can't be lost off the edge.
    const g = geomRef.current;
    const s = g.fit * v.zoom;
    const mx = (g.vp.w + g.W * s) / 2 - 60, my = (g.vp.h + g.H * s) / 2 - 60;
    const pan: Pt = [Math.max(-mx, Math.min(mx, v.pan[0])), Math.max(-my, Math.min(my, v.pan[1]))];
    viewRef.current = { zoom: v.zoom, pan };
    setViewState(viewRef.current);
  }, []);
  const setPan = useCallback((fn: Pt | ((p: Pt) => Pt)) => {
    const cur = viewRef.current;
    setView({ zoom: cur.zoom, pan: typeof fn === "function" ? fn(cur.pan) : fn });
  }, [setView]);
  const zoom = view.zoom, pan = view.pan;
  const anim = useRef(0);
  /** Where a running button-zoom animation is heading, so quick repeated clicks add up. */
  const animTarget = useRef<number | null>(null);
  const [snap, setSnap] = useState<{ x?: number; y?: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  // True while an item is being moved/resized/rotated (hides the floating action bar).
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, Pt>());
  const dl = p.dieline;

  useLayoutEffect(() => {
    const el = viewportRef.current!;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Refit when the style changes.
  useEffect(() => {
    cancelAnimationFrame(anim.current);
    setView({ zoom: 1, pan: [0, 0] });
  }, [dl.templateId, setView]);

  const fit = Math.max(0.05, Math.min((vp.w - 48) / dl.width, (vp.h - 48) / dl.height));
  const scale = fit * zoom;
  const stageW = dl.width * scale, stageH = dl.height * scale;
  const left = (vp.w - stageW) / 2 + pan[0];
  const top = (vp.h - stageH) / 2 + pan[1];
  geomRef.current = { fit, vp, W: dl.width, H: dl.height };

  // Re-render the sheet at full sharpness only once zooming pauses (CSS scaling covers the gap).
  const [renderScale, setRenderScale] = useState(scale);
  useEffect(() => {
    const t = setTimeout(() => setRenderScale(scale), 140);
    return () => clearTimeout(t);
  }, [scale]);

  // ------------------------------------------------------------- canvas
  const raf = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let px = renderScale * dpr;
      const pixels = dl.width * dl.height * px * px;
      if (pixels > MAX_CANVAS_PX) px *= Math.sqrt(MAX_CANVAS_PX / pixels);
      const W = Math.max(1, Math.round(dl.width * px)), H = Math.max(1, Math.round(dl.height * px));
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      renderDesign(c.getContext("2d")!, dl, p.design, p.catalog, p.sources, { pxPerMm: px, mode: "color", board: true, editor: true });
    });
    return () => cancelAnimationFrame(raf.current);
  }, [dl, p.design, p.catalog, p.sources, p.version, renderScale]);

  // ------------------------------------------------------------- helpers
  const toMm = useCallback(
    (clientX: number, clientY: number): Pt => {
      const r = svgRef.current!.getBoundingClientRect();
      return [((clientX - r.left) / r.width) * dl.width, ((clientY - r.top) / r.height) * dl.height];
    },
    [dl.width, dl.height],
  );

  /** Zoom to `newZoom`, keeping the sheet point under (clientX, clientY) fixed. */
  const zoomAt = useCallback(
    (newZoom: number, clientX: number, clientY: number) => {
      const g = geomRef.current;
      const v = viewRef.current;
      const z = Math.max(0.25, Math.min(12, newZoom));
      const r = viewportRef.current!.getBoundingClientRect();
      const mx = clientX - r.left, my = clientY - r.top;
      const s0 = g.fit * v.zoom, s1 = g.fit * z;
      const left0 = (g.vp.w - g.W * s0) / 2 + v.pan[0], top0 = (g.vp.h - g.H * s0) / 2 + v.pan[1];
      const mmX = (mx - left0) / s0, mmY = (my - top0) / s0;
      setView({ zoom: z, pan: [mx - mmX * s1 - (g.vp.w - g.W * s1) / 2, my - mmY * s1 - (g.vp.h - g.H * s1) / 2] });
    },
    [setView],
  );

  /** Smoothly animate to a zoom level around a screen point (used by the +/- buttons). */
  const animateZoom = useCallback(
    (target: number, clientX: number, clientY: number) => {
      cancelAnimationFrame(anim.current);
      const from = viewRef.current.zoom;
      const to = Math.max(0.25, Math.min(12, target));
      animTarget.current = to;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 180);
        const e = t * (2 - t);
        zoomAt(from * Math.pow(to / from, e), clientX, clientY);
        if (t < 1) anim.current = requestAnimationFrame(step);
        else animTarget.current = null;
      };
      anim.current = requestAnimationFrame(step);
    },
    [zoomAt],
  );

  const fitView = useCallback(() => {
    cancelAnimationFrame(anim.current);
    animTarget.current = null;
    const from = { ...viewRef.current };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 200);
      const e = t * (2 - t);
      setView({ zoom: from.zoom * Math.pow(1 / from.zoom, e), pan: [from.pan[0] * (1 - e), from.pan[1] * (1 - e)] });
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [setView]);

  // One wheel listener for the editor's lifetime; it reads the live view from refs.
  useEffect(() => {
    const el = viewportRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      animTarget.current = null;
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1; // lines/pages → pixels
      const dy = e.deltaY * unit, dx = e.deltaX * unit;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch: fine-grained.
        zoomAt(viewRef.current.zoom * Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.01), e.clientX, e.clientY);
      } else if (Math.abs(dy) >= Math.abs(dx)) {
        // Mouse wheel: one notch ≈ 12%, never more per event.
        zoomAt(viewRef.current.zoom * Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.0012), e.clientX, e.clientY);
      } else {
        setPan(([x, y]) => [x - dx, y - dy]);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(anim.current);
    };
  }, [zoomAt, setPan]);

  const elements = p.design.elements;
  const selected = elements.find((e) => e.id === p.selectedId) ?? null;

  const panelAt = (pt: Pt): string | null => {
    for (const panel of dl.panels) if (panel.printable && pointInPolygon(pt, panel.polygon)) return panel.id;
    for (const panel of dl.panels) if (pointInPolygon(pt, panel.polygon)) return panel.id;
    return null;
  };

  // ------------------------------------------------------------- gestures
  const startPinchIfNeeded = () => {
    if (pointers.current.size !== 2) return false;
    const [a, b] = [...pointers.current.values()];
    gesture.current = { kind: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom0: viewRef.current.zoom, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    return true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    viewportRef.current!.setPointerCapture(e.pointerId);
    if (startPinchIfNeeded()) return;
    const target = e.target as Element;
    const role = target.getAttribute("data-role");
    const id = target.getAttribute("data-id");
    const pt = toMm(e.clientX, e.clientY);
    if (role === "element" && id) {
      p.onSelectElement(id);
      const el = elements.find((x) => x.id === id);
      if (el && !el.locked) gesture.current = { kind: "move", id, start: pt, center0: elementCenter(dl, el), moved: false };
      return;
    }
    if ((role === "handle" || role === "edge") && selected) {
      const [w, h] = elementSize(selected);
      const sx = Number(target.getAttribute("data-sx"));
      const sy = Number(target.getAttribute("data-sy"));
      const rot = (selected.rotation * Math.PI) / 180;
      const c = elementCenter(dl, selected);
      // anchor = opposite corner/edge in sheet space
      const lx = (-sx * w) / 2, ly = (-sy * h) / 2;
      const anchor: Pt = [c[0] + lx * Math.cos(rot) - ly * Math.sin(rot), c[1] + lx * Math.sin(rot) + ly * Math.cos(rot)];
      gesture.current = {
        kind: "resize",
        id: selected.id,
        anchor,
        sx,
        sy,
        w0: w,
        h0: h,
        rot,
        free: selected.type === "shape" || role === "edge",
        axis: role === "edge" ? (sx ? "x" : "y") : "both",
        font0: selected.type === "text" ? selected.fontSize : undefined,
      };
      return;
    }
    if (role === "rotate" && selected) {
      gesture.current = { kind: "rotate", id: selected.id, center: elementCenter(dl, selected) };
      return;
    }
    gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, pan0: viewRef.current.pan, moved: false, panelId: role === "panel" ? id : null };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((g.zoom0 * d) / g.d0, g.mid[0], g.mid[1]);
      return;
    }
    if (g.kind === "pan") {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      g.moved = true;
      setPan([g.pan0[0] + dx, g.pan0[1] + dy]);
      return;
    }
    const el = elements.find((x) => x.id === g.id);
    if (!el) return;
    const pt = toMm(e.clientX, e.clientY);
    if (g.kind !== "move" || g.moved) setDragging(true);
    if (g.kind === "move") {
      let c: Pt = [g.center0[0] + pt[0] - g.start[0], g.center0[1] + pt[1] - g.start[1]];
      if (!g.moved && Math.hypot(pt[0] - g.start[0], pt[1] - g.start[1]) * scale < 3) return;
      g.moved = true;
      setDragging(true);
      const panelId = panelAt(c) ?? el.panelId;
      const panel = dl.byId[panelId];
      // Snap to the panel's centre lines.
      const tol = 7 / scale;
      const s: { x?: number; y?: number } = {};
      if (!e.altKey) {
        if (Math.abs(c[0] - panel.center[0]) < tol) (c = [panel.center[0], c[1]]), (s.x = panel.center[0]);
        if (Math.abs(c[1] - panel.center[1]) < tol) (c = [c[0], panel.center[1]]), (s.y = panel.center[1]);
      }
      setSnap(s.x !== undefined || s.y !== undefined ? s : null);
      p.onChangeElement(g.id, { panelId, ...relativeTo(panel, c) }, `move:${g.id}`);
      return;
    }
    if (g.kind === "resize") {
      const cos = Math.cos(g.rot), sin = Math.sin(g.rot);
      const dx = pt[0] - g.anchor[0], dy = pt[1] - g.anchor[1];
      const vx = dx * cos + dy * sin, vy = -dx * sin + dy * cos; // pointer in element frame
      let w = g.w0, h = g.h0;
      const proportional = g.axis === "both" && (!g.free ? !e.shiftKey : e.shiftKey);
      if (proportional) {
        const d0x = g.sx * g.w0, d0y = g.sy * g.h0;
        const s = Math.max(0.02, (vx * d0x + vy * d0y) / (d0x * d0x + d0y * d0y));
        w = g.w0 * s;
        h = g.h0 * s;
      } else {
        if (g.axis !== "y") w = Math.max(2, g.sx * vx);
        if (g.axis !== "x") h = Math.max(2, g.sy * vy);
      }
      w = Math.max(2, w);
      h = Math.max(el.type === "shape" && el.shape === "line" ? 0.1 : 2, h);
      const hx = (g.sx * w) / 2, hy = (g.sy * h) / 2;
      const c: Pt = [g.anchor[0] + hx * cos - hy * sin, g.anchor[1] + hx * sin + hy * cos];
      const panel = dl.byId[el.panelId] ?? dl.panels[0];
      const patch: Partial<DesignElement> = { ...relativeTo(panel, c) };
      if (el.type === "text") (patch as { fontSize: number }).fontSize = Math.max(2, Math.round((g.font0! * w) / g.w0 * 10) / 10);
      else if (el.type === "qr") Object.assign(patch, { w, h: w });
      else Object.assign(patch, { w, h });
      p.onChangeElement(g.id, patch, `resize:${g.id}`);
      return;
    }
    if (g.kind === "rotate") {
      let deg = (Math.atan2(pt[0] - g.center[0], -(pt[1] - g.center[1])) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else {
        const near = Math.round(deg / 45) * 45;
        if (Math.abs(deg - near) < 4) deg = near;
      }
      deg = ((deg % 360) + 360) % 360;
      p.onChangeElement(g.id, { rotation: Math.round(deg * 10) / 10 }, `rotate:${g.id}`);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "pinch") {
      gesture.current = null;
      return;
    }
    if (g?.kind === "pan" && !g.moved) {
      p.onSelectElement(null);
      if (g.panelId) p.onSelectPanel(g.panelId);
    }
    gesture.current = null;
    setDragging(false);
    setSnap(null);
  };

  // ------------------------------------------------------------- overlay data
  const polys = useMemo(
    () => ({
      panels: dl.panels.map((q) => ({ id: q.id, d: polyD(q.polygon) })),
      dilated: dl.panels.map((q) => polyD(q.dilated)).join(""),
      cut: segsD(dl.cutLines),
      fold: segsD(dl.foldLines),
      safe: dl.panels.filter((q) => q.printable && q.safe).map((q) => polyD(q.safe!)).join(""),
    }),
    [dl],
  );
  const hs = 11 / scale; // handle size in mm
  const active = p.activePanelId ? dl.byId[p.activePanelId] : null;

  const zoomBy = (f: number) => {
    const r = viewportRef.current!.getBoundingClientRect();
    animateZoom((animTarget.current ?? viewRef.current.zoom) * f, r.left + r.width / 2, r.top + r.height / 2);
  };

  return (
    <div className="editor">
      <div
        className="editor-viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="editor-stage" style={{ left, top, width: stageW, height: stageH }}>
          <canvas ref={canvasRef} style={{ width: stageW, height: stageH }} />
          <svg ref={svgRef} viewBox={`0 0 ${dl.width} ${dl.height}`} width={stageW} height={stageH} className="editor-overlay">
            <defs>
              <mask id={`bleed-${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width={dl.width} height={dl.height}>
                <path d={polys.dilated} fill="#fff" />
                {polys.panels.map((q) => (
                  <path key={q.id} d={q.d} fill="#000" />
                ))}
              </mask>
            </defs>
            {p.guides.bleed && (
              <rect x="0" y="0" width={dl.width} height={dl.height} className="g-bleed" mask={`url(#bleed-${uid})`} />
            )}
            {polys.panels.map((q) => (
              <path
                key={q.id}
                d={q.d}
                data-role="panel"
                data-id={q.id}
                className={`g-panel ${q.id === p.activePanelId && !p.selectedId ? "active" : ""}`}
              />
            ))}
            {p.guides.safe && <path d={polys.safe} className="g-safe" vectorEffect="non-scaling-stroke" />}
            {p.guides.fold && <path d={polys.fold} className="g-fold" vectorEffect="non-scaling-stroke" />}
            {p.guides.cut && <path d={polys.cut} className="g-cut" vectorEffect="non-scaling-stroke" />}
            {active && !p.selectedId && <path d={polyD(active.polygon)} className="g-active" vectorEffect="non-scaling-stroke" />}
            {p.guides.labels &&
              dl.panels.map((q) => {
                const vertical = q.upright === 90 || q.upright === 270;
                const span = vertical ? q.bbox.h : q.bbox.w;
                const other = vertical ? q.bbox.w : q.bbox.h;
                const main = q.kind === "panel";
                const size = Math.max(2, Math.min((span * 0.9) / (q.label.length * 0.8 + 0.5), other * 0.28, main ? 11 : 5));
                if (size < 2.2 && !main) return null;
                const bg = q.printable ? panelPaint(p.design, q.id)?.hex : undefined;
                const board = p.catalog.materials.find((m) => m.id === p.design.materialId)?.boardColor;
                const dark = luminance(bg ?? board ?? "#ffffff") < 0.3;
                return (
                  <text
                    key={q.id}
                    className={`g-label ${main ? "" : "minor"} ${dark ? "on-dark" : ""}`}
                    transform={`translate(${q.center[0]} ${q.center[1]}) rotate(${q.upright})`}
                    fontSize={size}
                  >
                    {q.label.toUpperCase()}
                  </text>
                );
              })}
            {elements.filter((el) => !el.hidden).map((el) => {
              const [w, h] = elementSize(el);
              const [cx, cy] = elementCenter(dl, el);
              return (
                <g key={el.id} transform={`translate(${cx} ${cy}) rotate(${el.rotation})`}>
                  <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={Math.max(h, 0.5)}
                    data-role="element"
                    data-id={el.id}
                    className={`g-el ${el.finishes.length ? "finished" : ""} ${el.id === p.selectedId ? "sel" : ""}`}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
            {selected &&
              (() => {
                const [w, h] = elementSize(selected);
                const [cx, cy] = elementCenter(dl, selected);
                const corners = [
                  [-1, -1],
                  [1, -1],
                  [1, 1],
                  [-1, 1],
                ];
                const edges = selected.type === "image" || selected.type === "shape" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [];
                if (selected.locked) {
                  return (
                    <g transform={`translate(${cx} ${cy}) rotate(${selected.rotation})`} pointerEvents="none">
                      <rect x={-w / 2} y={-h / 2} width={w} height={h} className="g-sel locked" vectorEffect="non-scaling-stroke" />
                    </g>
                  );
                }
                return (
                  <g transform={`translate(${cx} ${cy}) rotate(${selected.rotation})`}>
                    <rect x={-w / 2} y={-h / 2} width={w} height={h} className="g-sel" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                    <line x1={0} y1={-h / 2} x2={0} y2={-h / 2 - hs * 2.2} className="g-rotline" vectorEffect="non-scaling-stroke" />
                    <circle cx={0} cy={-h / 2 - hs * 2.2} r={hs * 0.6} className="g-handle round" data-role="rotate" vectorEffect="non-scaling-stroke" />
                    {edges.map(([sx, sy]) => (
                      <rect
                        key={`e${sx}${sy}`}
                        x={(sx * w) / 2 - (sx ? hs * 0.3 : hs * 0.7)}
                        y={(sy * h) / 2 - (sy ? hs * 0.3 : hs * 0.7)}
                        width={sx ? hs * 0.6 : hs * 1.4}
                        height={sy ? hs * 0.6 : hs * 1.4}
                        rx={hs * 0.3}
                        className="g-handle"
                        data-role="edge"
                        data-sx={sx}
                        data-sy={sy}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    {corners.map(([sx, sy]) => (
                      <rect
                        key={`c${sx}${sy}`}
                        x={(sx * w) / 2 - hs / 2}
                        y={(sy * h) / 2 - hs / 2}
                        width={hs}
                        height={hs}
                        className="g-handle"
                        data-role="handle"
                        data-sx={sx}
                        data-sy={sy}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </g>
                );
              })()}
            {snap?.x !== undefined && <line x1={snap.x} y1={0} x2={snap.x} y2={dl.height} className="g-snap" vectorEffect="non-scaling-stroke" />}
            {snap?.y !== undefined && <line x1={0} y1={snap.y} x2={dl.width} y2={snap.y} className="g-snap" vectorEffect="non-scaling-stroke" />}
          </svg>
        </div>
      </div>
      {selected && p.selectionActions && !dragging && (() => {
        // Float the action bar just above the selection (or below it when there is no room).
        const bb = bboxOf(elementCorners(dl, selected));
        const cx = left + (bb.x + bb.w / 2) * scale;
        const above = top + bb.y * scale - hs * 2.2 * scale - 46;
        const y = above > 6 ? above : Math.min(vp.h - 44, top + (bb.y + bb.h) * scale + 12);
        const x = Math.max(110, Math.min(vp.w - 110, cx));
        return (
          <div className="sel-float" style={{ left: x, top: y }}>
            {p.selectionActions}
          </div>
        );
      })()}
      <div className="editor-zoom">
        <button className="icon-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
        <button className="zoom-label" onClick={fitView} title="Fit to screen">
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}
