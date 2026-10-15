"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// Vista 3D indicativa del tetto con i moduli (Three.js).
//
// Riferimenti: coordinate locali in metri, x = Est, y = Nord. In Three.js:
// X = Est, Y = alto, Z = −Nord (si guarda da Sud verso Nord con Z negativa
// "in profondità"). La foto satellitare è stesa sul terreno e sulle coperture
// (vista dall'alto coincide con la foto reale); i volumi degli edifici hanno
// l'altezza indicata dall'utente — non è un rilievo, quindi pareti e quote
// sono indicative.
//
// props:
//  scena: {
//    bounds: { xmin, xmax, ymin, ymax }   // estensione (m) coperta dalla foto
//    texture: dataURL della foto (solo satellite, senza overlay)
//    altezzaM: quota del tetto/gronda
//    aree: [{ tipo, poligono, ostacoli, pendenzaDeg, azimutDiscesa }]
//    pannelli: [{ cx, cy, az, tilt, portrait, areaIdx }]
//  }
// ref: { setVista(nome), cattura(nome, larghezza, altezza) -> dataURL JPEG }

const DEG = Math.PI / 180;
const MODULO = { l: 1.961, w: 1.134, t: 0.03 };

function texturaModulo(THREE, portrait) {
  const W = portrait ? 340 : 588;
  const H = portrait ? 588 : 340;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#0b1730";
  g.fillRect(0, 0, W, H);
  // 108 mezze celle: 6 x 18 (verticale)
  const cols = portrait ? 6 : 18;
  const rows = portrait ? 18 : 6;
  const pad = 10;
  g.strokeStyle = "rgba(160,185,230,0.55)";
  g.lineWidth = 1;
  for (let i = 0; i <= cols; i++) {
    const x = pad + ((W - 2 * pad) * i) / cols;
    g.beginPath(); g.moveTo(x, pad); g.lineTo(x, H - pad); g.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    const y = pad + ((H - 2 * pad) * j) / rows;
    g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
  }
  g.strokeStyle = "#1d2433";
  g.lineWidth = 8;
  g.strokeRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const RoofScene3D = forwardRef(function RoofScene3D({ scena, className }, ref) {
  const containerRef = useRef(null);
  const stateRef = useRef(null);

  useImperativeHandle(ref, () => ({
    setVista(nome) {
      const s = stateRef.current;
      if (s) s.setVista(nome);
    },
    cattura(nome, larghezza = 1400, altezza = 875) {
      const s = stateRef.current;
      return s ? s.cattura(nome, larghezza, altezza) : null;
    },
  }));

  useEffect(() => {
    let annullato = false;
    let pulizia = () => {};

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (annullato || !containerRef.current || !scena) return;

      const container = containerRef.current;
      const { bounds, aree, pannelli, altezzaM } = scena;
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
      scene.background = new THREE.Color("#cfd8e3");

      const camera = new THREE.PerspectiveCamera(38, 1.6, 0.5, 5000);

      // centro e raggio delle aree (per camera e ombre)
      let sx = 0, sy = 0, n = 0;
      let rMax = 10;
      for (const a of aree) for (const p of a.poligono) { sx += p.x; sy += p.y; n++; }
      const ac = n ? { x: sx / n, y: sy / n } : { x: cx0, y: cy0 };
      for (const a of aree) for (const p of a.poligono) rMax = Math.max(rMax, Math.hypot(p.x - ac.x, p.y - ac.y));
      const raggio = rMax;

      // luci
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a94a3, 0.75));
      const sole = new THREE.DirectionalLight(0xffffff, 1.9);
      const azSole = 150 * DEG; // sud-est, mattina inoltrata
      const elSole = 42 * DEG;
      sole.position.set(
        ac.x + Math.sin(azSole) * Math.cos(elSole) * raggio * 3,
        Math.sin(elSole) * raggio * 3,
        -(ac.y + Math.cos(azSole) * Math.cos(elSole) * raggio * 3)
      );
      sole.target.position.set(ac.x, 0, -ac.y);
      sole.castShadow = true;
      sole.shadow.mapSize.set(2048, 2048);
      const sc = sole.shadow.camera;
      sc.left = -raggio * 1.6; sc.right = raggio * 1.6; sc.top = raggio * 1.6; sc.bottom = -raggio * 1.6;
      sc.near = 1; sc.far = raggio * 9;
      sole.shadow.bias = -0.0004;
      scene.add(sole, sole.target);

      // texture satellitare
      const texSat = await new Promise((resolve) => {
        if (!scena.texture) return resolve(null);
        new THREE.TextureLoader().load(scena.texture, (t) => resolve(t), undefined, () => resolve(null));
      });
      if (annullato) return;
      if (texSat) {
        texSat.colorSpace = THREE.SRGBColorSpace;
        texSat.anisotropy = 8;
      }
      const matTerreno = new THREE.MeshStandardMaterial({ map: texSat || null, color: texSat ? 0xffffff : 0xb9c3a8, roughness: 1, metalness: 0 });

      // terreno
      const terreno = new THREE.Mesh(new THREE.PlaneGeometry(Wm, Hm), matTerreno);
      terreno.rotation.x = -Math.PI / 2;
      terreno.position.set(cx0, 0, -cy0);
      terreno.receiveShadow = true;
      scene.add(terreno);

      const uvDi = (x, y) => [(x - bounds.xmin) / Wm, (y - bounds.ymin) / Hm];

      // altezza della copertura in un punto (m)
      const quota = (area, x, y) => {
        if (area.tipo !== "falda") return altezzaM;
        const f = { x: Math.sin(area.azimutDiscesa * DEG), y: Math.cos(area.azimutDiscesa * DEG) };
        let sMax = -Infinity;
        for (const p of area.poligono) sMax = Math.max(sMax, p.x * f.x + p.y * f.y);
        const s = x * f.x + y * f.y;
        return altezzaM + Math.tan(Math.max(0, Math.min(80, area.pendenzaDeg)) * DEG) * (sMax - s);
      };

      const matPareti = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.9, side: THREE.DoubleSide });
      const matOstacolo = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8 });

      function prisma(poligono, hBase, hTop, matTop, matLati, uvDaFoto) {
        // facce superiori triangolate
        const contorno = poligono.map((p) => new THREE.Vector2(p.x, p.y));
        const tri = THREE.ShapeUtils.triangulateShape(contorno, []);
        const pos = [];
        const uv = [];
        for (const t of tri) {
          for (const k of t) {
            const p = poligono[k];
            pos.push(p.x, hTop(p.x, p.y), -p.y);
            const [u, v] = uvDaFoto(p.x, p.y);
            uv.push(u, v);
          }
        }
        const gTop = new THREE.BufferGeometry();
        gTop.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        gTop.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        gTop.computeVertexNormals();
        const top = new THREE.Mesh(gTop, matTop);
        top.castShadow = true;
        top.receiveShadow = true;

        // pareti
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
        const lati = new THREE.Mesh(gL, matLati);
        lati.castShadow = true;
        lati.receiveShadow = true;
        const g = new THREE.Group();
        g.add(top, lati);
        return g;
      }

      const matTetto = new THREE.MeshStandardMaterial({ map: texSat || null, color: texSat ? 0xffffff : 0x9a8f86, roughness: 0.95, metalness: 0 });
      aree.forEach((area) => {
        scene.add(prisma(area.poligono, () => 0, (x, y) => quota(area, x, y), matTetto, matPareti, uvDi));
        for (const o of area.ostacoli || []) {
          scene.add(
            prisma(o, (x, y) => quota(area, x, y), (x, y) => quota(area, x, y) + 1.0, matOstacolo, matOstacolo, () => [0, 0])
          );
        }
      });

      // moduli (istanze)
      const gruppi = { true: [], false: [] };
      for (const p of pannelli) gruppi[p.portrait ? "true" : "false"].push(p);
      const dummy = new THREE.Object3D();
      dummy.rotation.order = "YXZ";
      for (const portrait of [true, false]) {
        const lista = gruppi[portrait ? "true" : "false"];
        if (!lista.length) continue;
        const w = portrait ? MODULO.w : MODULO.l; // lungo la fila (x locale)
        const s = portrait ? MODULO.l : MODULO.w; // lungo la pendenza (z locale)
        const geo = new THREE.BoxGeometry(w, MODULO.t, s);
        // texture solo sulla faccia superiore (indice 2 = +Y)
        const mats = [0, 1, 2, 3, 4, 5].map((i) =>
          i === 2
            ? new THREE.MeshStandardMaterial({ map: texturaModulo(THREE, portrait), metalness: 0.35, roughness: 0.32 })
            : new THREE.MeshStandardMaterial({ color: 0x1d2433, metalness: 0.5, roughness: 0.5 })
        );
        const mesh = new THREE.InstancedMesh(geo, mats, lista.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        lista.forEach((p, i) => {
          const area = aree[p.areaIdx] || aree[0];
          const beta = p.tilt * DEG;
          const base = quota(area, p.cx, p.cy);
          // piano: file inclinate sollevate da terra (zavorre); falda: sul manto
          const rialzo = area.tipo === "falda" ? 0.12 : 0.15 + (s / 2) * Math.sin(beta);
          dummy.position.set(p.cx, base + rialzo, -p.cy);
          // pendenza effettiva del modulo: sulla falda = pendenza falda (p.tilt già coincide)
          dummy.rotation.set(beta, Math.PI - p.az * DEG, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
      }

      // camera + controlli
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
      controls.target.set(ac.x, altezzaM * 0.5, -ac.y);

      const dist = Math.max(30, raggio * 3.2);
      const viste = {
        alto: () => ({ pos: [ac.x, dist * 1.25, -ac.y + 0.001], up: [0, 0, -1] }),
        sud_est: () => ({ pos: [ac.x + dist * 0.55, dist * 0.62, -ac.y + dist * 0.8], up: [0, 1, 0] }),
        sud_ovest: () => ({ pos: [ac.x - dist * 0.55, dist * 0.62, -ac.y + dist * 0.8], up: [0, 1, 0] }),
        nord_est: () => ({ pos: [ac.x + dist * 0.55, dist * 0.62, -ac.y - dist * 0.8], up: [0, 1, 0] }),
      };

      const render = () => renderer.render(scene, camera);
      controls.addEventListener("change", render);

      function setVista(nome) {
        const v = (viste[nome] || viste.sud_est)();
        camera.up.set(...v.up);
        camera.position.set(...v.pos);
        controls.target.set(ac.x, nome === "alto" ? 0 : altezzaM * 0.5, -ac.y);
        controls.update();
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
      ridimensiona();
      setVista("sud_est");

      function cattura(nome, larghezza, altezza) {
        if (nome) setVista(nome);
        const wPrima = renderer.domElement.width;
        const hPrima = renderer.domElement.height;
        const pr = renderer.getPixelRatio();
        renderer.setPixelRatio(1);
        renderer.setSize(larghezza, altezza, false);
        camera.aspect = larghezza / altezza;
        camera.updateProjectionMatrix();
        render();
        const url = renderer.domElement.toDataURL("image/jpeg", 0.88);
        renderer.setPixelRatio(pr);
        renderer.setSize(wPrima / pr, hPrima / pr, false);
        ridimensiona();
        return url;
      }

      stateRef.current = { setVista, cattura };

      pulizia = () => {
        ro.disconnect();
        controls.dispose();
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose(); });
        });
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

  return <div ref={containerRef} className={className} style={{ width: "100%", aspectRatio: "8 / 5", background: "#cfd8e3", borderRadius: 8, overflow: "hidden" }} />;
});

export default RoofScene3D;
