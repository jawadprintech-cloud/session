import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { ResolvedCatalog } from "../../shared/catalog";
import type { Design } from "../../shared/design";
import type { Dieline, DielinePanel } from "../../shared/dieline";
import { deformPoint, flat3, foldFromOpenAmount, foldedBounds, meshMatrix, panelTransforms, type FoldState } from "../../shared/fold";
import { applyPoint, type Vec3 } from "../../shared/mat4";
import { finishById, renderDesign, type RenderSources } from "../render/renderDesign";

export type ViewName = "front" | "back" | "left" | "right" | "top" | "bottom" | "hero" | "heroBack" | "flat";

export interface BoxPreviewHandle {
  /** Render still images of the closed box from the given views. */
  capture(views: ViewName[], width: number, height: number): string[];
}

interface Props {
  dieline: Dieline;
  design: Design;
  catalog: ResolvedCatalog;
  sources: RenderSources;
  /** Bumped when images/fonts finish loading. */
  version: number;
  onPickPanel?: (panelId: string) => void;
}

const VIEW_DIRS: Record<ViewName, Vec3> = {
  front: [0, 0.12, 1],
  back: [0, 0.12, -1],
  left: [-1, 0.12, 0],
  right: [1, 0.12, 0],
  top: [0, 1, 0.02],
  bottom: [0, -1, 0.02],
  hero: [0.85, 0.65, 1.25],
  heroBack: [-0.9, 0.55, -1.2],
  flat: [0, 0, 1],
};

const TEX_MAX = 2048;

/** Camera distance that fits a sphere of `radius` in both the vertical and horizontal field of view. */
function fitDistance(radius: number, cam: THREE.PerspectiveCamera, aspect = cam.aspect): number {
  const v = (cam.fov * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  return radius / Math.sin(Math.min(v, h) / 2);
}

interface PanelMesh {
  panel: DielinePanel;
  geo: THREE.BufferGeometry;
  base: Float32Array; // flat 3D positions
  outer: THREE.Mesh;
  inner: THREE.Mesh;
}

/** Build a triangulated, optionally subdivided panel geometry in flat 3D coords with sheet UVs. */
function panelGeometry(p: DielinePanel, dl: Dieline, subdivide: boolean) {
  let contour = p.polygon.map((q) => new THREE.Vector2(...(flat3(q).slice(0, 2) as [number, number])));
  if (THREE.ShapeUtils.isClockWise(contour)) contour = contour.slice().reverse();
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  let pos: number[] = [];
  for (const v of contour) pos.push(v.x, v.y, 0);
  let idx: number[] = faces.flat();
  if (subdivide) ({ pos, idx } = subdivideMesh(pos, idx, 10));
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / dl.width, 1 - -pos[i + 1] / dl.height);
  const geo = new THREE.BufferGeometry();
  const base = new Float32Array(pos);
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  return { geo, base };
}

/** Midpoint subdivision until every edge is shorter than `maxEdge` (needed for smooth deformation). */
function subdivideMesh(pos: number[], idx: number[], maxEdge: number) {
  for (let pass = 0; pass < 6; pass++) {
    let longest = 0;
    const len = (a: number, b: number) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1]);
    for (let i = 0; i < idx.length; i += 3) {
      longest = Math.max(longest, len(idx[i], idx[i + 1]), len(idx[i + 1], idx[i + 2]), len(idx[i + 2], idx[i]));
    }
    if (longest <= maxEdge) break;
    const mids = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let m = mids.get(k);
      if (m === undefined) {
        m = pos.length / 3;
        pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, 0);
        mids.set(k, m);
      }
      return m;
    };
    const next: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    idx = next;
  }
  return { pos, idx };
}

function shadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.32)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.12)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export const BoxPreview = forwardRef<BoxPreviewHandle, Props>(function BoxPreview(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 0 = closed, lid opens first, then panels unfold one by one, 1 = flat dieline.
  const [openAmt, setOpenAmt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [spin, setSpin] = useState(false);
  const [failed, setFailed] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  // All three.js state lives in one mutable object, created once.
  const eng = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    group: THREE.Group;
    shadow: THREE.Mesh;
    outerMat: THREE.MeshPhysicalMaterial;
    innerMat: THREE.MeshStandardMaterial;
    colorCanvas: HTMLCanvasElement;
    finishCanvas: HTMLCanvasElement;
    colorTex: THREE.CanvasTexture | null;
    finishTex: THREE.CanvasTexture | null;
    meshes: PanelMesh[];
    fold: FoldState;
    t: number;
    tTarget: number;
    play: boolean;
    dClosed: number;
    dFlat: number;
    onT: (t: number, done: boolean) => void;
    dirty: boolean;
    texDirty: boolean;
    camAnim: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null;
    radius: number;
    raf: number;
    dieline: Dieline | null;
  } | null>(null);

  // ---------------------------------------------------------------- setup
  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.9;
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(300, 500, 400);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
    camera.position.set(400, 300, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 2.2;
    controls.enablePan = false;
    const group = new THREE.Group();
    scene.add(group);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);
    const outerMat = new THREE.MeshPhysicalMaterial({ roughness: 1, metalness: 1, side: THREE.FrontSide });
    const innerMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: THREE.BackSide });
    eng.current = {
      renderer,
      scene,
      camera,
      controls,
      group,
      shadow,
      outerMat,
      innerMat,
      colorCanvas: document.createElement("canvas"),
      finishCanvas: document.createElement("canvas"),
      colorTex: null,
      finishTex: null,
      meshes: [],
      fold: { progress: 1, open: 0 },
      t: 0,
      tTarget: 0,
      play: false,
      dClosed: 600,
      dFlat: 900,
      onT: () => {},
      dirty: true,
      texDirty: true,
      camAnim: null,
      radius: 300,
      raf: 0,
      dieline: null,
    };
    const e = eng.current;

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      e.dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // Click (without drag) on a panel selects it in the editor.
    let down: { x: number; y: number } | null = null;
    const onDown = (ev: PointerEvent) => (down = { x: ev.clientX, y: ev.clientY });
    const onUp = (ev: PointerEvent) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(e.meshes.flatMap((m) => [m.outer, m.inner]))[0];
      if (hit) propsRef.current.onPickPanel?.(hit.object.userData.panelId);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    let last = performance.now();
    const loop = (now: number) => {
      e.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Open/close animation: constant speed when playing, quick follow when scrubbing.
      const d = e.tTarget - e.t;
      if (Math.abs(d) > 1e-4) {
        const prevUnfold = unfoldOf(e.t);
        if (e.play) e.t += Math.sign(d) * Math.min(Math.abs(d), dt / 2.8);
        else e.t += Math.abs(d) < 0.002 ? d : d * (1 - Math.pow(0.0005, dt));
        e.fold = foldFromOpenAmount(e.dieline!, e.t);
        bake();
        // Pull the camera back as the box unfolds so the whole sheet stays in view.
        if (!e.camAnim) {
          const u0 = prevUnfold, u1 = unfoldOf(e.t);
          const want = (u: number) => e.dClosed + (e.dFlat - e.dClosed) * u;
          const len = camera.position.length() * (want(u1) / want(u0));
          camera.position.setLength(Math.max(controls.minDistance, Math.min(controls.maxDistance, len)));
        }
        const done = Math.abs(e.tTarget - e.t) <= 1e-4;
        if (done) e.play = false;
        e.onT(e.t, done);
      }
      if (e.texDirty) updateTextures();
      if (e.camAnim) {
        const t = Math.min(1, (now - e.camAnim.t0) / 550);
        const s = t * t * (3 - 2 * t);
        camera.position.copy(e.camAnim.from).lerp(e.camAnim.to, s).setLength(e.camAnim.from.length() + (e.camAnim.to.length() - e.camAnim.from.length()) * s);
        if (t >= 1) e.camAnim = null;
        e.dirty = true;
      }
      if (controls.update() || e.dirty || controls.autoRotate) {
        renderer.render(scene, camera);
        e.dirty = false;
      }
    };
    e.raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(e.raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      e.meshes.forEach((m) => m.geo.dispose());
      e.colorTex?.dispose();
      e.finishTex?.dispose();
      outerMat.dispose();
      innerMat.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      eng.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** How far the box has unfolded (0 while only the lid opens). */
  function unfoldOf(t: number) {
    const e = eng.current;
    const a = e?.dieline?.hasOpenState ? 0.3 : 0;
    const u = Math.max(0, (t - a) / (1 - a));
    return u * u * (3 - 2 * u);
  }

  // ---------------------------------------------------------------- geometry
  function bake() {
    const e = eng.current;
    if (!e || !e.dieline) return;
    const dl = e.dieline;
    const mats = panelTransforms(dl, e.fold);
    for (const m of e.meshes) {
      const M = meshMatrix(mats[m.panel.id], m.panel, e.fold.progress);
      const attr = m.geo.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < m.base.length; i += 3) {
        const w = deformPoint(dl, m.panel, M, applyPoint(M, [m.base[i], m.base[i + 1], m.base[i + 2]]), e.fold.progress);
        arr[i] = w[0];
        arr[i + 1] = w[1];
        arr[i + 2] = w[2];
      }
      attr.needsUpdate = true;
      m.geo.computeVertexNormals();
      m.geo.computeBoundingSphere();
    }
    const b = foldedBounds(dl, e.fold);
    e.group.position.set(-b.center[0], -b.center[1], -b.center[2]);
    const floor = -b.size[1] / 2 - 0.5;
    e.shadow.position.set(0, floor, 0);
    const foot = Math.max(b.size[0], b.size[2], 40) * 1.7;
    e.shadow.scale.set(foot, foot, 1);
    e.shadow.visible = e.fold.progress > 0.6;
    e.dirty = true;
  }

  function updateTextures() {
    const e = eng.current;
    const p = propsRef.current;
    if (!e || !e.dieline) return;
    e.texDirty = false;
    const dl = e.dieline;
    const max = Math.min(TEX_MAX, e.renderer.capabilities.maxTextureSize);
    const px = Math.min(max / dl.width, max / dl.height, 8);
    const W = Math.round(dl.width * px), H = Math.round(dl.height * px);
    for (const c of [e.colorCanvas, e.finishCanvas]) {
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
        e.colorTex?.dispose();
        e.finishTex?.dispose();
        e.colorTex = null;
      }
    }
    renderDesign(e.colorCanvas.getContext("2d")!, dl, p.design, p.catalog, p.sources, { pxPerMm: px, mode: "color", board: true });
    renderDesign(e.finishCanvas.getContext("2d")!, dl, p.design, p.catalog, p.sources, { pxPerMm: px, mode: "finish", board: true });
    if (!e.colorTex) {
      e.colorTex = new THREE.CanvasTexture(e.colorCanvas);
      e.colorTex.colorSpace = THREE.SRGBColorSpace;
      e.colorTex.anisotropy = e.renderer.capabilities.getMaxAnisotropy();
      e.finishTex = new THREE.CanvasTexture(e.finishCanvas);
      e.finishTex.colorSpace = THREE.NoColorSpace;
      e.outerMat.map = e.colorTex;
      e.outerMat.roughnessMap = e.finishTex;
      e.outerMat.metalnessMap = e.finishTex;
      e.outerMat.bumpMap = e.finishTex;
      e.outerMat.needsUpdate = true;
    } else {
      e.colorTex.needsUpdate = true;
      e.finishTex!.needsUpdate = true;
    }
    // Lamination look.
    const lam = finishById(p.catalog, p.design.laminationId)?.effect;
    e.outerMat.clearcoat = lam === "gloss" ? 1 : 0;
    e.outerMat.clearcoatRoughness = 0.06;
    e.outerMat.sheen = lam === "soft-touch" ? 0.7 : 0;
    e.outerMat.sheenRoughness = 0.9;
    e.outerMat.sheenColor.set(0xffffff);
    e.outerMat.bumpScale = 3;
    const mat = p.catalog.materials.find((m) => m.id === p.design.materialId) ?? p.catalog.materials[0];
    e.innerMat.color.set(mat?.insideColor ?? "#eeeeee");
    e.dirty = true;
  }

  // Rebuild meshes when the dieline changes.
  useEffect(() => {
    const e = eng.current;
    if (!e) return;
    const dl = props.dieline;
    e.meshes.forEach((m) => {
      e.group.remove(m.outer, m.inner);
      m.geo.dispose();
    });
    e.meshes = dl.panels.map((panel) => {
      const { geo, base } = panelGeometry(panel, dl, !!dl.deform);
      const outer = new THREE.Mesh(geo, e.outerMat);
      const inner = new THREE.Mesh(geo, e.innerMat);
      outer.userData.panelId = inner.userData.panelId = panel.id;
      e.group.add(outer, inner);
      return { panel, geo, base, outer, inner };
    });
    const prev = e.dieline;
    e.dieline = dl;
    e.fold = foldFromOpenAmount(dl, e.t);
    e.texDirty = true;
    bake();
    // Fit the camera when the style changes or the size changes a lot.
    const closed = foldedBounds(dl, { progress: 1, open: 0 });
    const open = dl.hasOpenState ? foldedBounds(dl, { progress: 1, open: 1 }) : closed;
    const radius = Math.max(Math.hypot(...closed.size), Math.hypot(...open.size) * 0.85) / 2;
    const dist = fitDistance(radius, e.camera) * 1.05;
    e.dClosed = dist;
    e.dFlat = fitDistance(Math.hypot(dl.width, dl.height) / 2, e.camera) * 0.9;
    e.controls.minDistance = radius * 1.2;
    e.controls.maxDistance = Math.max(dl.width, dl.height) * 3 + dist;
    if (!prev || prev.templateId !== dl.templateId || Math.abs(radius - e.radius) / e.radius > 0.25) {
      const dir = prev?.templateId === dl.templateId ? e.camera.position.clone().normalize() : new THREE.Vector3(...VIEW_DIRS.hero).normalize();
      e.camera.position.copy(dir.multiplyScalar(dist));
      e.controls.target.set(0, 0, 0);
    }
    e.radius = radius;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dieline]);

  // Re-texture on design or asset changes.
  useEffect(() => {
    if (eng.current) eng.current.texDirty = true;
  }, [props.design, props.version, props.catalog]);

  // Keep the slider in sync with the animation (React state only; the loop owns the geometry).
  useEffect(() => {
    const e = eng.current;
    if (!e) return;
    let last = 0;
    e.onT = (t, done) => {
      const now = performance.now();
      if (done || now - last > 30) {
        last = now;
        setOpenAmt(t);
      }
      if (done) {
        setPlaying(false);
        if (t >= 0.999) goTo("flat");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (eng.current) eng.current.controls.autoRotate = spin;
  }, [spin]);

  const viewDistance = () => {
    const e = eng.current!;
    const u = unfoldOf(e.tTarget);
    return e.dClosed + (e.dFlat - e.dClosed) * u;
  };

  const goTo = (v: ViewName) => {
    const e = eng.current;
    if (!e) return;
    const to = new THREE.Vector3(...VIEW_DIRS[v]).normalize().multiplyScalar(viewDistance());
    e.camAnim = { from: e.camera.position.clone(), to, t0: performance.now() };
    e.controls.target.set(0, 0, 0);
  };

  /** Animate to an open amount (0 closed … 1 flat). */
  const playTo = (t: number) => {
    const e = eng.current;
    if (!e) return;
    e.tTarget = t;
    e.play = true;
    setPlaying(true);
    setSpin(false);
    if (t < e.t && e.t > 0.9) goTo("hero");
  };
  const scrub = (t: number) => {
    const e = eng.current;
    if (!e) return;
    e.tTarget = t;
    e.play = false;
    setPlaying(false);
    setOpenAmt(t);
  };
  const lidEnd = props.dieline.hasOpenState ? 0.3 : 0;
  const stage = openAmt < 0.01 ? "Closed" : lidEnd && openAmt <= lidEnd + 0.01 ? "Lid open" : openAmt > 0.99 ? "Flat dieline" : "Unfolding";
  const toggle = () => (playing ? scrub(openAmt) : playTo(openAmt > 0.5 ? 0 : 1));

  useImperativeHandle(ref, () => ({
    capture(views, width, height) {
      const e = eng.current;
      if (!e) return [];
      if (e.texDirty) updateTextures();
      const saved = { pos: e.camera.position.clone(), aspect: e.camera.aspect, size: e.renderer.getSize(new THREE.Vector2()), pr: e.renderer.getPixelRatio() };
      e.fold = { progress: 1, open: 0 };
      bake();
      e.renderer.setPixelRatio(1);
      e.renderer.setSize(width, height, false);
      e.camera.aspect = width / height;
      e.camera.updateProjectionMatrix();
      const out: string[] = [];
      for (const v of views) {
        e.camera.position.copy(new THREE.Vector3(...VIEW_DIRS[v]).normalize().multiplyScalar(fitDistance(e.radius, e.camera) * 0.98));
        e.camera.lookAt(0, 0, 0);
        e.renderer.render(e.scene, e.camera);
        out.push(e.renderer.domElement.toDataURL("image/png"));
      }
      e.renderer.setPixelRatio(saved.pr);
      e.renderer.setSize(saved.size.x, saved.size.y);
      e.camera.aspect = saved.aspect;
      e.camera.updateProjectionMatrix();
      e.camera.position.copy(saved.pos);
      e.fold = foldFromOpenAmount(e.dieline!, e.t);
      bake();
      return out;
    },
  }));

  const views: [ViewName, string][] = [
    ["front", "Front"],
    ["back", "Back"],
    ["left", "Left"],
    ["right", "Right"],
    ["top", "Top"],
    ["bottom", "Bottom"],
  ];

  return (
    <div className="preview">
      <div className="preview-canvas" ref={hostRef} aria-label="3D box preview. Drag to rotate, scroll or pinch to zoom." role="img" />
      {failed && (
        <div className="preview-fallback">
          3D preview needs WebGL, which is not available in this browser. You can still design on the dieline.
        </div>
      )}
      <div className="preview-toolbar">
        <div className="seg" role="group" aria-label="Jump to">
          <button className={openAmt < 0.01 ? "on" : ""} onClick={() => playTo(0)}>Closed</button>
          {props.dieline.hasOpenState && (
            <button className={Math.abs(openAmt - lidEnd) < 0.01 ? "on" : ""} onClick={() => playTo(lidEnd)}>Lid open</button>
          )}
          <button className={openAmt > 0.99 ? "on" : ""} onClick={() => playTo(1)}>Flat</button>
        </div>
        <button className={`icon-btn ${spin ? "on" : ""}`} onClick={() => setSpin((s) => !s)} title="Auto-rotate 360°" aria-pressed={spin}>
          ⟳
        </button>
      </div>
      <div className="preview-views" role="group" aria-label="Camera views">
        {views.map(([v, label]) => (
          <button key={v} onClick={() => goTo(v)}>
            {label}
          </button>
        ))}
        <button onClick={() => goTo("hero")}>3/4</button>
      </div>
      <div className="fold-bar">
        <button className="fold-play" onClick={toggle} aria-label={playing ? "Pause" : openAmt > 0.5 ? "Close box" : "Open box"}>
          <span aria-hidden>{playing ? "❚❚" : openAmt > 0.5 ? "◀" : "▶"}</span>
          {playing ? "Pause" : openAmt > 0.5 ? "Close" : "Open"}
        </button>
        <label className="fold-slider">
          <span className="sr-only">Open amount</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(openAmt * 1000)}
            onChange={(ev) => scrub(Number(ev.target.value) / 1000)}
            style={{ ["--fill" as string]: `${openAmt * 100}%` }}
          />
        </label>
        <span className="fold-stage">{stage}</span>
      </div>
    </div>
  );
});
