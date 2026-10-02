import { useMemo, useState } from "react";
import type { DesignElement, ShapeElement } from "../../shared/design";
import { ColorPicker } from "../components/ColorPicker";
import { ICONS, type IconDef } from "../lib/icons";
import { makeIcon, makeShape } from "../state/factory";
import { useElementOps, useStudio } from "./context";

function IconGlyph({ def, size = 26 }: { def: IconDef; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={def.solid ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {def.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const SHAPES: { shape: ShapeElement["shape"]; label: string; glyph: string; color: string }[] = [
  { shape: "rect", label: "Rectangle", glyph: "▭", color: "#1d3557" },
  { shape: "ellipse", label: "Circle", glyph: "◯", color: "#e5446d" },
  { shape: "triangle", label: "Triangle", glyph: "△", color: "#2a9d8f" },
  { shape: "star", label: "Star", glyph: "☆", color: "#e9c46a" },
  { shape: "line", label: "Line", glyph: "―", color: "#1a1a1a" },
];

/** Shapes, lines and the packaging icon library. */
export function ElementsPanel() {
  const s = useStudio();
  const ops = useElementOps();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = ICONS.filter((i) => !q || i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q));
    return [...new Set(list.map((i) => i.group))].map((g) => ({ group: g, icons: list.filter((i) => i.group === g) }));
  }, [query]);
  const sel = s.selected?.type === "icon" ? s.selected : null;
  return (
    <div className="tool">
      <h2>Elements</h2>
      <p className="lead">Add shapes, lines and packaging symbols to {s.activePanel.label}. Everything stays sharp at any print size.</p>
      <h3>Shapes</h3>
      <div className="element-grid">
        {SHAPES.map((sh) => (
          <button key={sh.shape} className="element-btn" disabled={s.readOnly} onClick={() => ops.add(makeShape(s.activePanel, sh.shape, sh.color))}>
            <span className="glyph" style={{ color: sh.color }}>{sh.glyph}</span>
            {sh.label}
          </button>
        ))}
      </div>
      <h3>Icons &amp; packaging symbols</h3>
      <input className="input" placeholder="Search icons, e.g. fragile, recycle" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search icons" />
      {groups.map(({ group, icons }) => (
        <div key={group}>
          <span className="label">{group}</span>
          <div className="icon-grid">
            {icons.map((ic) => (
              <button key={ic.id} className="icon-tile" title={ic.label} aria-label={`Add ${ic.label} icon`} disabled={s.readOnly} onClick={() => ops.add(makeIcon(s.activePanel, ic.id, "#1a1a1a"))}>
                <IconGlyph def={ic} />
                <span>{ic.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!groups.length && <p className="hint">No icons match “{query}”.</p>}
      {sel && (
        <>
          <h3>Selected icon colour</h3>
          <ColorPicker idKey={`icon-${sel.id}`} value={sel.color} swatches={s.catalog.colors} onChange={(p, k) => p && ops.patch(sel.id, { color: p }, k)} />
        </>
      )}
    </div>
  );
}

export function elementName(el: DesignElement): string {
  switch (el.type) {
    case "text":
      return `“${el.text.split("\n")[0].slice(0, 28) || "Text"}”`;
    case "image":
      return el.fileName;
    case "qr":
      return `QR · ${el.content.kind}`;
    case "icon":
      return ICONS.find((i) => i.id === el.iconId)?.label ?? "Icon";
    case "shape":
      return el.shape.charAt(0).toUpperCase() + el.shape.slice(1);
  }
}

const TYPE_GLYPH: Record<DesignElement["type"], string> = { text: "T", image: "▣", qr: "▦", icon: "★", shape: "◆" };

/** Every item on the current face, top-most first: select, show/hide, lock and reorder. */
export function LayersPanel() {
  const s = useStudio();
  const ops = useElementOps();
  const els = s.design.elements;
  const ordered = els.map((e, i) => ({ e, i })).reverse();
  const move = (i: number, to: number) =>
    s.update((d) => {
      const arr = d.elements.slice();
      const [it] = arr.splice(i, 1);
      arr.splice(Math.max(0, Math.min(arr.length, to)), 0, it);
      return { ...d, elements: arr };
    });
  return (
    <div className="tool">
      <h2>Layers</h2>
      <p className="lead">Items higher in the list are printed on top. Hidden items are kept in your design but not printed.</p>
      {!els.length && <p className="hint">Nothing on this side of the box yet. Add text, images, shapes or a QR code to get started.</p>}
      <ul className="layer-list">
        {ordered.map(({ e, i }) => (
          <li key={e.id} className={`layer ${s.selected?.id === e.id ? "on" : ""} ${e.hidden ? "is-hidden" : ""}`}>
            <button className="layer-main" onClick={() => s.select(e.id)} title="Select">
              <span className="layer-type" aria-hidden>{TYPE_GLYPH[e.type]}</span>
              <span className="layer-name">{elementName(e)}</span>
              <span className="layer-panel">{s.dieline.byId[e.panelId]?.label ?? "—"}</span>
            </button>
            <div className="layer-actions">
              <button className="icon-btn small" title={e.hidden ? "Show" : "Hide"} aria-label={e.hidden ? `Show ${elementName(e)}` : `Hide ${elementName(e)}`} aria-pressed={!!e.hidden} disabled={s.readOnly} onClick={() => ops.patch(e.id, { hidden: !e.hidden })}>
                {e.hidden ? "◌" : "◉"}
              </button>
              <button className="icon-btn small" title={e.locked ? "Unlock" : "Lock"} aria-label={e.locked ? "Unlock" : "Lock"} aria-pressed={!!e.locked} disabled={s.readOnly} onClick={() => ops.patch(e.id, { locked: !e.locked })}>
                {e.locked ? "🔒" : "🔓"}
              </button>
              <button className="icon-btn small" title="Move up" aria-label="Move up" disabled={s.readOnly || i === els.length - 1} onClick={() => move(i, i + 1)}>↑</button>
              <button className="icon-btn small" title="Move down" aria-label="Move down" disabled={s.readOnly || i === 0} onClick={() => move(i, i - 1)}>↓</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
