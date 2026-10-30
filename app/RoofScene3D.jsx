"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { quotaIn, quotaPiano } from "../lib/rilievo";

// Vista 3D della simulazione di posa (Three.js).
//
// Riferimenti: coordinate locali in metri, x = Est, y = Nord. In Three.js:
// X = Est, Y = alto, Z = −Nord (si guarda da Sud verso Nord).
//
// Con `rilievo` (DSM di Google Solar) viene ricostruito TUTTO ciò che il rilievo
// contiene attorno alle aree: l'intero edificio con le sue falde, i corpi bassi,
// gli edifici adiacenti, gli alberi e il suolo. Due stili:
//  - "colori": modello pulito (tetti, pareti, suolo, verde, aree e moduli a colori),
//    con i toni ricavati dalla foto aerea;
//  - "foto": la foto aerea stesa sulle quote reali (pareti ripulite).
// Senza rilievo restano solo i volumi delle aree disegnate (quota stimata
// dall'altezza indicata): è una vista indicativa.
//
// props:
//  scena: {
//    bounds: { xmin, xmax, ymin, ymax }   // estensione (m) coperta dalla foto
//    texture: dataURL della foto (solo satellite, senza overlay)
//    altezzaM: quota del tetto/gronda (solo senza rilievo)
//    aree: [{ nome, colore, tipo, poligono, ostacoli, pendenzaDeg, azimutDiscesa, piano? }]
//    pannelli: [{ cx, cy, az, tilt, portrait, areaIdx }]
//    modulo?: { l, w }   // lato lungo e corto del modulo (m); default 1,961 × 1,134
//    rilievo?: { nx, ny, passoM, estensioneM, quote(Float32Array, m) }   // DSM reale
//  }
//  stile: "colori" | "foto"      mostraAree: evidenzia le aree con il loro colore
// ref: { setVista(nome), cattura(nome|null, larghezza, altezza) -> dataURL JPEG (null = vista corrente), setStile, setAree }

const DEG = Math.PI / 180;
const MODULO = { l: 1.961, w: 1.134, t: 0.03 };

const PALETTE = {
  muro: "#ece6d6",
  erba: "#8db564",
  asfalto: "#767b82",
  cemento: "#c3c5c7",
  albero: "#4a8a3a",
  tettoPiano: "#98a0a8",
  tettoTerracotta: "#b8644a",
  tettoArdesia: "#6e7681",
  basso: "#cfc8ba",
  suoloSezione: "#6a5a47",
};

function pip(x, y, poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function texturaModulo(THREE, portrait) {
  const W = portrait ? 340 : 588;
  const H = portrait ? 588 : 340;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#14284f");
  grad.addColorStop(1, "#0a1630");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // 108 mezze celle: 6 x 18 (verticale)
  const cols = portrait ? 6 : 18;
  const rows = portrait ? 18 : 6;
  const pad = 12;
  g.strokeStyle = "rgba(150,180,235,0.55)";
  g.lineWidth = 1;
  for (let i = 0; i <= cols; i++) {
    const x = pad + ((W - 2 * pad) * i) / cols;
    g.beginPath(); g.moveTo(x, pad); g.lineTo(x, H - pad); g.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    const y = pad + ((H - 2 * pad) * j) / rows;
    g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
  }
  // cornice in alluminio
  g.strokeStyle = "#aab3c2";
  g.lineWidth = 12;
  g.strokeRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function texturaCielo(THREE) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#9ec3ea");
  gr.addColorStop(0.55, "#d6e6f5");
  gr.addColorStop(1, "#f3f6f9");
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// carica la foto come immagine + pixel (per ricavare i colori del modello)
function caricaFoto(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        resolve({ img, w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data });
      } catch {
        resolve({ img, w: img.naturalWidth, h: img.naturalHeight, data: null });
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const RoofScene3D = forwardRef(function RoofScene3D({ scena, className, stile = "colori", mostraAree = true }, ref) {
  const containerRef = useRef(null);
  const stateRef = useRef(null);
  const propsRef = useRef({ stile, mostraAree });
  propsRef.current = { stile, mostraAree };

  useImperativeHandle(ref, () => ({
    setVista(nome) {
      const s = stateRef.current;
      if (s) s.setVista(nome);
    },
    cattura(nome, larghezza = 1400, altezza = 875) {
      const s = stateRef.current;
      return s ? s.cattura(nome, larghezza, altezza) : null;
    },
    setStile(v) {
      stateRef.current?.setStile(v);
    },
    setAree(v) {
      stateRef.current?.setAree(v);
    },
  }));

  useEffect(() => {
    stateRef.current?.setStile(stile);
  }, [stile]);
  useEffect(() => {
    stateRef.current?.setAree(mostraAree);
  }, [mostraAree]);

  useEffect(() => {
    let annullato = false;
    let pulizia = () => {};

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const foto = await caricaFoto(scena?.texture);
      if (annullato || !containerRef.current || !scena) return;

      const container = containerRef.current;
      const { bounds, aree, pannelli, rilievo } = scena;
      const altezzaBase = scena.altezzaM;
      const Wm = bounds.xmax - bounds.xmin;
      const Hm = bounds.ymax - bounds.ymin;
      const cx0 = (bounds.xmin + bounds.xmax) / 2;
      const cy0 = (bounds.ymin + bounds.ymax) / 2;

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";

      const scene = new THREE.Scene();
      const cielo = texturaCielo(THREE);
      scene.background = cielo;
      const camera = new THREE.PerspectiveCamera(36, 1.6, 0.5, 6000);

      const col = (hex) => new THREE.Color(hex);

      /* ------------------------------------------- quote di una copertura */

      const quota = (area, x, y) => {
        if (rilievo) return area.piano ? quotaPiano(area.piano, x, y) : quotaIn(rilievo, x, y);
        if (area.tipo !== "falda") return altezzaBase;
        const f = { x: Math.sin(area.azimutDiscesa * DEG), y: Math.cos(area.azimutDiscesa * DEG) };
        let sMax = -Infinity;
        for (const p of area.poligono) sMax = Math.max(sMax, p.x * f.x + p.y * f.y);
        const s = x * f.x + y * f.y;
        return altezzaBase + Math.tan(Math.max(0, Math.min(80, area.pendenzaDeg)) * DEG) * (sMax - s);
      };

      /* --------------------------------------- area di interesse e camera */

      // estensione delle aree
      let axmin = Infinity, axmax = -Infinity, aymin = Infinity, aymax = -Infinity;
      for (const a of aree) for (const p of a.poligono) {
        axmin = Math.min(axmin, p.x); axmax = Math.max(axmax, p.x);
        aymin = Math.min(aymin, p.y); aymax = Math.max(aymax, p.y);
      }
      if (!isFinite(axmin)) { axmin = cx0 - 10; axmax = cx0 + 10; aymin = cy0 - 10; aymax = cy0 + 10; }
      // estensione dell'edificio (o degli edifici) su cui poggiano le aree: dal rilievo
      let bxmin = axmin, bxmax = axmax, bymin = aymin, bymax = aymax;
      let altMax = 8;
      if (rilievo) {
        const { nx, ny, passoM: p, estensioneM: E, quote: Q } = rilievo;
        const N = nx * ny;
        const alta = new Uint8Array(N);
        for (let k = 0; k < N; k++) alta[k] = Q[k] > 2.5 ? 1 : 0;
        const comp = new Int32Array(N).fill(-1);
        const ci = (x) => Math.round((x + E) / p);
        const cj = (y) => Math.round((E - y) / p);
        // semi: celle alte dentro le aree
        const semi = [];
        for (const a of aree) {
          const xs = a.poligono.map((q) => q.x), ys = a.poligono.map((q) => q.y);
          for (let y = Math.min(...ys); y <= Math.max(...ys); y += 1) {
            for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1) {
              if (!pip(x, y, a.poligono)) continue;
              const i = ci(x), j = cj(y);
              if (i < 1 || j < 1 || i >= nx - 1 || j >= ny - 1) continue;
              for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
                const k = (j + dj) * nx + (i + di);
                if (alta[k]) semi.push(k);
              }
            }
          }
        }
        let nComp = 0;
        const bb = [];
        for (const s of semi) {
          if (comp[s] >= 0) continue;
          const id = nComp++;
          const stack = [s];
          comp[s] = id;
          let n = 0, i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity, mx = 0;
          while (stack.length) {
            const c = stack.pop();
            const i = c % nx, j = (c - i) / nx;
            n++;
            if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
            if (Q[c] > mx) mx = Q[c];
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
              const k = jj * nx + ii;
              if (alta[k] && comp[k] < 0) { comp[k] = id; stack.push(k); }
            }
          }
          bb.push({ n, i0, i1, j0, j1, mx });
        }
        for (const b of bb) {
          if (b.n < 30) continue;
          bxmin = Math.min(bxmin, -E + b.i0 * p); bxmax = Math.max(bxmax, -E + b.i1 * p);
          bymin = Math.min(bymin, E - b.j1 * p); bymax = Math.max(bymax, E - b.j0 * p);
          altMax = Math.max(altMax, b.mx);
        }
      }
      const ctr = { x: (bxmin + bxmax) / 2, y: (bymin + bymax) / 2 };
      const raggio = Math.max(8, Math.hypot(bxmax - bxmin, bymax - bymin) / 2);
      // ritaglio del terreno ricostruito: edificio + contorno (suolo, vicini, alberi)
      const margine = Math.max(14, raggio * 0.55);
      const crop = {
        xmin: Math.max(bounds.xmin, bxmin - margine), xmax: Math.min(bounds.xmax, bxmax + margine),
        ymin: Math.max(bounds.ymin, bymin - margine), ymax: Math.min(bounds.ymax, bymax + margine),
      };
      const Rscena = Math.max(10, Math.hypot(crop.xmax - crop.xmin, crop.ymax - crop.ymin) / 2);
      const cc = { x: (crop.xmin + crop.xmax) / 2, y: (crop.ymin + crop.ymax) / 2 };

      /* ----------------------------------------------------------- luci */

      scene.add(new THREE.HemisphereLight(0xe6f0ff, 0xa39b88, 0.95));
      const sole = new THREE.DirectionalLight(0xfff2dc, 1.85);
      const azSole = 150 * DEG; // sud-est, mattina inoltrata
      const elSole = 44 * DEG;
      sole.position.set(
        cc.x + Math.sin(azSole) * Math.cos(elSole) * Rscena * 3,
        Math.sin(elSole) * Rscena * 3,
        -(cc.y + Math.cos(azSole) * Math.cos(elSole) * Rscena * 3)
      );
      sole.target.position.set(cc.x, 0, -cc.y);
      sole.castShadow = true;
      const mapSize = Math.min(4096, renderer.capabilities.maxTextureSize || 2048);
      sole.shadow.mapSize.set(mapSize, mapSize);
      const sc = sole.shadow.camera;
      sc.left = -Rscena * 1.15; sc.right = Rscena * 1.15; sc.top = Rscena * 1.15; sc.bottom = -Rscena * 1.15;
      sc.near = 1; sc.far = Rscena * 9;
      sole.shadow.bias = -0.0003;
      sole.shadow.normalBias = 0.04;
      scene.add(sole, sole.target);
      // luce di riempimento dal lato opposto: le ombre restano leggibili
      const riempimento = new THREE.DirectionalLight(0xdfe9ff, 0.4);
      riempimento.position.set(cc.x - 40, 60, -cc.y - 50);
      scene.add(riempimento);

      /* --------------------------------------------- materiali condivisi */

      const texSat = foto?.img
        ? (() => {
            const t = new THREE.Texture(foto.img);
            t.needsUpdate = true;
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
            return t;
          })()
        : null;
      const matMuro = new THREE.MeshStandardMaterial({ color: col(PALETTE.muro), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
      const matOstacolo = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8 });

      // elementi il cui materiale cambia con lo stile: { mesh, foto, colori }
      const perStile = [];
      const impostaStile = (nome) => {
        for (const e of perStile) {
          const m = nome === "foto" && e.foto ? e.foto : e.colori;
          if (e.mesh.material !== m) {
            e.mesh.material = m;
            m.needsUpdate = true;
          }
        }
      };

      /* ---------------------------------------------------------- terreno */

      let terreno = null;
      if (rilievo) {
        const { nx, ny, passoM: p, estensioneM: E, quote: Q } = rilievo;
        const i0 = Math.max(0, Math.floor((crop.xmin + E) / p)), i1 = Math.min(nx - 1, Math.ceil((crop.xmax + E) / p));
        const j0 = Math.max(0, Math.floor((E - crop.ymax) / p)), j1 = Math.min(ny - 1, Math.ceil((E - crop.ymin) / p));
        const ni = i1 - i0 + 1, nj = j1 - j0 + 1;
        const nv = ni * nj;
        const H = new Float32Array(nv);
        const X = new Float32Array(nv), Y = new Float32Array(nv);
        for (let jj = 0; jj < nj; jj++) {
          for (let ii = 0; ii < ni; ii++) {
            const k = jj * ni + ii;
            X[k] = -E + (i0 + ii) * p;
            Y[k] = E - (j0 + jj) * p;
            const q = Q[(j0 + jj) * nx + (i0 + ii)];
            H[k] = Number.isFinite(q) ? (q < 0.25 ? 0 : q) : 0; // suolo piatto: niente rumore sotto i 25 cm
          }
        }
        // leviga il rumore del rilievo senza toccare gli spigoli (bordi dei tetti, pareti)
        for (let it = 0; it < 2; it++) {
          const H2 = H.slice();
          for (let jj = 1; jj < nj - 1; jj++) {
            for (let ii = 1; ii < ni - 1; ii++) {
              const k = jj * ni + ii;
              let somma = 0, n = 0;
              for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                const hv = H[k + dj * ni + di];
                if (Math.abs(hv - H[k]) < 0.45) { somma += hv; n++; }
              }
              H2[k] = somma / n;
            }
          }
          H.set(H2);
        }
        // le coperture misurate vengono "stirate" sul loro piano: tetto pulito sotto i moduli
        for (const a of aree) {
          if (!a.piano) continue;
          const xs = a.poligono.map((q) => q.x), ys = a.poligono.map((q) => q.y);
          const xa = Math.min(...xs), xb = Math.max(...xs), ya = Math.min(...ys), yb = Math.max(...ys);
          for (let jj = 0; jj < nj; jj++) {
            for (let ii = 0; ii < ni; ii++) {
              const k = jj * ni + ii;
              if (X[k] < xa || X[k] > xb || Y[k] < ya || Y[k] > yb) continue;
              if (!pip(X[k], Y[k], a.poligono)) continue;
              if ((a.ostacoli || []).some((o) => pip(X[k], Y[k], o))) continue;
              const zp = quotaPiano(a.piano, X[k], Y[k]);
              if (Math.abs(H[k] - zp) < 0.35) H[k] = zp;
            }
          }
        }

        const pos = new Float32Array(nv * 3);
        const uvs = new Float32Array(nv * 2);
        for (let k = 0; k < nv; k++) {
          pos[k * 3] = X[k];
          pos[k * 3 + 1] = H[k];
          pos[k * 3 + 2] = -Y[k];
          uvs[k * 2] = (X[k] + E) / (2 * E);
          uvs[k * 2 + 1] = (Y[k] + E) / (2 * E);
        }
        const idx = new Uint32Array((ni - 1) * (nj - 1) * 6);
        let t = 0;
        for (let jj = 0; jj < nj - 1; jj++) {
          for (let ii = 0; ii < ni - 1; ii++) {
            const a0 = jj * ni + ii, b0 = a0 + 1, c0 = a0 + ni, d0 = c0 + 1;
            // diagonale scelta in base alle quote: i bordi dei tetti restano dritti
            if (Math.abs(H[a0] - H[d0]) < Math.abs(H[b0] - H[c0])) {
              idx[t++] = a0; idx[t++] = c0; idx[t++] = d0; idx[t++] = a0; idx[t++] = d0; idx[t++] = b0;
            } else {
              idx[t++] = a0; idx[t++] = c0; idx[t++] = b0; idx[t++] = b0; idx[t++] = c0; idx[t++] = d0;
            }
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeVertexNormals();
        const nrm = g.getAttribute("normal");

        // --- classificazione dei punti: suolo, verde, edifici, pareti
        const rgbFoto = (x, y, out) => {
          if (!foto?.data) { out[0] = out[1] = out[2] = 128; return; }
          let r = 0, gg = 0, b = 0, n = 0;
          for (const [dx, dy] of [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
            const u = (x + dx * p + E) / (2 * E), v = (y + dy * p + E) / (2 * E);
            const px = Math.min(foto.w - 1, Math.max(0, Math.round(u * (foto.w - 1))));
            const py = Math.min(foto.h - 1, Math.max(0, Math.round((1 - v) * (foto.h - 1))));
            const o = (py * foto.w + px) * 4;
            r += foto.data[o]; gg += foto.data[o + 1]; b += foto.data[o + 2]; n++;
          }
          out[0] = r / n; out[1] = gg / n; out[2] = b / n;
        };
        const rgb = new Array(nv);
        const verde = new Uint8Array(nv);
        const alto = new Uint8Array(nv);
        const tmp = [0, 0, 0];
        for (let k = 0; k < nv; k++) {
          rgbFoto(X[k], Y[k], tmp);
          rgb[k] = [tmp[0], tmp[1], tmp[2]];
          const [r, gg, b] = tmp;
          verde[k] = foto?.data && gg - Math.max(r, b) > 7 && gg > 60 ? 1 : 0;
          alto[k] = H[k] >= 2.2 && !verde[k] ? 1 : 0;
        }
        const muro = new Float32Array(nv);
        for (let jj = 0; jj < nj; jj++) {
          for (let ii = 0; ii < ni; ii++) {
            const k = jj * ni + ii;
            let gmax = 0;
            let vicinoAlto = alto[k] === 1;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
              const i2 = ii + di, j2 = jj + dj;
              if (i2 < 0 || j2 < 0 || i2 >= ni || j2 >= nj) continue;
              const k2 = j2 * ni + i2;
              gmax = Math.max(gmax, Math.abs(H[k] - H[k2]) / (p * (di && dj ? 1.414 : 1)));
              if (alto[k2]) vicinoAlto = true;
            }
            muro[k] = vicinoAlto ? smooth(1.9, 4.5, gmax) : 0;
          }
        }
        g.setAttribute("muro", new THREE.BufferAttribute(muro, 1));

        // --- colori per vertice (modello pulito)
        const colori = new Float32Array(nv * 3);
        const c = new THREE.Color();
        const cf = new THREE.Color();
        const cm = new THREE.Color(PALETTE.muro);
        for (let k = 0; k < nv; k++) {
          const [r, gg, b] = rgb[k];
          cf.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace);
          const lum = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
          const h = H[k];
          const ny0 = nrm.getY(k);
          if (h < 0.5) {
            if (verde[k]) c.set(PALETTE.erba).multiplyScalar(0.8 + 0.5 * Math.max(0, lum - 0.2));
            else {
              c.set(lum < 0.42 ? PALETTE.asfalto : PALETTE.cemento).lerp(cf, 0.3);
            }
          } else if (verde[k]) {
            c.set(PALETTE.albero).multiplyScalar(0.62 + 0.75 * lum + Math.min(0.2, h * 0.015));
          } else if (h < 2.2) {
            c.set(PALETTE.basso).lerp(cf, 0.35);
          } else if (ny0 > 0.985) {
            c.set(PALETTE.tettoPiano).lerp(cf, 0.4);
          } else {
            c.set(r > b + 12 ? PALETTE.tettoTerracotta : PALETTE.tettoArdesia).lerp(cf, 0.45);
          }
          if (muro[k] > 0) c.lerp(cm, muro[k]);
          colori[k * 3] = c.r; colori[k * 3 + 1] = c.g; colori[k * 3 + 2] = c.b;
        }
        g.setAttribute("color", new THREE.BufferAttribute(colori, 3));

        const matColori = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
        const matFoto = new THREE.MeshStandardMaterial({ map: texSat || null, color: texSat ? 0xffffff : 0xb9c3a8, roughness: 1, metalness: 0 });
        // foto: le pareti ripetono il colore dell'intonaco (altrimenti la foto "cola" sulle facciate)
        const muroCol = new THREE.Color(PALETTE.muro);
        matFoto.onBeforeCompile = (sh) => {
          sh.uniforms.uMuro = { value: muroCol };
          sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nattribute float muro;\nvarying float vMuro;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMuro = muro;");
          sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying float vMuro;\nuniform vec3 uMuro;")
            .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uMuro, vMuro);");
        };
        // ombreggiatura a facce piane: spigoli netti su tetti e pareti, falde pulite
        const gFlat = g.toNonIndexed();
        g.dispose();
        gFlat.computeVertexNormals();
        terreno = new THREE.Mesh(gFlat, matColori);
        terreno.castShadow = true;
        terreno.receiveShadow = true;
        scene.add(terreno);
        perStile.push({ mesh: terreno, foto: texSat ? matFoto : null, colori: matColori });

        // --- bordo "a plastico": una sezione di suolo attorno al modello
        const matSezione = new THREE.MeshStandardMaterial({ color: col(PALETTE.suoloSezione), roughness: 1, side: THREE.DoubleSide });
        const fondo = -2.5;
        const sp = [];
        const lato = (indici) => {
          for (let q = 0; q < indici.length - 1; q++) {
            const k0 = indici[q], k1 = indici[q + 1];
            sp.push(X[k0], H[k0], -Y[k0], X[k1], H[k1], -Y[k1], X[k1], fondo, -Y[k1]);
            sp.push(X[k0], H[k0], -Y[k0], X[k1], fondo, -Y[k1], X[k0], fondo, -Y[k0]);
          }
        };
        lato(Array.from({ length: ni }, (_, ii) => ii));
        lato(Array.from({ length: ni }, (_, ii) => (nj - 1) * ni + ii));
        lato(Array.from({ length: nj }, (_, jj) => jj * ni));
        lato(Array.from({ length: nj }, (_, jj) => jj * ni + ni - 1));
        const gs = new THREE.BufferGeometry();
        gs.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
        gs.computeVertexNormals();
        const sezione = new THREE.Mesh(gs, matSezione);
        sezione.receiveShadow = true;
        scene.add(sezione);
        const fondoMesh = new THREE.Mesh(new THREE.PlaneGeometry(crop.xmax - crop.xmin, crop.ymax - crop.ymin), matSezione);
        fondoMesh.rotation.x = -Math.PI / 2;
        fondoMesh.position.set(cc.x, fondo, -cc.y);
        scene.add(fondoMesh);
      } else {
        // senza rilievo: piano con la foto (o un verde neutro) e volumi delle sole aree
        const matColori = new THREE.MeshStandardMaterial({ color: col("#b6c3a3"), roughness: 1 });
        const matFoto = new THREE.MeshStandardMaterial({ map: texSat || null, color: texSat ? 0xffffff : 0xb9c3a8, roughness: 1 });
        const piano = new THREE.Mesh(new THREE.PlaneGeometry(Wm, Hm), matColori);
        piano.rotation.x = -Math.PI / 2;
        piano.position.set(cx0, 0, -cy0);
        piano.receiveShadow = true;
        scene.add(piano);
        perStile.push({ mesh: piano, foto: texSat ? matFoto : null, colori: matColori });
      }

      /* ------------------------ volumi delle aree (solo senza il rilievo) */

      const uvDi = (x, y) => [(x - bounds.xmin) / Wm, (y - bounds.ymin) / Hm];
      function prisma(area, hBase, hTop, tetto) {
        const poligono = area.poligono;
        const contorno = poligono.map((q) => new THREE.Vector2(q.x, q.y));
        const tri = THREE.ShapeUtils.triangulateShape(contorno, []);
        const pos = [];
        const uv = [];
        for (const tt of tri) {
          for (const k of tt) {
            const q = poligono[k];
            pos.push(q.x, hTop(q.x, q.y), -q.y);
            const [u, v] = uvDi(q.x, q.y);
            uv.push(u, v);
          }
        }
        const gTop = new THREE.BufferGeometry();
        gTop.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        gTop.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        gTop.computeVertexNormals();
        const top = new THREE.Mesh(gTop, tetto.colori);
        top.castShadow = true;
        top.receiveShadow = true;
        perStile.push({ mesh: top, foto: tetto.foto, colori: tetto.colori });
        const pw = [];
        for (let i = 0; i < poligono.length; i++) {
          const a = poligono[i];
          const b = poligono[(i + 1) % poligono.length];
          const A0 = [a.x, hBase(a.x, a.y), -a.y], B0 = [b.x, hBase(b.x, b.y), -b.y];
          const A1 = [a.x, hTop(a.x, a.y), -a.y], B1 = [b.x, hTop(b.x, b.y), -b.y];
          pw.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
        }
        const gL = new THREE.BufferGeometry();
        gL.setAttribute("position", new THREE.Float32BufferAttribute(pw, 3));
        gL.computeVertexNormals();
        const lati = new THREE.Mesh(gL, matMuro);
        lati.castShadow = true;
        lati.receiveShadow = true;
        const gr = new THREE.Group();
        gr.add(top, lati);
        return gr;
      }
      if (!rilievo) {
        aree.forEach((area) => {
          const tetto = {
            colori: new THREE.MeshStandardMaterial({ color: col(area.tipo === "falda" ? PALETTE.tettoTerracotta : PALETTE.tettoPiano), roughness: 0.9 }),
            foto: texSat ? new THREE.MeshStandardMaterial({ map: texSat, roughness: 0.95 }) : null,
          };
          scene.add(prisma(area, () => 0, (x, y) => quota(area, x, y), tetto));
          for (const o of area.ostacoli || []) {
            scene.add(prisma({ poligono: o }, (x, y) => quota(area, x, y), (x, y) => quota(area, x, y) + 1.0, { colori: matOstacolo, foto: null }));
          }
        });
      }

      /* -------------------------------- aree e ostacoli evidenziati a colori */

      const gruppoAree = new THREE.Group();
      scene.add(gruppoAree);
      const matCache = {};
      const matColore = (hex, opacita) => {
        const key = hex + opacita;
        if (!matCache[key]) {
          matCache[key] = new THREE.MeshBasicMaterial({
            color: col(hex), transparent: true, opacity: opacita, side: THREE.DoubleSide,
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
          });
        }
        return matCache[key];
      };
      function riempi(poligono, qz, hex, opacita) {
        const tri = THREE.ShapeUtils.triangulateShape(poligono.map((q) => new THREE.Vector2(q.x, q.y)), []);
        const pos = [];
        for (const tt of tri) for (const k of tt) pos.push(poligono[k].x, qz(poligono[k].x, poligono[k].y), -poligono[k].y);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        const m = new THREE.Mesh(g, matColore(hex, opacita));
        m.renderOrder = 2;
        return m;
      }
      function contornoNastro(poligono, qz, hex, larg) {
        const pos = [];
        for (let i = 0; i < poligono.length; i++) {
          const a = poligono[i], b = poligono[(i + 1) % poligono.length];
          const dx = b.x - a.x, dy = b.y - a.y;
          const l = Math.hypot(dx, dy) || 1;
          const nx = (-dy / l) * larg / 2, ny = (dx / l) * larg / 2;
          const P = [
            [a.x - nx, a.y - ny], [a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny],
          ].map(([x, y]) => [x, qz(x, y), -y]);
          pos.push(...P[0], ...P[1], ...P[2], ...P[0], ...P[2], ...P[3]);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        const m = new THREE.Mesh(g, matColore(hex, 1));
        m.renderOrder = 3;
        return m;
      }
      aree.forEach((area) => {
        const qz = (x, y) => quota(area, x, y) + 0.05;
        const hex = area.colore || "#f59e0b";
        gruppoAree.add(riempi(area.poligono, qz, hex, 0.34));
        gruppoAree.add(contornoNastro(area.poligono, (x, y) => quota(area, x, y) + 0.07, hex, 0.22));
        for (const o of area.ostacoli || []) {
          gruppoAree.add(riempi(o, (x, y) => quota(area, x, y) + 0.09, "#ef4444", 0.55));
          gruppoAree.add(contornoNastro(o, (x, y) => quota(area, x, y) + 0.1, "#b91c1c", 0.12));
        }
      });

      /* ----------------------------------------------------------- moduli */

      const gruppi = { true: [], false: [] };
      for (const p of pannelli) gruppi[p.portrait ? "true" : "false"].push(p);
      const dummy = new THREE.Object3D();
      dummy.rotation.order = "YXZ";
      for (const portrait of [true, false]) {
        const lista = gruppi[portrait ? "true" : "false"];
        if (!lista.length) continue;
        const dimM = { ...MODULO, ...(scena.modulo || {}) };
        const w = portrait ? dimM.w : dimM.l; // lungo la fila (x locale)
        const s = portrait ? dimM.l : dimM.w; // lungo la pendenza (z locale)
        const geo = new THREE.BoxGeometry(w, dimM.t, s);
        // texture solo sulla faccia superiore (indice 2 = +Y)
        const mats = [0, 1, 2, 3, 4, 5].map((i) =>
          i === 2
            ? new THREE.MeshStandardMaterial({ map: texturaModulo(THREE, portrait), metalness: 0.4, roughness: 0.28 })
            : new THREE.MeshStandardMaterial({ color: 0xaab3c2, metalness: 0.6, roughness: 0.4 })
        );
        const mesh = new THREE.InstancedMesh(geo, mats, lista.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        lista.forEach((p, i) => {
          const area = aree[p.areaIdx] || aree[0];
          const beta = p.tilt * DEG;
          const base = quota(area, p.cx, p.cy);
          // piano: file inclinate sollevate da terra (zavorre); falda: sul manto
          const rialzo = area.tipo === "falda" ? 0.14 : 0.15 + (s / 2) * Math.sin(beta);
          dummy.position.set(p.cx, base + rialzo, -p.cy);
          dummy.rotation.set(beta, Math.PI - p.az * DEG, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
      }

      /* -------------------------------------------------- camera + controlli */

      const hRif = rilievo ? Math.min(altMax, 20) : altezzaBase;
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
      controls.minDistance = 6;
      controls.maxDistance = Rscena * 6;
      controls.target.set(ctr.x, hRif * 0.35, -ctr.y);

      const dist = Math.max(32, raggio * 2.9);
      const viste = {
        alto: () => ({ pos: [ctr.x, dist * 1.25, -ctr.y + 0.001], up: [0, 0, -1] }),
        sud_est: () => ({ pos: [ctr.x + dist * 0.55, dist * 0.62, -ctr.y + dist * 0.8], up: [0, 1, 0] }),
        sud_ovest: () => ({ pos: [ctr.x - dist * 0.55, dist * 0.62, -ctr.y + dist * 0.8], up: [0, 1, 0] }),
        nord_est: () => ({ pos: [ctr.x + dist * 0.55, dist * 0.62, -ctr.y - dist * 0.8], up: [0, 1, 0] }),
      };

      const render = () => renderer.render(scene, camera);
      controls.addEventListener("change", render);

      function setVista(nome) {
        const v = (viste[nome] || viste.sud_est)();
        camera.up.set(...v.up);
        camera.position.set(...v.pos);
        controls.target.set(ctr.x, nome === "alto" ? 0 : hRif * 0.35, -ctr.y);
        controls.update();
        render();
      }
      function setStile(nome) {
        impostaStile(nome === "foto" ? "foto" : "colori");
        render();
      }
      function setAree(v) {
        gruppoAree.visible = Boolean(v);
        render();
      }

      function ridimensiona() {
        const r = container.getBoundingClientRect();
        const w = Math.max(200, r.width);
        const h = Math.max(150, r.height || w / 1.6);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        render();
      }
      const ro = new ResizeObserver(ridimensiona);
      ro.observe(container);
      impostaStile(propsRef.current.stile === "foto" ? "foto" : "colori");
      gruppoAree.visible = Boolean(propsRef.current.mostraAree);
      ridimensiona();
      setVista("sud_est");

      // nome = "alto" | "sud_est" | ... porta la camera su una vista standard;
      // senza nome (o "corrente") si cattura la vista così com'è: zoom e angolazione dell'utente
      function cattura(nome, larghezza, altezza) {
        if (nome && nome !== "corrente") setVista(nome);
        const wPrima = renderer.domElement.width;
        const hPrima = renderer.domElement.height;
        const pr = renderer.getPixelRatio();
        renderer.setPixelRatio(1);
        renderer.setSize(larghezza, altezza, false);
        camera.aspect = larghezza / altezza;
        camera.updateProjectionMatrix();
        render();
        const url = renderer.domElement.toDataURL("image/jpeg", 0.9);
        renderer.setPixelRatio(pr);
        renderer.setSize(wPrima / pr, hPrima / pr, false);
        ridimensiona();
        return url;
      }

      stateRef.current = { setVista, cattura, setStile, setAree };

      pulizia = () => {
        ro.disconnect();
        controls.dispose();
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose(); });
        });
        for (const e of perStile) { e.foto?.dispose?.(); e.colori?.dispose?.(); }
        cielo.dispose();
        texSat?.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        stateRef.current = null;
      };
    })();

    return () => {
      annullato = true;
      pulizia();
    };
  }, [scena]);

  return <div ref={containerRef} className={className} style={{ width: "100%", aspectRatio: "8 / 5", background: "#d6e6f5", borderRadius: 8, overflow: "hidden" }} />;
});

export default RoofScene3D;
