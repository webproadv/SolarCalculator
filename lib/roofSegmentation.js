// Segmentazione automatica del tetto dal rilievo (DSM) — "roof fitting".
//
// Input: il rilievo decodificato (vedi decodificaRilievo in rilievo.js):
//   { nx, ny, passoM, estensioneM, quote: Float32Array } con quote in metri
//   sopra il suolo, riga 0 = Nord, x = Est, y = Nord, centro = indirizzo.
//
// Passi:
//   1. sagoma dell'edificio (celle > soglia di altezza, componente più vicina al centro);
//   2. region growing su piani: ogni falda è un insieme connesso di celle che
//      stanno su uno stesso piano z = c + a·x + b·y (tolleranza in quota e in pendenza);
//   3. contorno di ogni falda → poligono semplificato (rettangolo orientato se
//      la forma è quasi rettangolare);
//   4. ostacoli (camini, lucernari, unità tecniche): celle che sporgono dal piano
//      della falda;
//   5. classificazione: tetto piano (< 7°) oppure falda (pendenza, orientamento).
//
// Nessuna dipendenza: il modulo lavora in coordinate locali (metri) e la
// conversione in lng/lat è fatta da chi lo chiama.

const DEG = Math.PI / 180;

export const SEG_DEFAULT = {
  sogliaEdificioM: 2.5, // altezza minima per considerare una cella "edificio"
  sogliaEdificioPoligonoM: 1.5, // idem, quando l'area è scelta a mano dall'utente
  poligono: null, // [{x,y}] area scelta dall'utente (metri locali): limita l'analisi
  tutti: false, // senza poligono: analizza tutti gli edifici entro raggioMaxM, non solo il più vicino al centro
  raggioMaxM: 70, // l'edificio deve stare entro questo raggio dal centro
  rugositaMaxM: 0.14, // scarto locale 3×3 massimo per far partire una falda
  tolleranzaQuotaM: 0.2, // distanza massima di una cella dal piano della falda
  tolleranzaPendenza: 0.16, // differenza massima di gradiente (≈ 9°)
  areaMinimaFaldaM2: 5,
  sogliaPianoDeg: 7, // sotto questa pendenza il tetto è considerato piano
  sogliaOstacoloM: 0.3, // sporgenza minima dal piano per essere un ostacolo
  paddingOstacoloM: 0.15,
  epsSemplificazioneM: 0.35,
  larghezzaMinimaM: 1.8, // falde più strette di così sono colmi/gronde, non falde
};

const norm360 = (a) => ((a % 360) + 360) % 360;

/* ----------------------------------------------------------------- utilità */

function filtroMediana3(z, nx, ny) {
  const out = new Float32Array(z.length);
  const w = new Array(9);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let k = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = Math.min(nx - 1, Math.max(0, i + di));
          const jj = Math.min(ny - 1, Math.max(0, j + dj));
          w[k++] = z[jj * nx + ii];
        }
      }
      w.sort((p, q) => p - q);
      out[j * nx + i] = w[4];
    }
  }
  return out;
}

const VICINI8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const VICINI4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];

function componentiConnesse(maschera, nx, ny, otto = true) {
  const id = new Int32Array(maschera.length).fill(-1);
  const comp = [];
  const vic = otto ? VICINI8 : VICINI4;
  for (let s = 0; s < maschera.length; s++) {
    if (!maschera[s] || id[s] >= 0) continue;
    const celle = [];
    const pila = [s];
    id[s] = comp.length;
    while (pila.length) {
      const c = pila.pop();
      celle.push(c);
      const ci = c % nx, cj = (c - ci) / nx;
      for (const [di, dj] of vic) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (maschera[k] && id[k] < 0) {
          id[k] = comp.length;
          pila.push(k);
        }
      }
    }
    comp.push(celle);
  }
  return comp;
}

// Accumulatori per il piano ai minimi quadrati z = c + a·x + b·y.
function nuovoPiano() {
  return { n: 0, sx: 0, sy: 0, sz: 0, sxx: 0, sxy: 0, syy: 0, sxz: 0, syz: 0, a: 0, b: 0, c: 0 };
}
function aggiungi(p, x, y, z) {
  p.n++; p.sx += x; p.sy += y; p.sz += z;
  p.sxx += x * x; p.sxy += x * y; p.syy += y * y; p.sxz += x * z; p.syz += y * z;
}
function risolvi(p) {
  if (p.n < 4) return false;
  const n = p.n;
  const mx = p.sx / n, my = p.sy / n, mz = p.sz / n;
  const sxx = p.sxx - n * mx * mx, sxy = p.sxy - n * mx * my, syy = p.syy - n * my * my;
  const sxz = p.sxz - n * mx * mz, syz = p.syz - n * my * mz;
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-6) return false;
  p.a = (sxz * syy - syz * sxy) / det;
  p.b = (syz * sxx - sxz * sxy) / det;
  p.c = mz - p.a * mx - p.b * my;
  return true;
}
const quotaP = (p, x, y) => p.c + p.a * x + p.b * y;

function areaPoly(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function puntoInPoly(p, poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

function distPuntoSegmento(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distPuntoSegmento(pts[i], a, b);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  const sx = rdp(pts.slice(0, idx + 1), eps);
  const dx = rdp(pts.slice(idx), eps);
  return sx.slice(0, -1).concat(dx);
}

// Semplificazione di un anello chiuso (senza ripetere il primo punto).
function semplificaAnello(pts, eps) {
  if (pts.length < 4) return pts;
  // punto di partenza = vertice più lontano dal primo, per spezzare l'anello in due catene
  let far = 0, dm = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > dm) { dm = d; far = i; }
  }
  const c1 = rdp(pts.slice(0, far + 1), eps);
  const c2 = rdp(pts.slice(far).concat([pts[0]]), eps);
  return c1.slice(0, -1).concat(c2.slice(0, -1));
}

// Rettangolo orientato di area minima che contiene i punti (scansione angolare).
function rettangoloMinimo(pts) {
  let migliore = null;
  for (let g = 0; g < 90; g += 1) {
    const c = Math.cos(g * DEG), s = Math.sin(g * DEG);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const u = p.x * c + p.y * s, v = -p.x * s + p.y * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!migliore || area < migliore.area) migliore = { area, g, u0, u1, v0, v1, c, s };
  }
  const { c, s, u0, u1, v0, v1 } = migliore;
  const daUV = (u, v) => ({ x: u * c - v * s, y: u * s + v * c });
  return { area: migliore.area, anello: [daUV(u0, v0), daUV(u1, v0), daUV(u1, v1), daUV(u0, v1)], larghezza: u1 - u0, altezza: v1 - v0 };
}

// Rettangolo orientato per una regione di celle: orientamento dal rettangolo
// minimo dei centri, dimensioni corrette in modo che l'area coincida con
// quella reale della regione (altrimenti la scalettatura dei pixel gonfia il
// contorno). Restituisce anche quanto la regione "riempie" il rettangolo.
function rettangoloDaCelle(centri, areaReale, passo) {
  const r0 = rettangoloMinimo(centri);
  const w0 = r0.larghezza, h0 = r0.altezza;
  // (w0 + d)(h0 + d) = areaReale  →  d² + (w0+h0)d + w0·h0 − A = 0
  const bb = w0 + h0, cc = w0 * h0 - areaReale;
  let d = (-bb + Math.sqrt(Math.max(0, bb * bb - 4 * cc))) / 2;
  d = Math.max(0, Math.min(passo * 1.5, d));
  const w = w0 + d, h = h0 + d;
  const mu = (r0.anello[0].x + r0.anello[2].x) / 2, mv = (r0.anello[0].y + r0.anello[2].y) / 2;
  const ux = r0.anello[1].x - r0.anello[0].x, uy = r0.anello[1].y - r0.anello[0].y;
  const lu = Math.hypot(ux, uy) || 1;
  const vx = r0.anello[3].x - r0.anello[0].x, vy = r0.anello[3].y - r0.anello[0].y;
  const lv = Math.hypot(vx, vy) || 1;
  const eu = { x: ux / lu, y: uy / lu }, ev = { x: vx / lv, y: vy / lv };
  const anello = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({
    x: mu + (a * w * eu.x) / 2 + (b * h * ev.x) / 2,
    y: mv + (a * w * eu.y) / 2 + (b * h * ev.y) / 2,
  }));
  return { anello, larghezza: w, altezza: h, riempimento: areaReale / (w * h) };
}

/* ---------------------------------------------------- contorno di una regione */

// Contorno esterno di un insieme di celle come anello di vertici (angoli di cella).
function contornoEsterno(celleSet, nx, ny, passo, est) {
  // archi orientati in senso antiorario attorno a ogni cella, solo sui lati di bordo
  const prossimi = new Map(); // chiave vertice → lista di vertici successivi
  const key = (i, j) => j * (nx + 2) + i;
  const aggiungiArco = (i0, j0, i1, j1) => {
    const k = key(i0, j0);
    if (!prossimi.has(k)) prossimi.set(k, []);
    prossimi.get(k).push([i1, j1]);
  };
  const dentro = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && celleSet.has(j * nx + i);
  for (const c of celleSet) {
    const i = c % nx, j = (c - i) / nx;
    // vertici: angolo (i,j) = alto-sinistra della cella (riga j cresce verso Sud)
    if (!dentro(i, j - 1)) aggiungiArco(i + 1, j, i, j); // lato Nord, verso Ovest
    if (!dentro(i - 1, j)) aggiungiArco(i, j, i, j + 1); // lato Ovest, verso Sud
    if (!dentro(i, j + 1)) aggiungiArco(i, j + 1, i + 1, j + 1); // lato Sud, verso Est
    if (!dentro(i + 1, j)) aggiungiArco(i + 1, j + 1, i + 1, j); // lato Est, verso Nord
  }
  const usati = new Set();
  const anelli = [];
  for (const [k0, lista] of prossimi) {
    for (let ix = 0; ix < lista.length; ix++) {
      const id0 = `${k0}:${ix}`;
      if (usati.has(id0)) continue;
      const i0 = k0 % (nx + 2), j0 = (k0 - i0) / (nx + 2);
      const anello = [];
      let ci = i0, cj = j0, idx = ix, kc = k0;
      let guardia = 0;
      while (guardia++ < 200000) {
        usati.add(`${kc}:${idx}`);
        anello.push([ci, cj]);
        const [ni, nj] = prossimi.get(kc)[idx];
        const nk = key(ni, nj);
        const opz = prossimi.get(nk);
        if (!opz) break;
        // in caso di biforcazione scegli l'arco non ancora usato
        let scelta = -1;
        for (let t = 0; t < opz.length; t++) if (!usati.has(`${nk}:${t}`)) { scelta = t; break; }
        ci = ni; cj = nj; kc = nk;
        if (scelta < 0) break;
        idx = scelta;
        if (ci === i0 && cj === j0 && usati.has(`${k0}:${ix}`)) break;
      }
      if (anello.length >= 4) anelli.push(anello);
    }
  }
  if (!anelli.length) return null;
  const aMetri = (a) => a.map(([i, j]) => ({ x: -est + i * passo, y: est - j * passo }));
  let best = null, areaMax = 0;
  for (const a of anelli) {
    const m = aMetri(a);
    const ar = Math.abs(areaPoly(m));
    if (ar > areaMax) { areaMax = ar; best = m; }
  }
  return best;
}

/* --------------------------------------------------------------- principale */

/* ------------------------------------------- ritaglio sul perimetro scelto */

function eConvesso(poly) {
  let segno = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) continue;
    const sg = cr > 0 ? 1 : -1;
    if (segno && sg !== segno) return false;
    segno = sg;
  }
  return true;
}

// Sutherland–Hodgman: il poligono `clip` deve essere convesso e antiorario
function ritagliaSuConvesso(subject, clip) {
  let out = subject.slice();
  for (let i = 0; i < clip.length && out.length; i++) {
    const A = clip[i], B = clip[(i + 1) % clip.length];
    const lato = (P) => (B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x);
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const cur = inp[j], prev = inp[(j + inp.length - 1) % inp.length];
      const sc = lato(cur), sp = lato(prev);
      if (sc >= -1e-9) {
        if (sp < -1e-9) {
          const t = sp / (sp - sc);
          out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
        }
        out.push(cur);
      } else if (sp >= -1e-9) {
        const t = sp / (sp - sc);
        out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
      }
    }
  }
  return out;
}

function puntoPiuVicinoSulBordo(p, poly) {
  let best = null, dBest = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < dBest) { dBest = d; best = q; }
  }
  return best;
}

/**
 * Ritaglia l'anello di una falda sul perimetro disegnato dall'utente, così che nulla
 * (nemmeno i bordi arrotondati al passo del rilievo) esca dalla zona scelta.
 * Perimetro convesso: ritaglio esatto. Concavo: i vertici fuori vengono portati sul bordo.
 * @returns {{anello:{x,y}[], modificato:boolean}|null}
 */
export function ritagliaAlPerimetro(anello, perimetro) {
  if (!perimetro || perimetro.length < 3) return { anello, modificato: false };
  if (anello.every((q) => puntoInPoly(q, perimetro))) return { anello, modificato: false };
  const clip = areaPoly(perimetro) < 0 ? perimetro.slice().reverse() : perimetro;
  let out;
  if (eConvesso(clip)) {
    out = ritagliaSuConvesso(anello, clip);
  } else {
    out = anello.map((q) => (puntoInPoly(q, perimetro) ? q : puntoPiuVicinoSulBordo(q, perimetro)));
  }
  // toglie i vertici doppi
  const pulito = [];
  for (const q of out) {
    const l = pulito[pulito.length - 1];
    if (!l || Math.hypot(q.x - l.x, q.y - l.y) > 0.02) pulito.push(q);
  }
  if (pulito.length > 1 && Math.hypot(pulito[0].x - pulito[pulito.length - 1].x, pulito[0].y - pulito[pulito.length - 1].y) <= 0.02) pulito.pop();
  if (pulito.length < 3 || Math.abs(areaPoly(pulito)) < 0.5) return null;
  return { anello: pulito, modificato: true };
}


/* ------------------------------------------ falde mai sovrapposte tra loro */

function involucroConvesso(pts) {
  const P = pts.map((q) => ({ x: q.x, y: q.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const low = [];
  for (const q of P) { while (low.length >= 2 && cr(low[low.length - 2], low[low.length - 1], q) <= 0) low.pop(); low.push(q); }
  const up = [];
  for (let i = P.length - 1; i >= 0; i--) { const q = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  low.pop(); up.pop();
  return low.concat(up); // antiorario
}

// parte di `poly` sul lato destro del segmento a→b (cioè fuori da un poligono antiorario che ha a→b come lato)
function ritagliaFuoriDalLato(poly, a, b) {
  const lato = (P) => -((b.x - a.x) * (P.y - a.y) - (b.y - a.y) * (P.x - a.x)); // > 0 = fuori
  const out = [];
  for (let j = 0; j < poly.length; j++) {
    const cur = poly[j], prev = poly[(j + poly.length - 1) % poly.length];
    const sc = lato(cur), sp = lato(prev);
    if (sc >= -1e-9) {
      if (sp < -1e-9) { const t = sp / (sp - sc); out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) }); }
      out.push(cur);
    } else if (sp >= -1e-9) {
      const t = sp / (sp - sc);
      out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
    }
  }
  return out;
}

/**
 * Le falde rilevate non devono sovrapporsi. Si parte dalla più grande, che tiene la sua forma;
 * ogni falda successiva che la invade viene tagliata lungo il lato della precedente che le
 * lascia più superficie. Il taglio è rettilineo, quindi le falde restano poligoni puliti.
 */
function risolviSovrapposizioni(falde, areaMinimaM2) {
  const ordine = falde.slice().sort((a, b) => b.areaPiantaM2 - a.areaPiantaM2);
  const tenute = [];
  const scartate = new Set();
  for (const f of ordine) {
    let anello = f.anello;
    for (let pass = 0; pass < 4 && anello.length >= 3; pass++) {
      let cambiato = false;
      for (const g of tenute) {
        const hull = involucroConvesso(g.anello);
        if (hull.length < 3) continue;
        const dentro = ritagliaSuConvesso(anello, hull);
        if (dentro.length < 3 || Math.abs(areaPoly(dentro)) < 0.05) continue; // niente o solo un filo
        let best = null, bestA = -1;
        for (let i = 0; i < hull.length; i++) {
          const pezzo = ritagliaFuoriDalLato(anello, hull[i], hull[(i + 1) % hull.length]);
          const ar = pezzo.length >= 3 ? Math.abs(areaPoly(pezzo)) : 0;
          if (ar > bestA) { bestA = ar; best = pezzo; }
        }
        anello = best && bestA > 0 ? best : [];
        cambiato = true;
        if (anello.length < 3) break;
      }
      if (!cambiato) break;
    }
    // vertici doppi
    const pul = [];
    for (const q of anello) { const l = pul[pul.length - 1]; if (!l || Math.hypot(q.x - l.x, q.y - l.y) > 0.02) pul.push(q); }
    if (pul.length > 1 && Math.hypot(pul[0].x - pul[pul.length - 1].x, pul[0].y - pul[pul.length - 1].y) <= 0.02) pul.pop();
    if (pul.length < 3 || Math.abs(areaPoly(pul)) < areaMinimaM2) { scartate.add(f); continue; }
    if (pul !== f.anello) {
      if (areaPoly(pul) < 0) pul.reverse();
      const aNuova = Math.abs(areaPoly(pul));
      if (Math.abs(aNuova - f.areaPiantaM2) > 1e-6) f.forma = "poligono";
      f.anello = pul;
      f.areaPiantaM2 = aNuova;
      f.areaM2 = aNuova / Math.max(0.2, Math.cos(f.pendenzaDeg * DEG));
    }
    tenute.push(f);
  }
  return falde.filter((f) => !scartate.has(f));
}


/**
 * @param {object} ril rilievo decodificato
 * @param {object} [opz] sovrascrive SEG_DEFAULT
 * @returns {{ falde: Array, ostacoli: Array, edificioM2: number, avvisi: string[] }}
 *   falde[i] = { id, anello:[{x,y}], areaM2, areaPiantaM2, pendenzaDeg, azimutDiscesa,
 *                tipo:"piano"|"falda", rms, n, piano:{a,b,c}, ostacoli:[anello,…] }
 */
export function segmentaTetto(ril, opz = {}) {
  const o = { ...SEG_DEFAULT, ...opz };
  const { nx, ny, passoM: p, estensioneM: est } = ril;
  const N = nx * ny;
  const avvisi = [];
  const perimetro = Array.isArray(o.poligono) && o.poligono.length >= 3 ? o.poligono : null;
  const X = (i) => -est + i * p;
  const Y = (j) => est - j * p;

  const grezza = ril.quote; // senza filtro: i camini da 1 m (2 celle) sparirebbero con la mediana
  const zs = filtroMediana3(ril.quote, nx, ny);

  /* 1. sagoma dell'edificio ------------------------------------------------ */
  let edificio = null;
  if (Array.isArray(o.poligono) && o.poligono.length >= 3) {
    // Area scelta dall'utente: si analizzano SOLO le celle dentro il poligono
    // (un po' più basse come soglia, perché capannoni e tettoie possono stare
    // sotto i 2,5 m), così gli edifici adiacenti non vengono mai inclusi.
    const poly = o.poligono;
    const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) + est) / p)), i1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) + est) / p));
    const j0 = Math.max(0, Math.floor((est - Math.max(...ys)) / p)), j1 = Math.min(ny - 1, Math.ceil((est - Math.min(...ys)) / p));
    const soglia = o.sogliaEdificioPoligonoM;
    const dentro = new Uint8Array(N);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (zs[k] > soglia && puntoInPoly({ x: X(i), y: Y(j) }, poly)) dentro[k] = 1;
      }
    }
    const celleTutte = [];
    for (const celle of componentiConnesse(dentro, nx, ny, true)) {
      if (celle.length * p * p < 4) continue; // rumore
      for (const c of celle) celleTutte.push(c);
    }
    edificio = celleTutte.length ? celleTutte : null;
    if (!edificio) {
      return { falde: [], ostacoli: [], edificioM2: 0, avvisi: ["Nell'area selezionata non risultano tetti rilevabili: controlla di aver racchiuso l'edificio."] };
    }
  } else {
    const alta = new Uint8Array(N);
    for (let k = 0; k < N; k++) alta[k] = zs[k] > o.sogliaEdificioM ? 1 : 0;
    const comps = componentiConnesse(alta, nx, ny, true);
    let distMin = Infinity;
    for (const celle of comps) {
      if (celle.length * p * p < 15) continue;
      let d = Infinity;
      for (const c of celle) {
        const i = c % nx, j = (c - i) / nx;
        const dd = Math.hypot(X(i), Y(j));
        if (dd < d) d = dd;
      }
      if (o.tutti) {
        if (d <= o.raggioMaxM) edificio = (edificio || []).concat(celle);
      } else if (d < distMin && d <= o.raggioMaxM) { distMin = d; edificio = celle; }
    }
    if (!edificio) {
      return { falde: [], ostacoli: [], edificioM2: 0, avvisi: ["Nessun edificio riconosciuto vicino al punto indicato."] };
    }
  }
  const inEdificio = new Uint8Array(N);
  for (const c of edificio) inEdificio[c] = 1;
  const edificioM2 = edificio.length * p * p;

  /* 2. gradiente e rugosità locali ---------------------------------------- */
  const gx = new Float32Array(N), gy = new Float32Array(N), rug = new Float32Array(N).fill(9);
  for (const c of edificio) {
    const i = c % nx, j = (c - i) / nx;
    if (i < 1 || j < 1 || i >= nx - 1 || j >= ny - 1) continue;
    const pl = nuovoPiano();
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) aggiungi(pl, di * p, -dj * p, zs[(j + dj) * nx + (i + di)]);
    }
    if (!risolvi(pl)) continue;
    let s2 = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const r = zs[(j + dj) * nx + (i + di)] - quotaP(pl, di * p, -dj * p);
        s2 += r * r;
      }
    }
    gx[c] = pl.a; gy[c] = pl.b;
    rug[c] = Math.sqrt(s2 / 9);
  }

  /* 3. region growing su piani --------------------------------------------- */
  const regione = new Int32Array(N).fill(-1);
  const semi = edificio.filter((c) => rug[c] <= o.rugositaMaxM).sort((p1, p2) => rug[p1] - rug[p2]);
  const falde = [];
  for (const s of semi) {
    if (regione[s] >= 0) continue;
    const id = falde.length;
    const si = s % nx, sj = (s - si) / nx;
    const pl = nuovoPiano();
    pl.a = gx[s]; pl.b = gy[s]; pl.c = zs[s] - pl.a * X(si) - pl.b * Y(sj);
    const celle = [];
    const coda = [s];
    regione[s] = id;
    aggiungi(pl, X(si), Y(sj), zs[s]);
    celle.push(s);
    let ultimoFit = 1;
    while (coda.length) {
      const c = coda.pop();
      const ci = c % nx, cj = (c - ci) / nx;
      for (const [di, dj] of VICINI8) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (!inEdificio[k] || regione[k] >= 0) continue;
        const x = X(i), y = Y(j);
        if (Math.abs(zs[k] - quotaP(pl, x, y)) > o.tolleranzaQuotaM) continue;
        if (rug[k] <= o.rugositaMaxM * 2 && (Math.abs(gx[k] - pl.a) > o.tolleranzaPendenza || Math.abs(gy[k] - pl.b) > o.tolleranzaPendenza)) continue;
        regione[k] = id;
        aggiungi(pl, x, y, zs[k]);
        celle.push(k);
        coda.push(k);
        if (pl.n >= 6 && pl.n >= ultimoFit * 1.25) {
          if (risolvi(pl)) ultimoFit = pl.n;
        }
      }
    }
    risolvi(pl);
    falde.push({ id, celle, piano: pl });
  }

  /* 4. pulizia, riempimento ai bordi e poligoni ---------------------------- */
  const risultato = [];
  let contaId = 1;
  const regioneFinale = new Int32Array(N).fill(-1);
  // tieni le falde sufficientemente grandi, ordinate per area decrescente
  falde.sort((f1, f2) => f2.celle.length - f1.celle.length);
  const tenute = [];
  for (const f of falde) {
    // elimina le celle con meno di 2 vicini (4-conn.) della stessa falda
    const set = new Set(f.celle);
    for (let pass = 0; pass < 2; pass++) {
      for (const c of Array.from(set)) {
        const ci = c % nx, cj = (c - ci) / nx;
        let v = 0;
        for (const [di, dj] of VICINI4) {
          const i = ci + di, j = cj + dj;
          if (i >= 0 && j >= 0 && i < nx && j < ny && set.has(j * nx + i)) v++;
        }
        if (v < 2) set.delete(c);
      }
    }
    if (set.size * p * p < o.areaMinimaFaldaM2) continue;
    // tieni solo la componente più grande
    const maschera = new Uint8Array(N);
    for (const c of set) maschera[c] = 1;
    const cc = componentiConnesse(maschera, nx, ny, false).sort((a, b) => b.length - a.length)[0];
    if (!cc || cc.length * p * p < o.areaMinimaFaldaM2) continue;
    tenute.push({ ...f, set: new Set(cc) });
  }
  for (const f of tenute) for (const c of f.set) regioneFinale[c] = f.id;
  // dilata di una cella verso le celle libere dell'edificio, se coerenti col piano
  for (const f of tenute) {
    const nuove = [];
    for (const c of f.set) {
      const ci = c % nx, cj = (c - ci) / nx;
      for (const [di, dj] of VICINI8) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (!inEdificio[k] || regioneFinale[k] >= 0) continue;
        if (Math.abs(zs[k] - quotaP(f.piano, X(i), Y(j))) <= 0.35) nuove.push(k);
      }
    }
    for (const k of nuove) { if (regioneFinale[k] < 0) { regioneFinale[k] = f.id; f.set.add(k); } }
  }

  for (const f of tenute) {
    const pl = f.piano;
    // residui sulla falda
    let s2 = 0;
    for (const c of f.set) {
      const i = c % nx, j = (c - i) / nx;
      const r = zs[c] - quotaP(pl, X(i), Y(j));
      s2 += r * r;
    }
    const rms = Math.sqrt(s2 / f.set.size);

    const contorno = contornoEsterno(f.set, nx, ny, p, est);
    if (!contorno || contorno.length < 4) continue;
    let anello = semplificaAnello(contorno, o.epsSemplificazioneM);
    if (anello.length < 3) continue;
    const areaReale = f.set.size * p * p;
    const centri = [];
    for (const c of f.set) { const i = c % nx, j = (c - i) / nx; centri.push({ x: X(i), y: Y(j) }); }
    const rett = rettangoloDaCelle(centri, areaReale, p);
    if (Math.min(rett.larghezza, rett.altezza) < o.larghezzaMinimaM) continue; // strisce sottili (colmi, gronde)
    let forma = "poligono";
    if (rett.riempimento >= 0.84) {
      anello = rett.anello;
      forma = "rettangolo";
    }
    if (areaPoly(anello) < 0) anello = anello.slice().reverse(); // antiorario
    if (perimetro) {
      // niente può uscire dalla zona perimetrata dall'utente
      const rit = ritagliaAlPerimetro(anello, perimetro);
      if (!rit) continue;
      if (rit.modificato) { anello = rit.anello; forma = "poligono"; }
      if (areaPoly(anello) < 0) anello = anello.slice().reverse();
    }
    const areaPianta = Math.abs(areaPoly(anello));
    if (areaPianta < o.areaMinimaFaldaM2) continue;

    const pendenzaRad = Math.atan(Math.hypot(pl.a, pl.b));
    const pendenzaDeg = pendenzaRad / DEG;
    const azimutDiscesa = norm360(Math.atan2(-pl.a, -pl.b) / DEG);
    const piano = pendenzaDeg < o.sogliaPianoDeg;

    risultato.push({
      id: f.id,
      forma,
      anello,
      areaPiantaM2: areaPianta,
      areaM2: areaPianta / Math.max(0.2, Math.cos(pendenzaRad)),
      pendenzaDeg,
      azimutDiscesa: piano ? null : azimutDiscesa,
      tipo: piano ? "piano" : "falda",
      orientApp: piano ? null : (() => { let q = norm360(azimutDiscesa - 180); if (q > 180) q -= 360; return Math.round(q); })(),
      rms,
      n: f.set.size,
      piano: { a: pl.a, b: pl.b, c: pl.c },
      _set: f.set,
      ostacoli: [],
    });
  }

  // le falde vicine non devono sovrapporsi (i rettangoli adattati ai bordi possono invadersi)
  const senzaSovrapposizioni = risolviSovrapposizioni(risultato, o.areaMinimaFaldaM2);
  risultato.length = 0;
  risultato.push(...senzaSovrapposizioni);

  /* 5. ostacoli ------------------------------------------------------------ */
  const ostacoliTutti = [];
  for (const f of risultato) {
    const pl = f.piano;
    const xs = f.anello.map((q) => q.x), ys = f.anello.map((q) => q.y);
    const i0 = Math.max(1, Math.floor((Math.min(...xs) + est) / p)), i1 = Math.min(nx - 2, Math.ceil((Math.max(...xs) + est) / p));
    const j0 = Math.max(1, Math.floor((est - Math.max(...ys)) / p)), j1 = Math.min(ny - 2, Math.ceil((est - Math.min(...ys)) / p));
    const maschera = new Uint8Array(N);
    let cnt = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (!inEdificio[k]) continue;
        if (regioneFinale[k] >= 0 && regioneFinale[k] !== f.id) continue; // appartiene a un'altra falda
        const pt = { x: X(i), y: Y(j) };
        if (!puntoInPoly(pt, f.anello)) continue;
        // lontano dal bordo (≥ 1 cella) per non scambiare parapetti per ostacoli
        let interno = true;
        for (const [di, dj] of VICINI8) {
          if (!puntoInPoly({ x: X(i + di), y: Y(j + dj) }, f.anello)) { interno = false; break; }
        }
        if (!interno) continue;
        if (grezza[k] - quotaP(pl, pt.x, pt.y) > o.sogliaOstacoloM) { maschera[k] = 1; cnt++; }
      }
    }
    if (!cnt) continue;
    for (const celle of componentiConnesse(maschera, nx, ny, true)) {
      if (celle.length < 2) continue;
      const pts = [];
      for (const c of celle) {
        const i = c % nx, j = (c - i) / nx;
        // angoli della cella (la cella copre p×p attorno al centro)
        for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) pts.push({ x: X(i) + dx * p, y: Y(j) + dy * p });
      }
      const rr = rettangoloMinimo(pts);
      if (rr.area > 0.4 * f.areaPiantaM2) continue; // troppo grande: rumore o falda mancata
      // padding: scala il rettangolo attorno al suo centro
      const cx = rr.anello.reduce((s, q) => s + q.x, 0) / 4, cy = rr.anello.reduce((s, q) => s + q.y, 0) / 4;
      const w = Math.hypot(rr.anello[1].x - rr.anello[0].x, rr.anello[1].y - rr.anello[0].y);
      const h = Math.hypot(rr.anello[3].x - rr.anello[0].x, rr.anello[3].y - rr.anello[0].y);
      const fw = (w + 2 * o.paddingOstacoloM) / Math.max(w, 1e-6), fh = (h + 2 * o.paddingOstacoloM) / Math.max(h, 1e-6);
      const ux = (rr.anello[1].x - rr.anello[0].x) / Math.max(w, 1e-6), uy = (rr.anello[1].y - rr.anello[0].y) / Math.max(w, 1e-6);
      const vx = (rr.anello[3].x - rr.anello[0].x) / Math.max(h, 1e-6), vy = (rr.anello[3].y - rr.anello[0].y) / Math.max(h, 1e-6);
      const hw = (w * fw) / 2, hh = (h * fh) / 2;
      const anelloOst = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({
        x: cx + sx * hw * ux + sy * hh * vx,
        y: cy + sx * hw * uy + sy * hh * vy,
      }));
      const altezza = Math.max(...celle.map((c) => {
        const i = c % nx, j = (c - i) / nx;
        return grezza[c] - quotaP(pl, X(i), Y(j));
      }));
      let anelloFinale = anelloOst;
      if (perimetro) {
        const rit = ritagliaAlPerimetro(anelloOst, perimetro);
        if (!rit) continue;
        anelloFinale = rit.anello;
      }
      f.ostacoli.push(anelloFinale);
      ostacoliTutti.push({ falda: f.id, anello: anelloFinale, altezzaM: altezza });
    }
  }

  // ordina per area decrescente e assegna id progressivi leggibili
  risultato.sort((a, b) => b.areaPiantaM2 - a.areaPiantaM2);
  risultato.forEach((f) => { f.id = contaId++; delete f._set; });
  if (!risultato.length) avvisi.push("Edificio trovato ma nessuna falda piana riconoscibile: il rilievo potrebbe essere troppo rumoroso.");
  if (ril.georefEsatta === false) avvisi.push("Georeferenziazione approssimata: controlla che le falde si sovrappongano alla foto.");

  return { falde: risultato, ostacoli: ostacoliTutti, edificioM2, avvisi };
}

/**
 * Converte il risultato in "aree" del RoofPlanner (anelli in lng/lat).
 * @param {object} seg risultato di segmentaTetto
 * @param {{lat:number,lng:number}} centro
 * @param {(centro,{x,y})=>[number,number]} localeToLngLat
 * @param {object} def   POSA_DEFAULT
 */
export function areeDaSegmentazione(seg, centro, localeToLngLat, def, nuovoId) {
  const lnglat = (anello) => anello.map((q) => localeToLngLat(centro, q));
  return seg.falde.map((f, idx) => {
    const piano = f.tipo === "piano";
    let orient = 0;
    if (!piano) {
      orient = norm360(f.azimutDiscesa - 180 + 180) - 180; // azimut faccia = 180 + orient
    }
    return {
      id: nuovoId(),
      nome: `Falda ${idx + 1}${!piano && Math.abs(Math.round(orient)) > 100 ? " (a Nord)" : ""}`,
      tipo: f.tipo,
      ring: lnglat(f.anello),
      ostacoli: f.ostacoli.map(lnglat),
      tilt: piano ? def.tiltPianoSud : Math.max(5, Math.min(60, Math.round(f.pendenzaDeg))),
      orient: Math.round(orient),
      disposizione: "sud",
      orientamentoModulo: "auto",
      margine: piano ? def.marginePiano : def.margineFalda,
      allinea: true,
      auto: true,
    };
  });
}

/** Distanza angolare dal Sud (0 = Sud, 180 = Nord). I tetti piani contano come Sud: i pannelli si posano rivolti a Sud. */
export function distanzaDalSud(f) {
  if (f.tipo === "piano" || f.orientApp == null) return 0;
  return Math.abs(f.orientApp);
}

/** Etichetta di esposizione leggibile. */
export function etichettaEsposizione(f) {
  if (f.tipo === "piano") return "Tetto piano";
  const d = distanzaDalSud(f);
  const lato = f.orientApp > 0 ? "Ovest" : "Est";
  if (d <= 22) return "Sud";
  if (d <= 67) return `Sud-${lato}`;
  if (d <= 112) return lato;
  if (d <= 157) return `Nord-${lato}`;
  return "Nord";
}

/** Ordina le falde dando precedenza a quelle rivolte a Sud (a parità, la più grande prima). */
export function ordinaPerSud(falde) {
  return falde.slice().sort((a, b) => distanzaDalSud(a) - distanzaDalSud(b) || b.areaPiantaM2 - a.areaPiantaM2);
}
