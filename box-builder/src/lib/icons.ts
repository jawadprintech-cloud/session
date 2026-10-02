/**
 * Built-in vector icons and packaging symbols, drawn as strokes on a 24×24 grid.
 * Several paths follow the Lucide icon set (ISC licence).
 * To add one: append an entry with an id, a label and its SVG path data.
 */
export interface IconDef {
  id: string;
  label: string;
  group: "Packaging" | "Eco" | "Decor" | "Contact";
  paths: string[];
  /** Fill closed shapes as well as stroking them. */
  solid?: boolean;
}

export const ICONS: IconDef[] = [
  { id: "this-way-up", label: "This way up", group: "Packaging", paths: ["M3 22h18", "M8 19V4", "M4.5 7.5 8 4l3.5 3.5", "M16 19V4", "M12.5 7.5 16 4l3.5 3.5"] },
  { id: "fragile", label: "Fragile", group: "Packaging", paths: ["M8 22h8", "M7 10h10", "M12 15v7", "M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"] },
  { id: "keep-dry", label: "Keep dry", group: "Packaging", paths: ["M22 12a10 10 0 0 0-20 0Z", "M12 12v8a2 2 0 0 0 4 0", "M12 2v1", "M5 4.5l-1 2", "M19 4.5l1 2"] },
  { id: "handle-care", label: "Handle with care", group: "Packaging", paths: ["M3 14h4l3 3 3-3h3", "M7 14 9 9h6l2 5", "M12 9V3", "M9.5 5.5 12 3l2.5 2.5", "M3 21h18"] },
  { id: "no-stack", label: "Do not stack", group: "Packaging", paths: ["M4 14h16v7H4z", "M7 3h10v7H7z", "M3 2l18 20"] },
  { id: "keep-cool", label: "Keep cool", group: "Packaging", paths: ["M12 2v20", "M4.9 6l14.2 12", "M19.1 6 4.9 18", "M9 3.5l3 2 3-2", "M9 20.5l3-2 3 2", "M3.5 9.5 6 12l-2.5 2.5", "M20.5 9.5 18 12l2.5 2.5"] },
  { id: "recycle", label: "Recyclable", group: "Eco", paths: ["M7 19H4.8a1.8 1.8 0 0 1-1.6-.9 1.8 1.8 0 0 1 0-1.8L7.2 9.5", "M11 19h8.2a1.8 1.8 0 0 0 1.6-.9 1.8 1.8 0 0 0 0-1.8l-1.2-2.1", "m14 16-3 3 3 3", "M8.3 13.6 7.2 9.5l-4.1 1.1", "m9.3 5.8 1.1-1.9A1.8 1.8 0 0 1 12 3a1.8 1.8 0 0 1 1.5.9l3.9 6.8", "m13.4 9.6 4.1 1.1 1.1-4.1"] },
  { id: "leaf", label: "Eco-friendly", group: "Eco", paths: ["M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z", "M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12"] },
  { id: "globe", label: "Made with care worldwide", group: "Eco", paths: ["M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0", "M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"] },
  { id: "heart", label: "Heart", group: "Decor", paths: ["M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"], solid: true },
  { id: "star", label: "Star", group: "Decor", paths: ["M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.1 2 9.3l6.9-1L12 2z"], solid: true },
  { id: "sparkle", label: "Sparkle", group: "Decor", paths: ["M12 2c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7Z", "M19 15c.3 2 .9 2.7 3 3-2.1.3-2.7 1-3 3-.3-2-.9-2.7-3-3 2.1-.3 2.7-1 3-3Z"], solid: true },
  { id: "badge", label: "Quality badge", group: "Decor", paths: ["M12 2l2.4 1.8 3-.2 1 2.8 2.6 1.6-.8 2.9.8 2.9-2.6 1.6-1 2.8-3-.2L12 22l-2.4-1.8-3 .2-1-2.8-2.6-1.6.8-2.9-.8-2.9 2.6-1.6 1-2.8 3 .2Z", "m8.5 12 2.5 2.5 4.5-5"] },
  { id: "check", label: "Check", group: "Decor", paths: ["M20 6 9 17l-5-5"] },
  { id: "arrow", label: "Arrow", group: "Decor", paths: ["M4 12h16", "m14 6 6 6-6 6"] },
  { id: "mail", label: "Email", group: "Contact", paths: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "m22 6-10 7L2 6"] },
  { id: "phone", label: "Phone", group: "Contact", paths: ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"] },
  { id: "pin", label: "Location", group: "Contact", paths: ["M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z", "M9 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0"] },
];

const pathCache = new Map<string, Path2D[]>();

export function iconPaths(id: string): Path2D[] {
  let p = pathCache.get(id);
  if (!p) {
    const def = ICONS.find((i) => i.id === id);
    p = (def?.paths ?? []).map((d) => new Path2D(d));
    pathCache.set(id, p);
  }
  return p;
}

export function iconDef(id: string): IconDef | undefined {
  return ICONS.find((i) => i.id === id);
}
