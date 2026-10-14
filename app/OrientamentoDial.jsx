"use client";

import { useRef } from "react";

// Bussola interattiva per indicare l'orientamento della falda.
// Il nord è in alto (come sulla mappa satellitare): clicca (o trascina) nella
// direzione verso cui è rivolta la falda, cioè la direzione in cui "guardano"
// i pannelli. Convenzione dell'app: 0 = Sud, +90 = Ovest, −90 = Est, ±180 = Nord.
const SIZE = 200;
const C = SIZE / 2;
const R = 78;

const NOMI = ["Nord", "Nord-Est", "Est", "Sud-Est", "Sud", "Sud-Ovest", "Ovest", "Nord-Ovest"];

// gradi app (0 = Sud, +90 = Ovest) -> azimut bussola (0 = Nord, 90 = Est, orario)
function aAzimut(orient) {
  return (((180 + orient) % 360) + 360) % 360;
}
// azimut bussola -> gradi app in [-180, 180]
function daAzimut(az) {
  let o = az - 180;
  while (o > 180) o -= 360;
  while (o < -180) o += 360;
  return Math.round(o);
}
function nomeDirezione(orient) {
  return NOMI[Math.round(aAzimut(orient) / 45) % 8];
}

export default function OrientamentoDial({ value, onChange }) {
  const svgRef = useRef(null);
  const draggingRef = useRef(false);

  const n = Number(value);
  const valido = value !== "" && Number.isFinite(n) && n >= -180 && n <= 180;
  const az = valido ? aAzimut(n) : null;
  const rad = az === null ? 0 : (az * Math.PI) / 180;
  const tip = { x: C + R * Math.sin(rad), y: C - R * Math.cos(rad) };

  function impostaDaEvento(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) < 6) return; // troppo vicino al centro: direzione indefinita
    const azimut = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    onChange(String(daAzimut(azimut)));
  }

  const ticks = [];
  for (let a = 0; a < 360; a += 15) {
    const r = (a * Math.PI) / 180;
    const major = a % 90 === 0;
    const r1 = R + (major ? 0 : 3);
    const r2 = R + (major ? 9 : 7);
    ticks.push(
      <line
        key={a}
        x1={C + r1 * Math.sin(r)}
        y1={C - r1 * Math.cos(r)}
        x2={C + r2 * Math.sin(r)}
        y2={C - r2 * Math.cos(r)}
        stroke="#94a3b8"
        strokeWidth={major ? 1.6 : 1}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ touchAction: "none", cursor: "crosshair", userSelect: "none", maxWidth: "100%" }}
        role="slider"
        aria-label="Orientamento della falda"
        aria-valuemin={-180}
        aria-valuemax={180}
        aria-valuenow={valido ? n : undefined}
        tabIndex={0}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          impostaDaEvento(e);
        }}
        onPointerMove={(e) => draggingRef.current && impostaDaEvento(e)}
        onPointerUp={() => (draggingRef.current = false)}
        onPointerCancel={() => (draggingRef.current = false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            onChange(String(Math.min(180, (valido ? n : 0) + 1)));
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(String(Math.max(-180, (valido ? n : 0) - 1)));
          }
        }}
      >
        <circle cx={C} cy={C} r={R} fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
        {/* Sud (0°) evidenziato: orientamento ideale */}
        <circle cx={C} cy={C} r={R - 22} fill="none" stroke="#e2e8f0" strokeDasharray="3 3" />
        {ticks}
        {[
          ["N", C, C - R - 14],
          ["E", C + R + 15, C + 1],
          ["S", C, C + R + 17],
          ["O", C - R - 15, C + 1],
        ].map(([t, x, y]) => (
          <text key={t} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight="700" fill={t === "S" ? "#d97706" : "#475569"}>
            {t}
          </text>
        ))}
        {valido && (
          <>
            {/* settore di ±15° attorno alla direzione */}
            <path
              d={`M ${C} ${C} L ${C + (R - 4) * Math.sin(rad - 0.26)} ${C - (R - 4) * Math.cos(rad - 0.26)} A ${R - 4} ${R - 4} 0 0 1 ${C + (R - 4) * Math.sin(rad + 0.26)} ${C - (R - 4) * Math.cos(rad + 0.26)} Z`}
              fill="rgba(245,158,11,0.22)"
            />
            <line x1={C} y1={C} x2={tip.x} y2={tip.y} stroke="#d97706" strokeWidth="3" strokeLinecap="round" />
            <circle cx={tip.x} cy={tip.y} r="6" fill="#d97706" stroke="#fff" strokeWidth="2" />
          </>
        )}
        <circle cx={C} cy={C} r="4" fill="#475569" />
      </svg>
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {valido ? `${nomeDirezione(n)} · ${n > 0 ? "+" : ""}${n}°` : "Clicca sulla bussola"}
      </div>
    </div>
  );
}
