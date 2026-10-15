// Rilievo reale (DSM di Google Solar API) in coordinate locali in metri
// (x = Est, y = Nord), centrato sul sito. Lato client: decodifica, campiona le
// quote e stima il piano medio di un'area (pendenza e verso della falda).

import { puntoInPoligono } from "./roofLayout";

const DEG = Math.PI / 180;

export function decodificaRilievo(r) {
  const bin = atob(r.quoteB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const cm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const quote = new Float32Array(cm.length);
  for (let i = 0; i < cm.length; i++) quote[i] = cm[i] / 100;
  return {
    nx: r.nx,
    ny: r.ny,
    passoM: r.passoM,
    estensioneM: r.estensioneM,
    quote,
    fotoDataUrl: r.fotoDataUrl,
    suoloM: r.suoloM,
    qualita: r.qualita,
    data: r.data,
    georefEsatta: r.georefEsatta,
  };
}

// Quota (m sopra il suolo) in (x, y) con interpolazione bilineare.
export function quotaIn(ril, x, y) {
  const fi = (x + ril.estensioneM) / ril.passoM;
  const fj = (ril.estensioneM - y) / ril.passoM;
  const i0 = Math.max(0, Math.min(ril.nx - 1, Math.floor(fi)));
  const j0 = Math.max(0, Math.min(ril.ny - 1, Math.floor(fj)));
  const i1 = Math.min(ril.nx - 1, i0 + 1);
  const j1 = Math.min(ril.ny - 1, j0 + 1);
  const tx = Math.max(0, Math.min(1, fi - i0));
  const ty = Math.max(0, Math.min(1, fj - j0));
  const q = (i, j) => ril.quote[j * ril.nx + i];
  return (
    q(i0, j0) * (1 - tx) * (1 - ty) + q(i1, j0) * tx * (1 - ty) + q(i0, j1) * (1 - tx) * ty + q(i1, j1) * tx * ty
  );
}

/**
 * Piano medio di un'area: z = z0 + a·(x − cx) + b·(y − cy), con eliminazione
 * iterativa dei punti anomali (parapetti, lucernari, impianti sul tetto).
 * @returns {null | {a, b, z0, cx, cy, rms, n, pendenzaDeg, azimutDiscesa}}
 */
export function stimaPiano(ril, poligono, ostacoli = []) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of poligono) {
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
    miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }
  const passo = Math.max(ril.passoM, 0.5);
  let punti = [];
  for (let y = miny; y <= maxy; y += passo) {
    for (let x = minx; x <= maxx; x += passo) {
      const p = { x, y };
      if (!puntoInPoligono(p, poligono)) continue;
      if (ostacoli.some((o) => puntoInPoligono(p, o))) continue;
      punti.push({ x, y, z: quotaIn(ril, x, y) });
    }
  }
  if (punti.length < 12) return null;

  let fit = null;
  for (let it = 0; it < 4; it++) {
    const n = punti.length;
    const cx = punti.reduce((s, p) => s + p.x, 0) / n;
    const cy = punti.reduce((s, p) => s + p.y, 0) / n;
    const cz = punti.reduce((s, p) => s + p.z, 0) / n;
    let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
    for (const p of punti) {
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * dz; syz += dy * dz;
    }
    const det = sxx * syy - sxy * sxy;
    if (Math.abs(det) < 1e-9) return null;
    const a = (sxz * syy - syz * sxy) / det;
    const b = (syz * sxx - sxz * sxy) / det;
    const res = punti.map((p) => p.z - (cz + a * (p.x - cx) + b * (p.y - cy)));
    const rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / n);
    fit = { a, b, z0: cz, cx, cy, rms, n };
    const soglia = Math.max(0.25, 2 * rms);
    const tenuti = punti.filter((_, k) => Math.abs(res[k]) <= soglia);
    if (tenuti.length === punti.length || tenuti.length < 12) break;
    punti = tenuti;
  }
  const pend = Math.atan(Math.hypot(fit.a, fit.b)) / DEG;
  let az = Math.atan2(-fit.a, -fit.b) / DEG;
  if (az < 0) az += 360;
  return { ...fit, pendenzaDeg: pend, azimutDiscesa: az };
}

export function quotaPiano(piano, x, y) {
  return piano.z0 + piano.a * (x - piano.cx) + piano.b * (y - piano.cy);
}
