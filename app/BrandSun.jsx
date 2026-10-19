"use client";

// Logo (sole stilizzato) mostrato nella barra superiore.
export default function BrandSun() {
  return (
    <svg className="brand-sun" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      <defs>
        <linearGradient id="bs-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FBBF24" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="6.2" fill="url(#bs-g)" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect key={a} x="15" y="2.6" width="2" height="4.6" rx="1" fill="#FBBF24" transform={`rotate(${a} 16 16)`} />
      ))}
    </svg>
  );
}

