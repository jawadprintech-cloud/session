import type { ResolvedCatalog } from "../../shared/catalog";
import { surfaceView, type Design } from "../../shared/design";
import { mirrorDieline, type Dieline } from "../../shared/dieline";
import { pointInPolygon } from "../../shared/geom";
import { qrChecks } from "../panels/DesignPanels";
import { effectiveDpi } from "../panels/Inspector";
import { elementCorners } from "../render/renderDesign";

export interface PreflightItem {
  level: "warn" | "info";
  text: string;
  elementId?: string;
}

/** Print-readiness checks shown before submitting. Warnings never block submission. */
export function preflight(design: Design, dl: Dieline, cat: ResolvedCatalog): PreflightItem[] {
  const out = checkFace(design, dl, cat, "");
  if (design.inside?.elements.length) {
    // Interior items are listed without a "Fix" link (the editor opens on the exterior).
    out.push(...checkFace(surfaceView(design, "inside"), mirrorDieline(dl), cat, "Interior: ").map((i) => ({ ...i, elementId: undefined })));
  }
  return out;
}

function checkFace(design: Design, dl: Dieline, cat: ResolvedCatalog, prefix: string): PreflightItem[] {
  const out: PreflightItem[] = [];
  const panelName = (id: string) => dl.byId[id]?.label ?? "a panel";
  if (!prefix && !design.elements.length && !design.colors.base && !Object.values(design.colors.panels).some(Boolean)) {
    out.push({ level: "info", text: "Your box has no artwork yet — that's fine for a plain box quote." });
  }
  for (const el of design.elements) {
    if (el.hidden) continue;
    if (!dl.byId[el.panelId]) out.push({ level: "warn", text: prefix + "An item is attached to a panel that no longer exists.", elementId: el.id });
    const dpi = effectiveDpi(el);
    if (dpi !== null && dpi < 150 && el.type === "image")
      out.push({ level: "warn", text: prefix + `“${el.fileName}” is only ${dpi} DPI at this size and may print blurry.`, elementId: el.id });
    if (el.type === "qr") for (const c of qrChecks(el)) if (!c.ok) out.push({ level: "warn", text: prefix + `QR code: ${c.text}.`, elementId: el.id });
    if (el.type === "text" && el.fontSize < 6) out.push({ level: "warn", text: prefix + `Text “${el.text.slice(0, 20)}” is smaller than 6 pt.`, elementId: el.id });
    const panel = dl.byId[el.panelId];
    const isBackground = el.type === "image" || el.type === "shape";
    if (panel?.safe && !isBackground) {
      const outside = elementCorners(dl, el).some((c) => !pointInPolygon(c, panel.safe!));
      if (outside) out.push({ level: "warn", text: prefix + `${el.type === "text" ? `Text “${el.text.slice(0, 20)}”` : el.type === "qr" ? "QR code" : "Icon"} crosses the safe area on ${panelName(el.panelId)} and may be trimmed or folded.`, elementId: el.id });
    }
  }
  if (design.elements.some((e) => e.finishes.length) && !cat.finishes.length) {
    out.push({ level: "info", text: "Some finishes are no longer offered and will be reviewed by our team." });
  }
  return out;
}
