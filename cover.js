// Cover-Zuschnitt: Foto laden, im 2:3-Rahmen verschieben und zoomen, als kleines JPEG speichern.

import { COVER_WIDTH, COVER_HEIGHT } from "./config.js";

export function createCropper(canvas) {
  const ctx = canvas.getContext("2d");
  const CW = canvas.width, CH = canvas.height;
  const st = { img: null, url: null, zoom: 1.3, base: 1, ox: 0, oy: 0, drag: null };

  function clamp() {
    const k = st.base * st.zoom;
    const w = st.img.naturalWidth * k, h = st.img.naturalHeight * k;
    const mx = Math.max(0, (w - CW) / 2), my = Math.max(0, (h - CH) / 2);
    st.ox = Math.max(-mx, Math.min(mx, st.ox));
    st.oy = Math.max(-my, Math.min(my, st.oy));
  }
  function draw() {
    if (!st.img) return;
    clamp();
    const k = st.base * st.zoom;
    const w = st.img.naturalWidth * k, h = st.img.naturalHeight * k;
    ctx.clearRect(0, 0, CW, CH);
    ctx.drawImage(st.img, (CW - w) / 2 + st.ox, (CH - h) / 2 + st.oy, w, h);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!st.img) return;
    canvas.setPointerCapture(e.pointerId);
    st.drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!st.drag) return;
    const k = CW / canvas.clientWidth;
    st.ox = st.drag.ox + (e.clientX - st.drag.x) * k;
    st.oy = st.drag.oy + (e.clientY - st.drag.y) * k;
    draw();
  });
  const end = () => { st.drag = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  // Tastatur: Pfeiltasten verschieben, +/- zoomen.
  canvas.addEventListener("keydown", (e) => {
    if (!st.img) return;
    const step = e.shiftKey ? 30 : 10;
    const map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (map[e.key]) { st.ox += map[e.key][0]; st.oy += map[e.key][1]; draw(); e.preventDefault(); }
  });

  return {
    /** Lädt eine Bilddatei. Wirft einen Fehler, wenn sie sich nicht öffnen lässt. */
    async load(file) {
      this.clear();
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new Error("Dieses Foto lässt sich nicht öffnen."); }
      st.img = img; st.url = url;
      st.base = Math.max(CW / img.naturalWidth, CH / img.naturalHeight);
      // Bücher liegen auf Fotos meist mittig und füllen etwa 70 % der Breite: leicht hineinzoomen.
      st.zoom = 1.3; st.ox = 0; st.oy = 0;
      draw();
    },
    setZoom(z) { st.zoom = z; draw(); },
    get zoom() { return st.zoom; },
    get loaded() { return !!st.img; },
    /** Gibt das zugeschnittene Cover als JPEG-Data-URL zurück. */
    toDataUrl() {
      const out = document.createElement("canvas");
      out.width = COVER_WIDTH; out.height = COVER_HEIGHT;
      out.getContext("2d").drawImage(canvas, 0, 0, COVER_WIDTH, COVER_HEIGHT);
      return out.toDataURL("image/jpeg", 0.85);
    },
    clear() {
      if (st.url) URL.revokeObjectURL(st.url);
      st.img = null; st.url = null;
      ctx.clearRect(0, 0, CW, CH);
    },
  };
}
