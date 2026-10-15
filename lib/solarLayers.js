// Elaborazione dei livelli di Google Solar API (dataLayers): modello digitale
// delle superfici (DSM) e foto aerea RGB, entrambi GeoTIFF in coordinate
// proiettate (UTM). Li ricampiona su una griglia locale in metri
// (x = Est, y = Nord, centrata sul sito) in modo che coincidano con il resto
// dell'app (aree disegnate, moduli, vista 3D).
//
// Solo lato server: usa il pacchetto "geotiff".

import { fromArrayBuffer } from "geotiff";
import { localeToLngLat } from "./roofLayout";

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ UTM */

// Trasformazione diretta WGS84 -> UTM (serie di Krüger, precisione < 1 mm).
export function utmDiretto(latDeg, lngDeg, zona, sud = false) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + (n * n) / 4 + (n ** 4) / 64);
  const alpha = [
    n / 2 - (2 * n * n) / 3 + (5 * n ** 3) / 16,
    (13 * n * n) / 48 - (3 * n ** 3) / 5,
    (61 * n ** 3) / 240,
  ];
  const e = Math.sqrt(f * (2 - f));
  const lng0 = ((zona - 1) * 6 - 180 + 3) * DEG;
  const phi = latDeg * DEG;
  const dl = lngDeg * DEG - lng0;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi1 = Math.atan2(t, Math.cos(dl));
  const eta1 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xi = xi1;
  let eta = eta1;
  for (let j = 1; j <= 3; j++) {
    xi += alpha[j - 1] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
    eta += alpha[j - 1] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
  }
  return { E: 500000 + k0 * A * eta, N: (sud ? 10000000 : 0) + k0 * A * xi };
}

function proiezioneDaGeoKeys(keys) {
  const p = keys?.ProjectedCSTypeGeoKey;
  if (p >= 32601 && p <= 32660) return { tipo: "utm", zona: p - 32600, sud: false };
  if (p >= 32701 && p <= 32760) return { tipo: "utm", zona: p - 32700, sud: true };
  if (p >= 25828 && p <= 25838) return { tipo: "utm", zona: p - 25800, sud: false }; // ETRS89 / UTM (≈ WGS84)
  if (!p && (keys?.GeographicTypeGeoKey === 4326 || keys?.GeographicTypeGeoKey === 4258)) return { tipo: "geo" };
  return null;
}

/* ---------------------------------------------------------------- GeoTIFF */

async function leggiGeoTiff(buffer, { interleave = false } = {}) {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const [minx, miny, maxx, maxy] = image.getBoundingBox();
  const w = image.getWidth();
  const h = image.getHeight();
  const campioni = image.getSamplesPerPixel();
  const rasters = await image.readRasters({ interleave });
  const keys = image.getGeoKeys ? image.getGeoKeys() : {};
  return { minx, miny, maxx, maxy, w, h, campioni, rasters, proiezione: proiezioneDaGeoKeys(keys), keys };
}

// Mappa (x, y) locali in metri -> (col, riga) frazionarie del raster.
function creaMappa(r, origine) {
  const pw = (r.maxx - r.minx) / r.w;
  const ph = (r.maxy - r.miny) / r.h;
  if (r.proiezione?.tipo === "utm") {
    const { zona, sud } = r.proiezione;
    return {
      esatta: true,
      aColRiga(x, y) {
        const [lng, lat] = localeToLngLat(origine, { x, y });
        const { E, N } = utmDiretto(lat, lng, zona, sud);
        return [(E - r.minx) / pw - 0.5, (r.maxy - N) / ph - 0.5];
      },
    };
  }
  if (r.proiezione?.tipo === "geo") {
    return {
      esatta: true,
      aColRiga(x, y) {
        const [lng, lat] = localeToLngLat(origine, { x, y });
        return [(lng - r.minx) / pw - 0.5, (r.maxy - lat) / ph - 0.5];
      },
    };
  }
  // CRS sconosciuto: si assume raster in metri e centrato sul sito
  const cx = (r.minx + r.maxx) / 2;
  const cy = (r.miny + r.maxy) / 2;
  return {
    esatta: false,
    aColRiga(x, y) {
      return [(cx + x - r.minx) / pw - 0.5, (r.maxy - (cy + y)) / ph - 0.5];
    },
  };
}

function bilineare(banda, w, h, col, riga, stride = 1, offset = 0, nodata = null) {
  if (col < 0 || riga < 0 || col > w - 1 || riga > h - 1) return NaN;
  const c0 = Math.floor(col);
  const r0 = Math.floor(riga);
  const c1 = Math.min(w - 1, c0 + 1);
  const r1 = Math.min(h - 1, r0 + 1);
  const fc = col - c0;
  const fr = riga - r0;
  const v = (c, r) => banda[(r * w + c) * stride + offset];
  const vals = [v(c0, r0), v(c1, r0), v(c0, r1), v(c1, r1)];
  const w4 = [(1 - fc) * (1 - fr), fc * (1 - fr), (1 - fc) * fr, fc * fr];
  let somma = 0;
  let peso = 0;
  for (let i = 0; i < 4; i++) {
    const x = vals[i];
    if (!Number.isFinite(x) || (nodata !== null && x <= nodata)) continue;
    somma += x * w4[i];
    peso += w4[i];
  }
  return peso > 0.0001 ? somma / peso : NaN;
}

/**
 * @param {object} p
 *  dsmBuf, rgbBuf: ArrayBuffer dei GeoTIFF
 *  origine: { lat, lng } centro del sito
 *  estensioneM: metà lato dell'area in uscita (m)
 *  passoQuotaM: passo della griglia delle quote (m)
 *  passoFotoM: passo dei pixel della foto in uscita (m)
 * @returns {{nx, ny, passoM, estensioneM, quoteCm: Int16Array, suoloM, foto: {w, h, rgb: Uint8Array}, georefEsatta: boolean}}
 */
export async function elaboraStrati({ dsmBuf, rgbBuf, origine, estensioneM = 90, passoQuotaM = 0.5, passoFotoM = 0.25 }) {
  const dsm = await leggiGeoTiff(dsmBuf);
  const mapDsm = creaMappa(dsm, origine);
  const banda = dsm.rasters[0];

  const nx = Math.round((2 * estensioneM) / passoQuotaM) + 1;
  const quote = new Float32Array(nx * nx);
  let validi = 0;
  for (let j = 0; j < nx; j++) {
    const y = estensioneM - j * passoQuotaM; // riga 0 = Nord
    for (let i = 0; i < nx; i++) {
      const x = -estensioneM + i * passoQuotaM;
      const [col, riga] = mapDsm.aColRiga(x, y);
      const z = bilineare(banda, dsm.w, dsm.h, col, riga, 1, 0, -9000);
      quote[j * nx + i] = z;
      if (Number.isFinite(z)) validi++;
    }
  }
  if (validi < nx * nx * 0.05) throw new Error("Rilievo (DSM) non disponibile per questa posizione.");

  // quota del suolo: 2° percentile dei valori validi
  const ordinati = Float32Array.from(quote.filter((v) => Number.isFinite(v))).sort();
  const suoloM = ordinati[Math.floor(ordinati.length * 0.02)];
  const quoteCm = new Int16Array(nx * nx);
  for (let k = 0; k < quote.length; k++) {
    const v = Number.isFinite(quote[k]) ? quote[k] : suoloM;
    quoteCm[k] = Math.max(-3000, Math.min(32000, Math.round((v - suoloM) * 100)));
  }

  // foto RGB
  const rgbTiff = await leggiGeoTiff(rgbBuf, { interleave: true });
  const mapRgb = creaMappa(rgbTiff, origine);
  const fw = Math.round((2 * estensioneM) / passoFotoM);
  const rgb = new Uint8Array(fw * fw * 3);
  const dati = rgbTiff.rasters;
  const stride = rgbTiff.campioni;
  for (let j = 0; j < fw; j++) {
    const y = estensioneM - (j + 0.5) * passoFotoM;
    for (let i = 0; i < fw; i++) {
      const x = -estensioneM + (i + 0.5) * passoFotoM;
      const [col, riga] = mapRgb.aColRiga(x, y);
      for (let c = 0; c < 3; c++) {
        const v = bilineare(dati, rgbTiff.w, rgbTiff.h, col, riga, stride, c);
        rgb[(j * fw + i) * 3 + c] = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 40;
      }
    }
  }

  return {
    nx,
    ny: nx,
    passoM: passoQuotaM,
    estensioneM,
    quoteCm,
    suoloM,
    foto: { w: fw, h: fw, rgb },
    georefEsatta: mapDsm.esatta && mapRgb.esatta,
  };
}
