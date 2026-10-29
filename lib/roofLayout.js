// Geometria e disposizione dei moduli sul tetto (indicativa, non è un progetto
// esecutivo). Tutto in metri su un piano locale: x = Est, y = Nord.
//
// Modulo di riferimento: Trina Solar Vertex S+ TSM-NEG18R.28 (505 Wp),
// 1961 × 1134 × 30 mm, 23,5 kg (datasheet fornito dal cliente).

export const MODULO = {
  nome: "Trina Vertex S+ TSM-NEG18R.28",
  wp: 505,
  lunghezzaM: 1.961,
  larghezzaM: 1.134,
  spessoreM: 0.03,
  pesoKg: 23.5,
};

// Default dei parametri di posa
export const POSA_DEFAULT = {
  gapM: 0.02, // distanza tra moduli adiacenti (morsetti)
  margineFalda: 0.4, // distanza dai bordi su tetto a falda (colmo, gronda, bordi)
  marginePiano: 1.0, // distanza dai bordi su tetto piano (parapetto/linea vita)
  margineOstacoli: 0.5,
  tiltPianoSud: 15, // tetto piano, file rivolte a Sud
  tiltPianoEstOvest: 10, // tetto piano, configurazione Est-Ovest
  corridoioEstOvestM: 0.4, // spazio di manutenzione tra una coppia di file e la successiva
  crestaEstOvestM: 0.02,
};

const DEG = Math.PI / 180;
const R_TERRA = 6378137;

/* ---------------------------------------------------------------- proiezione */

export function lngLatToLocale(origine, [lng, lat]) {
  return {
    x: (lng - origine.lng) * DEG * R_TERRA * Math.cos(origine.lat * DEG),
    y: (lat - origine.lat) * DEG * R_TERRA,
  };
}

export function localeToLngLat(origine, { x, y }) {
  return [
    origine.lng + (x / (R_TERRA * Math.cos(origine.lat * DEG))) / DEG,
    origine.lat + (y / R_TERRA) / DEG,
  ];
}

/* ------------------------------------------------------------------ geometria */

export function areaPoligono(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function puntoInPoligono(p, poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

// Il segmento a-b attraversa l'INTERNO del rettangolo (Liang–Barsky, i contatti
// sul bordo non contano).
function segmentoInRettangolo(a, b, r) {
  const eps = 1e-6;
  const x0 = r.x0 + eps, x1 = r.x1 - eps, y0 = r.y0 + eps, y1 = r.y1 - eps;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - x0, x1 - a.x, a.y - y0, y1 - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 < t1;
}

function bordoAttraversaRettangolo(poly, r) {
  for (let i = 0; i < poly.length; i++) {
    if (segmentoInRettangolo(poly[i], poly[(i + 1) % poly.length], r)) return true;
  }
  return false;
}

// Rettangolo interamente dentro il poligono (quattro angoli dentro e nessun
// bordo che lo attraversa).
function rettangoloDentro(r, poly) {
  const angoli = [
    { x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 },
  ];
  for (const c of angoli) if (!puntoInPoligono(c, poly)) return false;
  return !bordoAttraversaRettangolo(poly, r);
}

// Rettangolo che tocca/si sovrappone a un ostacolo.
function rettangoloSuOstacolo(r, poly) {
  if (bordoAttraversaRettangolo(poly, r)) return true;
  if (puntoInPoligono({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, poly)) return true;
  for (const v of poly) {
    if (v.x > r.x0 && v.x < r.x1 && v.y > r.y0 && v.y < r.y1) return true;
  }
  return false;
}

/* -------------------------------------------------------------- azimut / assi */

function norm360(a) {
  return ((a % 360) + 360) % 360;
}
function diffAng(a, b) {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
}

// Allinea l'azimut richiesto (bussola: 0 = Nord, 90 = Est, 180 = Sud) ai lati
// del fabbricato, se lo scostamento è piccolo: nella pratica i campi
// fotovoltaici si posano paralleli ai lati dell'edificio.
export function azimutAllineatoAiLati(poligono, azimutRichiesto, sogliaGradi = 30) {
  let lMax = 0;
  const lati = [];
  for (let i = 0; i < poligono.length; i++) {
    const a = poligono[i];
    const b = poligono[(i + 1) % poligono.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    lati.push({ l, bearing: norm360(Math.atan2(dx, dy) / DEG) });
    if (l > lMax) lMax = l;
  }
  let migliore = null;
  for (const lato of lati) {
    if (lato.l < lMax * 0.3) continue;
    for (const cand of [lato.bearing + 90, lato.bearing - 90]) {
      const d = diffAng(cand, azimutRichiesto);
      if (migliore === null || d < migliore.d) migliore = { d, az: norm360(cand) };
    }
  }
  if (migliore && migliore.d <= sogliaGradi) return migliore.az;
  return norm360(azimutRichiesto);
}

/* ---------------------------------------------------------------- distanze */

// Distanza tra file inclinate per non farsi ombra a mezzogiorno solare del
// solstizio d'inverno (criterio standard): rise / tan(altezza solare).
export function interfilaM({ slantM, tiltDeg, latitudine }) {
  const elevazione = Math.max(5, 90 - Math.abs(latitudine) - 23.44); // gradi
  const rise = slantM * Math.sin(tiltDeg * DEG);
  return rise / Math.tan(elevazione * DEG);
}

/* ------------------------------------------------------------------- layout */

/**
 * Disposizione dei moduli in UNA area.
 * @param {object} p
 *  poligono: [{x,y}] area utile (metri locali)
 *  ostacoli: [[{x,y}]] zone da escludere (lucernari, camini, impianti…)
 *  tipo: "falda" | "piano"
 *  azimutFaccia: direzione verso cui "guardano" i moduli, gradi bussola
 *                (falda: direzione di discesa della falda)
 *  tiltDeg: falda → pendenza della falda; piano → inclinazione dei moduli
 *  disposizione: solo piano: "sud" (file rivolte alla direzione data) | "estovest"
 *  allineaAiLati: allinea azimut ai lati dell'edificio (default true)
 *  orientamentoModulo: "auto" | "verticale" | "orizzontale"
 *  margineM, latitudine
 */
export function calcolaLayoutArea(p) {
  const {
    poligono,
    ostacoli = [],
    tipo,
    tiltDeg,
    disposizione = "sud",
    allineaAiLati = true,
    orientamentoModulo = "auto",
    latitudine,
  } = p;
  // dimensioni del modulo: quello scelto dall'utente, altrimenti il modulo di riferimento
  const M = { ...MODULO, ...(p.modulo || {}) };
  const riempiResti = p.riempiResti !== false;
  const gap = p.gapM ?? POSA_DEFAULT.gapM;
  const margine = p.margineM ?? (tipo === "piano" ? POSA_DEFAULT.marginePiano : POSA_DEFAULT.margineFalda);
  const margineOst = p.margineOstacoliM ?? POSA_DEFAULT.margineOstacoli;

  const areaPiantaM2 = Math.max(0, areaPoligono(poligono));
  const beta = Math.max(0, Math.min(90, tiltDeg)) * DEG;

  const azRichiesto = norm360(p.azimutFaccia);
  const azimutEffettivo = allineaAiLati
    ? azimutAllineatoAiLati(poligono, azRichiesto, tipo === "piano" ? 30 : 20)
    : azRichiesto;

  // Sistema (u, v): v lungo la direzione di faccia, u lungo le file (u = Est se v = Sud).
  const f = { x: Math.sin(azimutEffettivo * DEG), y: Math.cos(azimutEffettivo * DEG) };
  const u = { x: -f.y, y: f.x };
  const aUV = (pt) => ({ x: pt.x * u.x + pt.y * u.y, y: pt.x * f.x + pt.y * f.y });
  const daUV = (pu, pv) => ({ x: pu * u.x + pv * f.x, y: pu * u.y + pv * f.y });

  const poly = poligono.map(aUV);
  const ost = ostacoli.map((o) => o.map(aUV));

  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const q of poly) {
    umin = Math.min(umin, q.x); umax = Math.max(umax, q.x);
    vmin = Math.min(vmin, q.y); vmax = Math.max(vmax, q.y);
  }

  const orientazioni =
    orientamentoModulo === "verticale" ? ["verticale"]
    : orientamentoModulo === "orizzontale" ? ["orizzontale"]
    : ["verticale", "orizzontale"];

  let migliore = null;

  for (const orient of orientazioni) {
    const portrait = orient === "verticale";
    const du = portrait ? M.larghezzaM : M.lunghezzaM; // lungo la fila
    const slant = portrait ? M.lunghezzaM : M.larghezzaM; // lungo la pendenza
    const profPianta = slant * Math.cos(beta);

    let passoV;
    let unita; // file per "unità" lungo v
    if (tipo === "piano" && disposizione === "estovest") {
      passoV = 2 * profPianta + POSA_DEFAULT.crestaEstOvestM + POSA_DEFAULT.corridoioEstOvestM;
      unita = 2;
    } else if (tipo === "piano") {
      passoV = profPianta + interfilaM({ slantM: slant, tiltDeg, latitudine });
      unita = 1;
    } else {
      passoV = profPianta + gap;
      unita = 1;
    }
    const passoU = du + gap;

    // si prova la griglia con più sfasamenti e si tiene quella che contiene più moduli
    const offsetsU = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
    const offsetsV = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];

    for (const ou of offsetsU) {
      for (const ov of offsetsV) {
        const u0 = umin + margine + ou * passoU;
        const v0 = vmin + margine + ov * passoV;
        const lista = [];
        const nU = Math.ceil((umax - umin) / passoU) + 1;
        const nV = Math.ceil((vmax - vmin) / passoV) + 1;
        for (let j = 0; j < nV; j++) {
          // file della "unità" j (1 per falda/sud, 2 per est-ovest)
          const righe =
            unita === 2
              ? [
                  { v: v0 + j * passoV, verso: -1 }, // fila posteriore, rivolta all'opposto
                  { v: v0 + j * passoV + profPianta + POSA_DEFAULT.crestaEstOvestM, verso: +1 },
                ]
              : [{ v: v0 + j * passoV, verso: +1 }];
          for (const riga of righe) {
            for (let i = 0; i < nU; i++) {
              const ux0 = u0 + i * passoU;
              const rect = { x0: ux0, x1: ux0 + du, y0: riga.v, y1: riga.v + profPianta };
              const m = margine - 1e-3; // tolleranza: un modulo che tocca esattamente il margine è valido
              const esteso = { x0: rect.x0 - m, x1: rect.x1 + m, y0: rect.y0 - m, y1: rect.y1 + m };
              // il margine vale dai bordi del poligono; tra moduli non serve:
              // si testa quindi il rettangolo esteso solo contro il poligono
              if (!rettangoloDentro(esteso, poly)) continue;
              const mo = margineOst - 1e-3;
              const estesoOst = { x0: rect.x0 - mo, x1: rect.x1 + mo, y0: rect.y0 - mo, y1: rect.y1 + mo };
              let libero = true;
              for (const o of ost) {
                if (rettangoloSuOstacolo(estesoOst, o)) { libero = false; break; }
              }
              if (!libero) continue;
              lista.push({ rect, riga: j, verso: riga.verso, colonna: i, v: riga.v });
            }
          }
        }
        if (!migliore || lista.length > migliore.lista.length) {
          migliore = { lista, portrait, du, slant, profPianta, passoV, passoU };
        }
      }
    }
  }

  const sel = migliore || { lista: [], portrait: true, du: M.larghezzaM, slant: M.lunghezzaM, profPianta: 0 };

  // Moduli "di riempimento": negli spazi che la griglia lascia liberi (strisce lungo i bordi,
  // attorno agli ostacoli) si prova a posare moduli ruotati di 90°, così se ne mettono il più
  // possibile. Solo sulle falde, dove i moduli seguono il manto e non servono interfile.
  const extra = [];
  if (tipo === "falda" && riempiResti && orientamentoModulo === "auto" && sel.lista.length) {
    const portraitB = !sel.portrait;
    const duB = portraitB ? M.larghezzaM : M.lunghezzaM;
    const profB = (portraitB ? M.lunghezzaM : M.larghezzaM) * Math.cos(beta);
    const m = margine - 1e-3;
    const mo = margineOst - 1e-3;
    const step = Math.max(0.1, Math.max(umax - umin, vmax - vmin) / 220);
    const occupati = sel.lista.map((c) => c.rect);
    const liberoDa = (r) => {
      for (const q of occupati) {
        if (r.x0 < q.x1 + gap - 1e-6 && r.x1 > q.x0 - gap + 1e-6 && r.y0 < q.y1 + gap - 1e-6 && r.y1 > q.y0 - gap + 1e-6) return false;
      }
      return true;
    };
    for (let v = vmin + margine; v + profB <= vmax - margine + 1e-6; v += step) {
      for (let uu = umin + margine; uu + duB <= umax - margine + 1e-6; ) {
        const rect = { x0: uu, x1: uu + duB, y0: v, y1: v + profB };
        let ok = liberoDa(rect) && rettangoloDentro({ x0: rect.x0 - m, x1: rect.x1 + m, y0: rect.y0 - m, y1: rect.y1 + m }, poly);
        if (ok) {
          const eo = { x0: rect.x0 - mo, x1: rect.x1 + mo, y0: rect.y0 - mo, y1: rect.y1 + mo };
          for (const o of ost) if (rettangoloSuOstacolo(eo, o)) { ok = false; break; }
        }
        if (ok) {
          extra.push({ rect, riga: -1, verso: 1, colonna: extra.length, v, portrait: portraitB, du: duB, slant: portraitB ? M.lunghezzaM : M.larghezzaM, profPianta: profB });
          occupati.push(rect);
          uu += duB + gap;
        } else {
          uu += step;
        }
      }
    }
  }

  // Ordine di riempimento: dalle file frontali (verso la faccia) a quelle
  // posteriori, poi da sinistra a destra.
  const pannelli = [...sel.lista, ...extra]
    .map((c) => {
      const cu = (c.rect.x0 + c.rect.x1) / 2;
      const cv = (c.rect.y0 + c.rect.y1) / 2;
      const centro = daUV(cu, cv);
      const az = c.verso === 1 ? azimutEffettivo : norm360(azimutEffettivo + 180);
      return {
        cx: centro.x,
        cy: centro.y,
        du: c.du ?? sel.du,
        slant: c.slant ?? sel.slant,
        profPianta: c.profPianta ?? sel.profPianta,
        az,
        tilt: tiltDeg,
        portrait: c.portrait ?? sel.portrait,
        riga: c.riga,
        verso: c.verso,
        v: c.v,
        colonna: c.colonna,
        // angoli del rettangolo in pianta (metri locali), per il disegno 2D
        angoli: [
          daUV(c.rect.x0, c.rect.y0), daUV(c.rect.x1, c.rect.y0),
          daUV(c.rect.x1, c.rect.y1), daUV(c.rect.x0, c.rect.y1),
        ],
      };
    })
    .sort((a, b) => b.v - a.v || a.colonna - b.colonna);

  const ostacoliArea = ostacoli.reduce((s, o) => s + areaPoligono(o), 0);
  const areaNettaPiantaM2 = Math.max(0, areaPiantaM2 - ostacoliArea);

  return {
    pannelli,
    capacita: pannelli.length,
    azimutRichiesto: azRichiesto,
    azimutEffettivo,
    orientamentoModulo: sel.portrait ? "verticale" : "orizzontale",
    moduliRiempimento: extra.length,
    areaPiantaM2,
    areaNettaPiantaM2,
    areaRealeM2: tipo === "falda" ? areaNettaPiantaM2 / Math.max(0.05, Math.cos(beta)) : areaNettaPiantaM2,
    interfilaM: tipo === "piano" && disposizione !== "estovest" ? interfilaM({ slantM: sel.slant, tiltDeg, latitudine }) : null,
    passoFileM: sel.passoV ?? null,
  };
}

/**
 * Distribuisce i moduli richiesti tra le aree.
 *  - "sequenziale": la prima area (nell'ordine dato) si riempie fino alla sua
 *    capacità, la seconda prende quel che resta, e così via;
 *  - "uniforme": stessa quantità di moduli su ogni area (metà e metà con due
 *    aree), limitata dalla capacità di ciascuna: se un'area si riempie, il
 *    resto va alle altre.
 * @returns {{usati: number[], posizionati, capacitaTotale, mancanti, kwp, kwpMassimi}}
 */
export function distribuisciPannelli(aree, nRichiesti, modo = "sequenziale", wp = MODULO.wp) {
  const richiesti = Math.max(0, Math.round(nRichiesti));
  const usati = new Array(aree.length).fill(0);
  if (modo === "uniforme") {
    let resto = richiesti;
    let attive = aree.map((_, i) => i).filter((i) => aree[i].capacita > 0);
    while (resto > 0 && attive.length) {
      const quota = Math.floor(resto / attive.length);
      const extra = resto - quota * attive.length;
      const prossime = [];
      let assegnato = 0;
      attive.forEach((idx, k) => {
        const voglio = quota + (k < extra ? 1 : 0);
        const posso = aree[idx].capacita - usati[idx];
        const dato = Math.min(voglio, posso);
        usati[idx] += dato;
        assegnato += dato;
        if (usati[idx] < aree[idx].capacita) prossime.push(idx);
      });
      resto -= assegnato;
      if (assegnato === 0) break;
      attive = prossime;
    }
  } else {
    let resto = richiesti;
    aree.forEach((a, i) => {
      const n = Math.min(resto, a.capacita);
      usati[i] = n;
      resto -= n;
    });
  }
  const capacitaTotale = aree.reduce((s, a) => s + a.capacita, 0);
  const posizionati = usati.reduce((s, n) => s + n, 0);
  return {
    posizionati,
    usati,
    capacitaTotale,
    mancanti: Math.max(0, richiesti - posizionati),
    kwp: Math.round(((posizionati * wp) / 1000) * 100) / 100,
    kwpMassimi: Math.round(((capacitaTotale * wp) / 1000) * 100) / 100,
  };
}
