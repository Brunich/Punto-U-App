import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────
//  SUPABASE VIA ANTHROPIC API + MCP  (proxy seguro para artifacts)
// ─────────────────────────────────────────────────────────────────
const SB_PROJECT = "sljewcttnawiknkgxvsi";

function esc(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v.toString();
  if (typeof v === "number") return v.toString();
  if (Array.isArray(v))
    return `ARRAY[${v.map(x => `'${String(x).replace(/'/g, "''")}'`).join(",")}]::text[]`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function pgrToSQL(table, qs = "") {
  let conds = [], order = "";
  if (!qs) return `SELECT * FROM ${table} ORDER BY created_at DESC`;
  for (const part of qs.split("&")) {
    const ei = part.indexOf("=");
    if (ei === -1) continue;
    const k = part.slice(0, ei), v = part.slice(ei + 1);
    if (k === "order") {
      const [c, d] = v.split(".");
      order = `ORDER BY ${c} ${(d || "desc").toUpperCase()}`;
    } else if (k === "or") {
      const groups = v.slice(1, -1).match(/and\([^)]+\)/g) || [];
      const sql = groups.map(g => {
        const cs = g.slice(4, -1).split(",").map(c => {
          const d1 = c.indexOf("."), d2 = c.indexOf(".", d1 + 1);
          const col = c.slice(0, d1), op = c.slice(d1 + 1, d2), val = c.slice(d2 + 1);
          return `${col} ${op === "neq" ? "!=" : "="} ${esc(val)}`;
        });
        return `(${cs.join(" AND ")})`;
      });
      conds.push(`(${sql.join(" OR ")})`);
    } else if (v.startsWith("eq."))  conds.push(`${k} = ${esc(v.slice(3))}`);
      else if (v.startsWith("neq.")) conds.push(`${k} != ${esc(v.slice(4))}`);
      else if (v.startsWith("in."))  {
        const items = v.slice(4, -1).split(",").map(x => esc(x)).join(",");
        conds.push(`${k} IN (${items})`);
      }
  }
  const w = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return `SELECT * FROM ${table} ${w} ${order || "ORDER BY created_at DESC"}`;
}

function extractRows(data) {
  for (const b of (data.content || [])) {
    if (b.type === "mcp_tool_result") {
      const t = b.content?.[0]?.text || "";
      try { const p = JSON.parse(t); if (Array.isArray(p)) return p; } catch {}
      const m = t.match(/\[[\s\S]*\]/);
      if (m) try { return JSON.parse(m[0]); } catch {}
    }
  }
  for (const b of (data.content || [])) {
    if (b.type === "text" && b.text) {
      const c = b.text.replace(/```json|```/g, "").trim();
      try { const p = JSON.parse(c); if (Array.isArray(p)) return p; } catch {}
      const m = c.match(/\[[\s\S]*\]/);
      if (m) try { return JSON.parse(m[0]); } catch {}
    }
  }
  return [];
}

async function runSQL(sql) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4000,
        system: `Execute the given SQL using execute_sql on project_id "${SB_PROJECT}". Then reply with ONLY the raw JSON array of row objects. No markdown, no backticks, no explanation. If empty, reply [].`,
        messages: [{ role: "user", content: sql }],
        mcp_servers: [{ type: "url", url: "https://mcp.supabase.com/mcp", name: "supabase" }],
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return extractRows(await r.json());
  } catch (e) {
    console.error("runSQL:", e, sql);
    throw new Error("SIN_CONEXION");
  }
}

const db = {
  get: (t, qs = "") => runSQL(pgrToSQL(t, qs)),
  insert: (t, d) => {
    const ks = Object.keys(d), vs = Object.values(d).map(esc);
    return runSQL(`INSERT INTO ${t} (${ks.join(",")}) VALUES (${vs.join(",")}) RETURNING *`);
  },
  patch: (t, id, d) => {
    const sets = Object.entries(d).map(([k, v]) => `${k} = ${esc(v)}`);
    return runSQL(`UPDATE ${t} SET ${sets.join(", ")} WHERE id = '${id}' RETURNING *`);
  },
};

// ── No realtime en artifacts — datos se cargan con acciones del usuario ──
function subscribe(_table, _cb) {
  return () => {};
}

// ─────────────────────────────────────────────────────────────────
//  DATOS
// ─────────────────────────────────────────────────────────────────
const FACULTADES = [
  { id: "fime",       label: "FIME",            lat: 25.7281, lng: -100.3108 },
  { id: "fcfm",       label: "FCFM",            lat: 25.7268, lng: -100.3131 },
  { id: "farq",       label: "Arquitectura",    lat: 25.7249, lng: -100.3143 },
  { id: "fdr",        label: "Derecho",         lat: 25.7242, lng: -100.3163 },
  { id: "facpya",     label: "FACPyA",          lat: 25.7230, lng: -100.3172 },
  { id: "ffyl",       label: "Filosofía",       lat: 25.7218, lng: -100.3157 },
  { id: "fic",        label: "Ing. Civil",      lat: 25.7261, lng: -100.3110 },
  { id: "fq",         label: "Fac. Química",    lat: 25.7275, lng: -100.3092 },
  { id: "fcb",        label: "Biológicas",      lat: 25.7236, lng: -100.3095 },
  { id: "biblioteca", label: "Bib. Alfonsina",  lat: 25.7244, lng: -100.3133 },
  { id: "rectoria",   label: "Rectoría",        lat: 25.7255, lng: -100.3128 },
  { id: "estadio",    label: "Estadio Univ.",   lat: 25.7218, lng: -100.3185 },
  { id: "cafeteria",  label: "Cafetería",       lat: 25.7250, lng: -100.3120 },
  { id: "deportes",   label: "Org. Deportiva",  lat: 25.7242, lng: -100.3115 },
  { id: "medicina",   label: "Medicina",        lat: 25.7233, lng: -100.3107 },
  { id: "psicologia", label: "Psicología",      lat: 25.7226, lng: -100.3143 },
];

const RW = {
  money: { icon: "💰", color: "#34D399", glow: "rgba(52,211,153,.25)", label: v => `$${v} MXN` },
  time:  { icon: "⏱", color: "#FBBF24", glow: "rgba(251,191,36,.25)",  label: v => `${v} hrs` },
  study: { icon: "📚", color: "#A78BFA", glow: "rgba(167,139,250,.25)", label: v => `${v}h estudio` },
};
const rw = t => RW[t] || RW.money;

// ─────────────────────────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────────────────────────
const ago = ts => {
  if (!ts) return "";
  const s = (Date.now() - new Date(ts)) / 1000;
  if (s < 60) return "ahora";
  if (s < 3600) return `${~~(s / 60)}m`;
  if (s < 86400) return `${~~(s / 3600)}h`;
  return `${~~(s / 86400)}d`;
};
const inits = (n = "") => n.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
const pal   = (n = "") => `hsl(${n.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360},45%,45%)`;

// ─────────────────────────────────────────────────────────────────
//  DESIGN TOKENS  — estética "editorial universitario nocturno"
// ─────────────────────────────────────────────────────────────────
const T = {
  // backgrounds
  bg0:   "#060810",   // deepest
  bg1:   "#0B0F1A",   // page bg
  bg2:   "#101622",   // card bg
  bg3:   "#151C2E",   // raised card
  // borders
  ln:    "#1C2640",
  ln2:   "#243050",
  // text
  tx1:   "#EEF2FF",
  tx2:   "#8899BB",
  tx3:   "#4A5C7A",
  // accent
  a1:    "#4F8EF7",
  a2:    "#2563EB",
  aG:    "rgba(79,142,247,.18)",
  // status
  ok:    "#34D399",
  warn:  "#FBBF24",
  err:   "#F87171",
  // special
  gold:  "#FBBF24",
};

// ─────────────────────────────────────────────────────────────────
//  PRIMITIVES
// ─────────────────────────────────────────────────────────────────
const Av = ({ name = "?", size = 40, color, sx = {} }) => (
  <div style={{
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    background: `linear-gradient(135deg, ${color || pal(name)}, ${color || pal(name)}88)`,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: Math.max(9, size * 0.33), fontWeight: 800, color: "#fff",
    letterSpacing: -0.3, border: `1.5px solid rgba(255,255,255,.08)`, ...sx,
  }}>{inits(name)}</div>
);

const StarsRow = ({ v = 0, size = 12, editable = false, onChange }) => (
  <span style={{ display: "inline-flex", gap: 1 }}>
    {[1,2,3,4,5].map(s => (
      <span key={s} onClick={() => editable && onChange?.(s)}
        style={{ fontSize: size, cursor: editable ? "pointer" : "default",
          color: s <= Math.round(v) ? T.gold : T.ln2, transition: "color .12s" }}>★</span>
    ))}
  </span>
);

const Chip = ({ label, icon, color = T.a1 }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
    background: `${color}18`, border: `1px solid ${color}35`,
    borderRadius: 99, padding: "3px 10px", fontSize: 10.5, fontWeight: 600, color }}>
    {icon && <span>{icon}</span>}{label}
  </span>
);

const Toggle = ({ on, onClick, label }) => (
  <div onClick={onClick} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "2px 0" }}>
    <span style={{ fontSize: 13, color: T.tx1 }}>{label}</span>
    <div style={{ width: 42, height: 23, borderRadius: 12,
      background: on ? T.a1 : T.ln, position: "relative", transition: "background .2s", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 3, left: on ? 22 : 3,
        width: 17, height: 17, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
    </div>
  </div>
);

function FacPill({ id, label, active, cnt, onClick }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0, background: active ? `${T.a1}18` : T.bg3,
      border: `1px solid ${active ? T.a1 : T.ln}`,
      borderRadius: 8, padding: "4px 9px", cursor: "pointer",
      fontFamily: "inherit", transition: "all .14s",
      display: "flex", alignItems: "center", gap: 5,
    }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: active ? T.a1 : T.tx2 }}>{label}</span>
      {cnt > 0 && <span style={{ fontSize: 9, background: T.a1, color: "#fff",
        borderRadius: 99, padding: "1px 5px", fontWeight: 800 }}>{cnt}</span>}
    </button>
  );
}

const Field = ({ label, req, hint, ...props }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    {label && <label style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8,
      color: req ? T.a1 : T.tx3, textTransform: "uppercase" }}>{label}{req && " *"}</label>}
    {hint && <div style={{ fontSize: 10, color: T.tx3, marginTop: -2 }}>{hint}</div>}
    <input {...props} style={{
      background: T.bg0, border: `1px solid ${T.ln}`, borderRadius: 10,
      padding: "10px 13px", color: T.tx1, fontSize: 13, width: "100%",
      fontFamily: "inherit", outline: "none", transition: "border-color .15s", ...props.style,
    }} onFocus={e => e.target.style.borderColor = T.a1}
       onBlur={e => e.target.style.borderColor = T.ln} />
  </div>
);

const TArea = ({ label, ...props }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    {label && <label style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color: T.tx3, textTransform: "uppercase" }}>{label}</label>}
    <textarea {...props} style={{
      background: T.bg0, border: `1px solid ${T.ln}`, borderRadius: 10,
      padding: "10px 13px", color: T.tx1, fontSize: 13, width: "100%",
      fontFamily: "inherit", outline: "none", resize: "none", transition: "border-color .15s", ...props.style,
    }} onFocus={e => e.target.style.borderColor = T.a1}
       onBlur={e => e.target.style.borderColor = T.ln} />
  </div>
);

const Btn = ({ children, onClick, disabled, v = "fill", sz = "md", sx = {} }) => {
  const sizes = { sm: "7px 13px", md: "11px 18px", lg: "13px 22px" };
  const vars = {
    fill:    { background: disabled ? T.ln : `linear-gradient(135deg,${T.a1},${T.a2})`, color: disabled ? T.tx3 : "#fff", boxShadow: disabled ? "none" : `0 4px 20px ${T.aG}`, border: "none" },
    ghost:   { background: "transparent", color: T.tx2, border: `1px solid ${T.ln}` },
    success: { background: `${T.ok}18`, color: T.ok, border: `1px solid ${T.ok}35` },
    danger:  { background: `${T.err}18`, color: T.err, border: `1px solid ${T.err}35` },
  };
  return (
    <button disabled={disabled} onClick={onClick} className="tap" style={{
      ...vars[v], borderRadius: 11, padding: sizes[sz], fontSize: sz === "sm" ? 12 : sz === "lg" ? 14 : 13,
      fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      transition: "all .15s", ...sx,
    }}>{children}</button>
  );
};

const BackBtn = ({ onClick }) => (
  <button onClick={onClick} className="tap" style={{
    width: 36, height: 36, borderRadius: 10, background: T.bg2,
    border: `1px solid ${T.ln}`, color: T.tx1, fontSize: 15, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  }}>←</button>
);

const Spin = ({ n = 22 }) => (
  <div style={{ display: "flex", justifyContent: "center", padding: 28 }}>
    <div style={{ width: n, height: n, border: `2.5px solid ${T.ln}`,
      borderTopColor: T.a1, borderRadius: "50%", animation: "spin .7s linear infinite" }} />
  </div>
);

const Divider = ({ my = 2 }) => <div style={{ height: 1, background: T.ln, margin: `${my}px 0` }} />;

// ── Connection error overlay ──────────────────────────────────────
function ConnError({ onRetry }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "30px 24px", gap: 14, textAlign: "center" }}>
      <div style={{ fontSize: 44 }}>📡</div>
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: T.tx1 }}>Sin conexión</div>
      <div style={{ fontSize: 12, color: T.tx2, lineHeight: 1.7, maxWidth: 280 }}>
        No se puede conectar con la base de datos.<br/>
        <b style={{ color: T.warn }}>Solución:</b><br/>
        Ve a <b>supabase.com → Settings → API</b> y copia la llave <b>"anon public"</b>{" "}
        (empieza con <code style={{ color: T.a1 }}>eyJhbGci...</code>), luego pégala aquí en el chat.
      </div>
      <Btn onClick={onRetry} sx={{ marginTop: 6 }}>🔄 Reintentar</Btn>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  MAPA LEAFLET
// ─────────────────────────────────────────────────────────────────
function LeafletMap({ misiones, onBuilding, onQuest }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const mksRef = useRef({});
  const [ready, setReady] = useState(!!window.L);

  useEffect(() => {
    if (window.L) { setReady(true); return; }
    if (!document.getElementById("lf-css")) {
      const l = document.createElement("link");
      l.id = "lf-css"; l.rel = "stylesheet";
      l.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
      document.head.appendChild(l);
    }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    if (!ready || !divRef.current || mapRef.current) return;
    const L = window.L;
    const map = L.map(divRef.current, { center: [25.7252, -100.3135], zoom: 16, minZoom: 14, maxZoom: 19 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    divRef.current.style.filter = "invert(1) hue-rotate(180deg) brightness(.78) saturate(.55)";
    mapRef.current = map;
  }, [ready]);

  useEffect(() => {
    if (!mapRef.current || !window.L) return;
    const L = window.L, map = mapRef.current;
    Object.values(mksRef.current).forEach(m => map.removeLayer(m));
    mksRef.current = {};
    const active = misiones.filter(m => m.estado === "abierta");

    FACULTADES.forEach(f => {
      const cnt = active.filter(m => m.building_id === f.id).length;
      const sz = cnt > 0 ? 36 : 24;
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:${sz}px;height:${sz}px;
          background:${cnt > 0 ? "rgba(79,142,247,.2)" : "rgba(11,15,26,.9)"};
          border:${cnt > 0 ? "2px solid #4F8EF7" : "1px solid #1C2640"};
          border-radius:9px;display:flex;align-items:center;justify-content:center;
          font-size:11px;color:${cnt > 0 ? "#7BB3FA" : "#4A5C7A"};font-weight:800;
          box-shadow:${cnt > 0 ? "0 0 14px rgba(79,142,247,.4)" : "none"};
          cursor:pointer">${cnt > 0 ? cnt : "·"}</div>`,
        iconSize: [sz, sz], iconAnchor: [sz/2, sz/2], popupAnchor: [0, -sz/2-4],
      });
      const mk = L.marker([f.lat, f.lng], { icon }).addTo(map)
        .bindPopup(`<div style="font-family:system-ui;padding:2px">
          <b style="font-size:12px;color:#EEF2FF">${f.label}</b><br>
          <span style="font-size:10px;color:#8899BB">${cnt} misión${cnt !== 1 ? "es" : ""}</span><br>
          <button onclick="window.__pu_b('${f.id}')" style="margin-top:6px;background:#4F8EF7;border:none;
          border-radius:7px;padding:4px 10px;color:#fff;font-size:11px;cursor:pointer">Ver →</button>
        </div>`);
      mksRef.current[`f_${f.id}`] = mk;
    });

    active.forEach((m, i) => {
      const f = FACULTADES.find(x => x.id === m.building_id);
      if (!f) return;
      const angle = (i * 64) * Math.PI / 180;
      const col = rw(m.reward_type).color;
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:30px;height:30px;background:${col};border-radius:50%;
          border:2.5px solid #060810;display:flex;align-items:center;justify-content:center;
          font-size:14px;box-shadow:0 2px 12px ${col}99;cursor:pointer">${rw(m.reward_type).icon}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -18],
      });
      const mk = L.marker([f.lat + Math.sin(angle) * .00009, f.lng + Math.cos(angle) * .00009], { icon })
        .addTo(map)
        .bindPopup(`<div style="font-family:system-ui;padding:2px">
          <b style="font-size:12px;color:#EEF2FF">${m.titulo}</b><br>
          <span style="color:${col};font-size:10px;font-weight:700">${rw(m.reward_type).icon} ${rw(m.reward_type).label(m.reward)}</span><br>
          <button onclick="window.__pu_q('${m.id}')" style="margin-top:6px;background:#4F8EF7;border:none;
          border-radius:7px;padding:4px 10px;color:#fff;font-size:11px;cursor:pointer">Ver →</button>
        </div>`);
      mksRef.current[`q_${m.id}`] = mk;
    });
  }, [misiones, ready]);

  useEffect(() => {
    window.__pu_b = onBuilding;
    window.__pu_q = onQuest;
  }, [onBuilding, onQuest]);

  return (
    <div ref={divRef} style={{ width: "100%", height: "100%", background: T.bg0 }}>
      {!ready && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", color: T.tx3, fontSize: 12 }}>Cargando mapa…</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  ONBOARDING
// ─────────────────────────────────────────────────────────────────
function Onboarding({ onDone }) {
  const [nombre, setNombre] = useState("");
  const [fac, setFac]       = useState("FIME");
  const [anio, setAnio]     = useState("1° Año");
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState("");

  const handleCreate = async () => {
    const n = nombre.trim();
    if (!n) { setErr("Escribe tu nombre para continuar"); return; }
    setLoading(true); setErr("");
    try {
      const rows = await db.insert("usuarios", {
        nombre: n, avatar: inits(n), facultad: fac, anio,
        bio: `Estudiante de ${fac} en CU UANL.`,
      });
      // Supabase returns array on insert
      const u = Array.isArray(rows) ? rows[0] : rows;
      if (!u || !u.id) throw new Error("Respuesta inesperada del servidor. Verifica que las tablas estén creadas (corre el SQL en Supabase).");
      localStorage.setItem("pu_uid", u.id);
      try { await window.storage.set("pu_uid", u.id); } catch(_) {}
      onDone(u);
    } catch (e) {
      if (e.noConn || e.message === "SIN_CONEXION" || e.message.includes("Failed to fetch") || e.message.includes("NetworkError")) {
        setErr("Sin conexión con Supabase. Verifica que tu proyecto esté activo.");
      } else if (e.message.includes("relation") || e.message.includes("does not exist")) {
        setErr('La tabla "usuarios" no existe. Ejecuta el SQL en Supabase > SQL Editor.');
      } else {
        setErr(e.message.slice(0, 220));
      }
    }
    setLoading(false);
  };

  const avatarColor = pal(nombre || "nuevo");

  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
      justifyContent: "center", padding: "24px 22px", gap: 20 }}>

      {/* Header */}
      <div style={{ textAlign: "center", paddingBottom: 4 }}>
        <div style={{ fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: 54, color: T.tx1, lineHeight: 1, letterSpacing: -2,
          textShadow: `0 0 80px ${T.aG}` }}>
          punto<span style={{ color: T.a1 }}>U</span>
        </div>
        <div style={{ fontSize: 10, color: T.tx3, letterSpacing: 3, marginTop: 6,
          textTransform: "uppercase" }}>Campus Universitario · UANL</div>
        <div style={{ width: 40, height: 2, background: T.a1, margin: "10px auto 0",
          borderRadius: 2, opacity: .6 }} />
      </div>

      {/* Form card */}
      <div style={{ background: T.bg2, border: `1px solid ${T.ln}`, borderRadius: 20,
        padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Live preview */}
        <div style={{ display: "flex", alignItems: "center", gap: 12,
          background: T.bg3, borderRadius: 13, padding: "11px 14px" }}>
          <Av name={nombre || "—"} size={48} color={avatarColor} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.tx1, lineHeight: 1.2 }}>
              {nombre || <span style={{ color: T.tx3 }}>Tu nombre aquí</span>}
            </div>
            <div style={{ fontSize: 11, color: T.a1, marginTop: 3 }}>{fac} · {anio}</div>
          </div>
        </div>

        <Field label="Nombre completo" req value={nombre}
          onChange={e => setNombre(e.target.value)} placeholder="Ej. Ana García" maxLength={40}
          onKeyDown={e => e.key === "Enter" && handleCreate()} />

        {/* Facultad */}
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .8,
            color: T.tx3, textTransform: "uppercase", marginBottom: 7 }}>Facultad</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {FACULTADES.map(f => (
              <button key={f.id} onClick={() => setFac(f.label)} style={{
                background: fac === f.label ? `${T.a1}18` : T.bg3,
                border: `1px solid ${fac === f.label ? T.a1 : T.ln}`,
                borderRadius: 7, padding: "4px 9px", fontSize: 10.5, fontWeight: 600,
                color: fac === f.label ? T.a1 : T.tx3, cursor: "pointer",
                fontFamily: "inherit", transition: "all .12s",
              }}>{f.label}</button>
            ))}
          </div>
        </div>

        {/* Año */}
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .8,
            color: T.tx3, textTransform: "uppercase", marginBottom: 7 }}>Año</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {["1° Año","2° Año","3° Año","4° Año","5° Año","Posgrado"].map(a => (
              <button key={a} onClick={() => setAnio(a)} style={{
                background: anio === a ? `${T.a1}18` : T.bg3,
                border: `1px solid ${anio === a ? T.a1 : T.ln}`,
                borderRadius: 7, padding: "4px 9px", fontSize: 10.5, fontWeight: 600,
                color: anio === a ? T.a1 : T.tx3, cursor: "pointer",
                fontFamily: "inherit", transition: "all .12s",
              }}>{a}</button>
            ))}
          </div>
        </div>

        {/* Error */}
        {err && (
          <div style={{ background: `${T.err}12`, border: `1px solid ${T.err}35`,
            borderRadius: 10, padding: "10px 13px", fontSize: 12, color: T.err,
            lineHeight: 1.5 }}>⚠️ {err}</div>
        )}

        <Btn onClick={handleCreate} disabled={loading || !nombre.trim()} sz="lg"
          sx={{ width: "100%", marginTop: 2 }}>
          {loading ? "Creando perfil…" : "Entrar a puntoU →"}
        </Btn>
      </div>

      <div style={{ textAlign: "center", fontSize: 10, color: T.tx3, lineHeight: 1.6 }}>
        Tu perfil es visible para otros estudiantes de CU UANL.<br />
        No se requiere correo ni contraseña.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  QUEST CARD  (reutilizable)
// ─────────────────────────────────────────────────────────────────
function QuestCard({ m, onClick }) {
  const cfg = rw(m.reward_type);
  return (
    <div onClick={onClick} className="tap" style={{
      background: T.bg2, border: `1px solid ${T.ln}`, borderRadius: 16,
      padding: "12px 13px", cursor: "pointer", position: "relative", overflow: "hidden",
      transition: "border-color .14s",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = T.ln2}
      onMouseLeave={e => e.currentTarget.style.borderColor = T.ln}>
      {/* left accent */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 3, height: "100%",
        background: `linear-gradient(to bottom, ${cfg.color}, ${cfg.color}44)` }} />

      <div style={{ paddingLeft: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.tx1, marginBottom: 3,
            lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.titulo}
          </div>
          <div style={{ fontSize: 10, color: T.tx3, marginBottom: 8 }}>
            🏛 {m.edificio}{m.salon && !m.es_linea ? ` · ${m.salon}` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Av name={m.user_nombre} size={20} />
            <span style={{ fontSize: 11, fontWeight: 600, color: T.tx2 }}>{m.user_nombre}</span>
            {m.user_rating > 0 && <>
              <StarsRow v={m.user_rating} size={9} />
              <span style={{ fontSize: 9, color: T.tx3 }}>{m.user_rating}</span>
            </>}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end",
          gap: 5, flexShrink: 0 }}>
          <div style={{ background: cfg.glow, border: `1px solid ${cfg.color}40`,
            borderRadius: 11, padding: "6px 10px", textAlign: "center",
            boxShadow: `0 0 16px ${cfg.glow}` }}>
            <div style={{ fontSize: 18 }}>{cfg.icon}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: cfg.color, marginTop: 2 }}>
              {cfg.label(m.reward)}
            </div>
          </div>
          <div style={{ fontSize: 9.5, color: T.tx3 }}>{ago(m.created_at)}</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────────────────────────
export default function PuntoU() {
  /* ── state ── */
  const [me, setMe]                   = useState(null);
  const [authLoad, setAuthLoad]       = useState(true);
  const [misiones, setMisiones]       = useState([]);
  const [mLoad, setMLoad]             = useState(true);
  const [cmts, setCmts]               = useState([]);
  const [msgs, setMsgs]               = useState([]);
  const [perfilData, setPerfilData]   = useState(null);
  const [chatUsers, setChatUsers]     = useState([]);

  const [screen, setScreen]           = useState("mapa");
  const [navTab, setNavTab]           = useState("mapa");
  const [history, setHistory]         = useState([]);

  const [selMision, setSelMision]     = useState(null);
  const [chatWith, setChatWith]       = useState(null);
  const [perfilUID, setPerfilUID]     = useState(null);
  const [fbuild, setFbuild]           = useState(null);
  const [ftype, setFtype]             = useState("all");

  /* nueva misión */
  const [nTitulo, setNTitulo]         = useState("");
  const [nDesc, setNDesc]             = useState("");
  const [nReward, setNReward]         = useState("");
  const [nType, setNType]             = useState("money");
  const [nBuild, setNBuild]           = useState("fime");
  const [nSalon, setNSalon]           = useState("");
  const [nLinea, setNLinea]           = useState(false);
  const [publishing, setPublishing]   = useState(false);

  /* calificar */
  const [calStars, setCalStars]       = useState(0);
  const [calText, setCalText]         = useState("");
  const [calTipo, setCalTipo]         = useState("como solicitante");
  const [calLoad, setCalLoad]         = useState(false);

  /* comentarios */
  const [cmtText, setCmtText]         = useState("");
  const [cmtLoad, setCmtLoad]         = useState(false);

  /* chat */
  const [msgText, setMsgText]         = useState("");
  const chatEnd                       = useRef(null);

  /* bio */
  const [editBio, setEditBio]         = useState(false);
  const [bioText, setBioText]         = useState("");

  /* toast */
  const [toast, setToast]             = useState(null);
  const toastTimer                    = useRef(null);
  const toast$ = (msg, type = "ok") => {
    setToast({ msg, type }); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  /* ── auth ── */
  useEffect(() => {
    const restore = async () => {
      let uid = null;
      try { const r = await window.storage.get("pu_uid"); if (r?.value) uid = r.value; } catch (_) {}
      if (!uid) try { uid = localStorage.getItem("pu_uid"); } catch(_) {}
      if (!uid) { setAuthLoad(false); return; }
      const timer = setTimeout(() => setAuthLoad(false), 8000);
      try {
        const rows = await db.get("usuarios", `id=eq.${uid}`);
        if (rows?.[0]) setMe(rows[0]);
        else { try { localStorage.removeItem("pu_uid"); } catch(_) {} try { await window.storage.delete("pu_uid"); } catch(_) {} }
      } catch (e) { console.warn("auth error:", e.message); }
      clearTimeout(timer); setAuthLoad(false);
    };
    restore();
  }, []);

  /* ── misiones ── */
  const loadMisiones = useCallback(async () => {
    try {
      const data = await db.get("misiones", "estado=eq.abierta");
      setMisiones(data || []);
    } catch (e) { console.warn("loadMisiones:", e.message); }
    setMLoad(false);
  }, []);
  useEffect(() => { loadMisiones(); }, []);
  useEffect(() => subscribe("misiones", loadMisiones), [loadMisiones]);

  /* ── comentarios ── */
  useEffect(() => {
    if (!selMision) return;
    const load = () =>
      db.get("comentarios", `mision_id=eq.${selMision.id}&order=created_at.asc`)
        .then(d => setCmts(d || [])).catch(() => {});
    load();
    return subscribe("comentarios", load);
  }, [selMision?.id]);

  /* ── mensajes ── */
  useEffect(() => {
    if (!chatWith || !me) return;
    const load = () =>
      db.get("mensajes",
        `or=(and(de_user_id.eq.${me.id},para_user_id.eq.${chatWith.id}),and(de_user_id.eq.${chatWith.id},para_user_id.eq.${me.id}))&order=created_at.asc`)
        .then(d => {
          setMsgs(d || []);
          setTimeout(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), 80);
        }).catch(() => {});
    load();
    return subscribe("mensajes", load);
  }, [chatWith?.id, me?.id]);

  /* ── nav helpers ── */
  const push = s => { setHistory(h => [...h, screen]); setScreen(s); };
  const back = () => {
    if (history.length) { setScreen(history[history.length - 1]); setHistory(h => h.slice(0, -1)); }
    else { setScreen("mapa"); setNavTab("mapa"); }
  };
  const navTo = tab => {
    setHistory([]); setNavTab(tab);
    if (tab === "mapa")     { setScreen("mapa"); }
    if (tab === "feed")     { setFbuild(null); setFtype("all"); setScreen("feed"); }
    if (tab === "nueva")    { setScreen("nueva"); }
    if (tab === "chat")     { loadChatUsers(); setScreen("chatlist"); }
    if (tab === "perfil")   { setPerfilUID(me?.id); loadPerfil(me?.id); setScreen("perfil"); }
  };

  const openMision = m => { setSelMision(m); setCmts([]); setCmtText(""); push("detalle"); };
  const openChat   = u => { setChatWith(u); setMsgs([]); setMsgText(""); push("chat"); };
  const openPerfil = uid => { setPerfilUID(uid); setPerfilData(null); loadPerfil(uid); push("perfil"); };

  /* ── load helpers ── */
  const loadChatUsers = async () => {
    if (!me) return;
    try {
      const [sent, recv] = await Promise.all([
        db.get("mensajes", `de_user_id=eq.${me.id}`),
        db.get("mensajes", `para_user_id=eq.${me.id}`),
      ]);
      const uids = [...new Set([...(sent||[]), ...(recv||[])].map(m =>
        m.de_user_id === me.id ? m.para_user_id : m.de_user_id))];
      setChatUsers(uids.length ? (await db.get("usuarios", `id=in.(${uids.join(",")})`)) || [] : []);
    } catch {}
  };

  const loadPerfil = async uid => {
    if (!uid) return;
    setPerfilData(null);
    try {
      const [users, resenas] = await Promise.all([
        db.get("usuarios", `id=eq.${uid}`),
        db.get("resenas", `para_user_id=eq.${uid}`),
      ]);
      const u = (users || [])[0];
      if (u) setPerfilData({ ...u, resenas: resenas || [] });
    } catch {}
  };

  /* ── actions ── */
  const publicar = async () => {
    if (!nTitulo.trim() || !nReward || !me) return;
    setPublishing(true);
    try {
      const f = FACULTADES.find(x => x.id === nBuild);
      await db.insert("misiones", {
        titulo: nTitulo.trim(), descripcion: nDesc.trim(),
        reward: parseFloat(nReward), reward_type: nType,
        edificio: nLinea ? "En línea" : (f?.label || "Campus"),
        salon: nLinea ? "" : nSalon,
        es_linea: nLinea, building_id: nBuild,
        lat: f?.lat, lng: f?.lng,
        user_id: me.id, user_nombre: me.nombre,
        user_avatar: inits(me.nombre), user_rating: me.rating || 0,
        estado: "abierta", tags: ["Nueva"],
      });
      await db.patch("usuarios", me.id, { quests_posted: (me.quests_posted || 0) + 1 });
      setMe(p => ({ ...p, quests_posted: (p.quests_posted || 0) + 1 }));
      setNTitulo(""); setNDesc(""); setNReward(""); setNLinea(false); setNSalon("");
      await loadMisiones();
      toast$("¡Misión publicada en tiempo real! 🚀");
      navTo("feed");
    } catch (e) {
      toast$((e.noConn || e.message === "SIN_CONEXION") ? "Sin conexión" : "Error: " + e.message.slice(0, 60), "err");
    }
    setPublishing(false);
  };

  const aceptarMision = async () => {
    if (!selMision || !me) return;
    try {
      await db.patch("misiones", selMision.id, { estado: "en_curso" });
      await db.insert("comentarios", {
        mision_id: selMision.id, user_id: me.id,
        user_nombre: me.nombre, user_avatar: inits(me.nombre),
        texto: "¡Misión aceptada! Ya voy.",
      });
      await db.insert("mensajes", {
        de_user_id: me.id, para_user_id: selMision.user_id,
        texto: `¡Hola! Acepté tu misión "${selMision.titulo}" 👋`,
      });
      setSelMision(p => ({ ...p, estado: "en_curso" }));
      await loadMisiones();
      toast$("¡Misión aceptada!");
      const owners = await db.get("usuarios", `id=eq.${selMision.user_id}`);
      const owner = (owners || [])[0];
      if (owner) openChat(owner);
    } catch (e) { toast$("Error: " + e.message.slice(0, 60), "err"); }
  };

  const enviarCmt = async () => {
    if (!cmtText.trim() || !selMision || !me) return;
    setCmtLoad(true);
    try {
      await db.insert("comentarios", {
        mision_id: selMision.id, user_id: me.id,
        user_nombre: me.nombre, user_avatar: inits(me.nombre), texto: cmtText.trim(),
      });
      setCmtText("");
    } catch { toast$("Error al comentar", "err"); }
    setCmtLoad(false);
  };

  const enviarMsg = async () => {
    if (!msgText.trim() || !chatWith || !me) return;
    const t = msgText; setMsgText("");
    try { await db.insert("mensajes", { de_user_id: me.id, para_user_id: chatWith.id, texto: t }); }
    catch { toast$("Error al enviar", "err"); }
  };

  const enviarCal = async () => {
    if (!calStars || !calText.trim() || !perfilUID || !me) return;
    setCalLoad(true);
    try {
      await db.insert("resenas", {
        de_user_id: me.id, para_user_id: perfilUID,
        de_nombre: me.nombre, de_avatar: inits(me.nombre),
        estrellas: calStars, texto: calText.trim(), tipo: calTipo,
      });
      const rs = await db.get("resenas", `para_user_id=eq.${perfilUID}`);
      const avg = +(rs.reduce((s, r) => s + r.estrellas, 0) / rs.length).toFixed(1);
      await db.patch("usuarios", perfilUID, { rating: avg, total_reviews: rs.length });
      setCalStars(0); setCalText("");
      await loadPerfil(perfilUID);
      toast$("¡Calificación enviada! ⭐"); back();
    } catch (e) { toast$("Error: " + e.message.slice(0, 60), "err"); }
    setCalLoad(false);
  };

  const guardarBio = async () => {
    try {
      await db.patch("usuarios", me.id, { bio: bioText });
      setMe(p => ({ ...p, bio: bioText }));
      setPerfilData(p => p ? { ...p, bio: bioText } : p);
      setEditBio(false); toast$("Bio actualizada ✓");
    } catch { toast$("Error al guardar", "err"); }
  };

  /* ── filtered feed ── */
  const feedItems = misiones.filter(m =>
    (!fbuild || m.building_id === fbuild) &&
    (ftype === "all" || m.reward_type === ftype)
  );

  /* ── loading ── */
  if (authLoad) return (
    <div style={{ fontFamily: "'Playfair Display',serif", background: T.bg0,
      minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 46, color: T.tx1, letterSpacing: -2 }}>
          punto<span style={{ color: T.a1 }}>U</span>
        </div>
        <Spin n={18} />
      </div>
    </div>
  );

  const ss = { flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" };
  const toastColor = toast?.type === "err" ? T.err : toast?.type === "warn" ? T.warn : T.ok;

  return (
    <div style={{ fontFamily: "'Sora',system-ui,sans-serif",
      background: "#030508", minHeight: "100vh",
      display: "flex", justifyContent: "center", alignItems: "center", padding: 16 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Sora:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: ${T.ln}; border-radius: 3px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideIn { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
        @keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        .tap:active { opacity:.75; transform:scale(.97); }
        button { cursor:pointer; font-family:inherit; }
        input, textarea { font-family:inherit; }
      `}</style>

      {/* ── phone frame ── */}
      <div style={{ width: 390, height: 860, background: T.bg1, borderRadius: 50,
        overflow: "hidden", display: "flex", flexDirection: "column", position: "relative",
        boxShadow: "0 0 0 1px #1C2640, 0 60px 200px rgba(0,0,0,.9), 0 0 120px rgba(79,142,247,.04)" }}>

        {/* status bar */}
        <div style={{ height: 46, display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "0 26px", flexShrink: 0, position: "relative" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.tx1 }}>9:41</span>
          <div style={{ width: 120, height: 30, background: "#000", borderRadius: 22,
            position: "absolute", left: "50%", transform: "translateX(-50%)" }} />
          <span style={{ fontSize: 11, color: T.tx2 }}>●●● 🔋</span>
        </div>

        {!me ? (
          /* ── onboarding ── */
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column",
            animation: "fadeUp .4s ease" }}>
            <Onboarding onDone={u => { setMe(u); setScreen("mapa"); }} />
          </div>
        ) : (
          /* ── main ── */
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

            {/* ══════ MAPA ══════ */}
            {screen === "mapa" && (
              <div style={{ ...ss, animation: "fadeUp .3s ease" }}>
                <div style={{ padding: "4px 16px 6px", display: "flex",
                  justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                  <div>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 27,
                      color: T.tx1, lineHeight: 1, letterSpacing: -1 }}>
                      punto<span style={{ color: T.a1 }}>U</span>
                    </div>
                    <div style={{ fontSize: 9.5, color: T.tx3, marginTop: 1 }}>
                      {misiones.filter(m => m.estado === "abierta").length} misiones ·{" "}
                      <span style={{ color: T.ok }}>● en vivo</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Btn sz="sm" onClick={() => navTo("nueva")}>＋ Misión</Btn>
                    <Av name={me.nombre} size={32} sx={{ cursor: "pointer" }}
                      onClick={() => navTo("perfil")} />
                  </div>
                </div>

                <div style={{ flex: 1, overflow: "hidden" }}>
                  <LeafletMap misiones={misiones}
                    onBuilding={bid => { setFbuild(bid); setFtype("all"); push("feed"); }}
                    onQuest={qid => { const m = misiones.find(x => x.id === qid); if (m) openMision(m); }}
                  />
                </div>

                {/* stats bar */}
                <div style={{ display: "flex", gap: 6, padding: "6px 12px 4px",
                  background: T.bg2, borderTop: `1px solid ${T.ln}`, flexShrink: 0 }}>
                  {Object.entries(RW).map(([type, cfg]) => {
                    const cnt = misiones.filter(m => m.reward_type === type && m.estado === "abierta").length;
                    return (
                      <div key={type} onClick={() => { setFtype(type); setFbuild(null); push("feed"); }}
                        className="tap" style={{ flex: 1, background: T.bg3,
                          border: `1px solid ${T.ln}`, borderRadius: 12,
                          padding: "8px 6px", cursor: "pointer", textAlign: "center" }}>
                        <div style={{ fontSize: 17 }}>{cfg.icon}</div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: cfg.color,
                          lineHeight: 1.1, marginTop: 2 }}>{cnt}</div>
                        <div style={{ fontSize: 9, color: T.tx3, marginTop: 2 }}>
                          {type === "money" ? "Dinero" : type === "time" ? "Tiempo" : "Estudio"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ══════ FEED ══════ */}
            {screen === "feed" && (
              <div style={{ ...ss, animation: "slideIn .3s ease" }}>
                {/* header */}
                <div style={{ padding: "8px 14px 0", display: "flex",
                  justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <BackBtn onClick={back} />
                    <div>
                      <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: T.tx1 }}>
                        {fbuild ? FACULTADES.find(f => f.id === fbuild)?.label : "Misiones Activas"}
                      </div>
                      <div style={{ fontSize: 10, color: T.tx3 }}>
                        {feedItems.length} disponibles · <span style={{ color: T.ok }}>● en vivo</span>
                      </div>
                    </div>
                  </div>
                  {fbuild && (
                    <button onClick={() => setFbuild(null)} style={{ background: "none", border: "none",
                      color: T.tx2, fontSize: 10.5, textDecoration: "underline" }}>Ver todo</button>
                  )}
                </div>

                {/* filtros tipo */}
                <div style={{ display: "flex", gap: 6, padding: "8px 13px 6px",
                  overflowX: "auto", flexShrink: 0 }}>
                  {[["all", "Todas", T.a1], ["money", "💰 Dinero", T.ok],
                    ["time", "⏱ Tiempo", T.warn], ["study", "📚 Estudio", RW.study.color]]
                    .map(([val, lbl, col]) => (
                    <button key={val} onClick={() => setFtype(val)} style={{
                      flexShrink: 0, background: ftype === val ? `${col}18` : "transparent",
                      border: `1px solid ${ftype === val ? col : T.ln}`,
                      borderRadius: 20, padding: "5px 12px", color: ftype === val ? col : T.tx2,
                      fontSize: 11, fontWeight: 600, cursor: "pointer",
                      transition: "all .12s", whiteSpace: "nowrap",
                    }}>{lbl}</button>
                  ))}
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px",
                  display: "flex", flexDirection: "column", gap: 8 }}>
                  {mLoad ? <Spin /> : feedItems.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "48px 20px", color: T.tx2 }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
                      <div style={{ fontWeight: 600 }}>Sin misiones aquí</div>
                      <div style={{ fontSize: 11, color: T.tx3, marginTop: 5 }}>
                        ¡Sé el primero en publicar!
                      </div>
                    </div>
                  ) : feedItems.map(m => (
                    <QuestCard key={m.id} m={m} onClick={() => openMision(m)} />
                  ))}
                </div>
              </div>
            )}

            {/* ══════ DETALLE ══════ */}
            {screen === "detalle" && selMision && (() => {
              const m = selMision;
              const cfg = rw(m.reward_type);
              return (
                <div style={{ ...ss, animation: "slideIn .3s ease", overflowY: "auto" }}>
                  <div style={{ padding: "8px 14px 0",
                    display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <BackBtn onClick={back} />
                    <div style={{ fontFamily: "'Playfair Display',serif",
                      fontSize: 16, color: T.tx1, flex: 1 }}>Detalle de Misión</div>
                    <Chip icon={cfg.icon} label={cfg.label(m.reward)} color={cfg.color} />
                  </div>

                  <div style={{ padding: "10px 14px 24px",
                    display: "flex", flexDirection: "column", gap: 10 }}>

                    {/* Info */}
                    <div style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                      borderRadius: 16, padding: 14 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: T.tx1,
                        marginBottom: 8, lineHeight: 1.35 }}>{m.titulo}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                        <Chip label={m.edificio} color={T.a1} />
                        {m.salon && !m.es_linea && <Chip label={m.salon} color={T.tx2} />}
                        {m.es_linea && <Chip label="En línea" color={RW.study.color} />}
                      </div>
                      {m.descripcion && (
                        <div style={{ fontSize: 12.5, color: T.tx2, lineHeight: 1.75 }}>
                          {m.descripcion}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: T.tx3, marginTop: 8 }}>
                        Publicado {ago(m.created_at)}
                      </div>
                    </div>

                    {/* Dueño */}
                    <div onClick={() => openPerfil(m.user_id)} className="tap" style={{
                      background: T.bg2, border: `1px solid ${T.ln}`, borderRadius: 16,
                      padding: "11px 13px", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 11 }}>
                      <Av name={m.user_nombre} size={44} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 9.5, color: T.tx3, fontWeight: 700,
                          letterSpacing: .6, marginBottom: 2 }}>PUBLICADO POR</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.tx1 }}>
                          {m.user_nombre}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                          <StarsRow v={m.user_rating || 0} size={11} />
                          <span style={{ fontSize: 10, color: T.tx3 }}>
                            {m.user_rating > 0 ? m.user_rating : "Nuevo"}
                          </span>
                        </div>
                      </div>
                      <span style={{ color: T.a1, fontSize: 20 }}>›</span>
                    </div>

                    {/* CTA */}
                    {m.user_id !== me.id && (
                      m.estado === "abierta"
                        ? <Btn onClick={aceptarMision} sz="lg" sx={{ width: "100%" }}>✓ Aceptar Misión</Btn>
                        : <Btn v="success" sz="lg" disabled sx={{ width: "100%" }}>✓ Misión en curso</Btn>
                    )}

                    {/* Comentarios */}
                    <div style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                      borderRadius: 16, padding: 13 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.tx1,
                        marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                        💬 Comentarios ({cmts.length})
                        <span style={{ fontSize: 9, color: T.ok, fontWeight: 400 }}>● en vivo</span>
                      </div>

                      <div style={{ maxHeight: 190, overflowY: "auto",
                        display: "flex", flexDirection: "column", gap: 7, marginBottom: 10 }}>
                        {cmts.length === 0 ? (
                          <div style={{ fontSize: 11, color: T.tx3,
                            textAlign: "center", padding: "10px 0" }}>Sin comentarios aún</div>
                        ) : cmts.map(c => (
                          <div key={c.id} style={{ display: "flex", gap: 8 }}>
                            <Av name={c.user_nombre} size={26} color={c.user_id === me.id ? T.ok : undefined} />
                            <div style={{ flex: 1, background: T.bg3, borderRadius: 10,
                              padding: "7px 11px" }}>
                              <div style={{ display: "flex",
                                justifyContent: "space-between", marginBottom: 2 }}>
                                <span style={{ fontSize: 10.5, fontWeight: 700,
                                  color: c.user_id === me.id ? T.ok : T.tx1 }}>{c.user_nombre}</span>
                                <span style={{ fontSize: 9, color: T.tx3 }}>{ago(c.created_at)}</span>
                              </div>
                              <div style={{ fontSize: 12, color: T.tx2, lineHeight: 1.5 }}>
                                {c.texto}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: "flex", gap: 7 }}>
                        <Av name={me.nombre} size={26} color={T.ok} />
                        <input value={cmtText} onChange={e => setCmtText(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && enviarCmt()}
                          placeholder="Escribe un comentario…"
                          style={{ flex: 1, background: T.bg3, border: `1px solid ${T.ln}`,
                            borderRadius: 20, padding: "7px 13px", color: T.tx1,
                            fontSize: 12, outline: "none" }} />
                        <button onClick={enviarCmt} disabled={!cmtText.trim() || cmtLoad}
                          style={{ background: cmtText.trim() ? T.a1 : T.ln, border: "none",
                            borderRadius: "50%", width: 32, height: 32, color: "#fff",
                            fontSize: 14, display: "flex", alignItems: "center",
                            justifyContent: "center", flexShrink: 0,
                            transition: "background .14s" }}>↑</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ══════ NUEVA MISIÓN ══════ */}
            {screen === "nueva" && (
              <div style={{ ...ss, animation: "slideIn .3s ease", overflowY: "auto" }}>
                <div style={{ padding: "8px 14px 10px",
                  display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <BackBtn onClick={back} />
                  <div style={{ fontFamily: "'Playfair Display',serif",
                    fontSize: 19, color: T.tx1 }}>Nueva Misión</div>
                </div>

                <div style={{ padding: "0 14px 28px",
                  display: "flex", flexDirection: "column", gap: 13 }}>
                  <Field label="Título" req value={nTitulo}
                    onChange={e => setNTitulo(e.target.value)} placeholder="¿Qué necesitas?" />

                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <Field label="Recompensa" req type="number" value={nReward}
                        onChange={e => setNReward(e.target.value)} placeholder="50" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .8,
                        color: T.tx3, textTransform: "uppercase", marginBottom: 6 }}>Tipo</div>
                      <div style={{ display: "flex", gap: 5 }}>
                        {Object.entries(RW).map(([t, cfg]) => (
                          <button key={t} onClick={() => setNType(t)} className="tap" style={{
                            flex: 1, background: nType === t ? cfg.glow : T.bg3,
                            border: `2px solid ${nType === t ? cfg.color : T.ln}`,
                            borderRadius: 10, padding: "8px 0", fontSize: 19,
                            transition: "all .14s",
                          }}>{cfg.icon}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* reward preview */}
                  {nReward && (
                    <div style={{ background: rw(nType).glow, border: `1px solid ${rw(nType).color}40`,
                      borderRadius: 11, padding: "9px 13px", fontSize: 13, fontWeight: 700,
                      color: rw(nType).color }}>
                      {rw(nType).icon} Recompensa: {rw(nType).label(nReward)}
                    </div>
                  )}

                  {/* ubicación */}
                  <div style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                    borderRadius: 16, padding: 13 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .8,
                      color: T.tx3, textTransform: "uppercase", marginBottom: 10 }}>
                      Ubicación <span style={{ fontWeight: 400, color: T.tx3, fontSize: 9 }}>(opcional)</span>
                    </div>
                    <Toggle on={nLinea} onClick={() => setNLinea(p => !p)} label="💻 Es en línea" />
                    {!nLinea && (
                      <>
                        <div style={{ height: 10 }} />
                        <div style={{ fontSize: 9.5, color: T.tx3, fontWeight: 700,
                          letterSpacing: .5, marginBottom: 6 }}>FACULTAD</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                          {FACULTADES.map(f => (
                            <FacPill key={f.id} id={f.id} label={f.label} active={nBuild === f.id}
                              cnt={0} onClick={() => setNBuild(f.id)} />
                          ))}
                        </div>
                        <Field label="Salón / Área" value={nSalon}
                          onChange={e => setNSalon(e.target.value)}
                          placeholder="Ej. B-203" style={{ background: T.bg3 }} />
                      </>
                    )}
                  </div>

                  <TArea label="Descripción" value={nDesc}
                    onChange={e => setNDesc(e.target.value)}
                    placeholder="Explica con detalle lo que necesitas…" rows={3} />

                  <Btn onClick={publicar} disabled={!nTitulo.trim() || !nReward || publishing}
                    sz="lg" sx={{ width: "100%" }}>
                    {publishing ? "Publicando…" :
                      nTitulo.trim() && nReward ? "Publicar Misión 🚀" : "Completa título y recompensa"}
                  </Btn>
                </div>
              </div>
            )}

            {/* ══════ PERFIL ══════ */}
            {screen === "perfil" && (() => {
              const u = perfilData;
              const isMe = u?.id === me?.id;
              return (
                <div style={{ ...ss, animation: "slideIn .3s ease", overflowY: "auto" }}>
                  {/* hero */}
                  <div style={{ background: `linear-gradient(170deg,${T.a1}18 0%,transparent 55%)`,
                    padding: "8px 14px 16px", flexShrink: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 14 }}>
                      <BackBtn onClick={back} />
                      {u && !isMe && (
                        <div style={{ display: "flex", gap: 7 }}>
                          <Btn v="ghost" sz="sm" onClick={() => openChat(u)}>💬 Chat</Btn>
                          <Btn sz="sm" onClick={() => { setCalStars(0); setCalText(""); push("calificar"); }}>
                            ⭐ Calificar
                          </Btn>
                        </div>
                      )}
                    </div>
                    {!u ? <Spin /> : (
                      <div style={{ display: "flex", flexDirection: "column",
                        alignItems: "center", gap: 7 }}>
                        <Av name={u.nombre} size={68} color={isMe ? T.ok : undefined} />
                        <div style={{ fontFamily: "'Playfair Display',serif",
                          fontSize: 23, color: T.tx1, letterSpacing: -.5, lineHeight: 1.1 }}>
                          {u.nombre}
                        </div>
                        <div style={{ fontSize: 11.5, color: T.a1, fontWeight: 600 }}>
                          {u.facultad} · {u.anio}
                        </div>
                        {u.total_reviews > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <StarsRow v={u.rating} size={14} />
                            <span style={{ fontSize: 17, fontWeight: 800, color: T.gold }}>
                              {u.rating}
                            </span>
                            <span style={{ fontSize: 10, color: T.tx3 }}>({u.total_reviews})</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: T.tx3 }}>Sin reseñas aún</div>
                        )}
                      </div>
                    )}
                  </div>

                  {u && (
                    <div style={{ padding: "0 13px 24px",
                      display: "flex", flexDirection: "column", gap: 10 }}>
                      {/* Bio */}
                      <div style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                        borderRadius: 16, padding: 13 }}>
                        {isMe && editBio ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <TArea value={bioText} onChange={e => setBioText(e.target.value)} rows={3} />
                            <div style={{ display: "flex", gap: 7 }}>
                              <Btn onClick={guardarBio} sz="sm" sx={{ flex: 1 }}>Guardar</Btn>
                              <Btn v="ghost" sz="sm" onClick={() => setEditBio(false)} sx={{ flex: 1 }}>Cancelar</Btn>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <div style={{ fontSize: 12.5, color: T.tx2,
                              lineHeight: 1.75, fontStyle: "italic", flex: 1 }}>
                              "{u.bio}"
                            </div>
                            {isMe && (
                              <button onClick={() => { setBioText(u.bio); setEditBio(true); }}
                                style={{ background: "none", border: `1px solid ${T.ln}`,
                                  borderRadius: 7, padding: "3px 8px", color: T.tx3,
                                  fontSize: 10, flexShrink: 0 }}>✏️</button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Stats */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7 }}>
                        {[
                          ["🗺️", "Publicadas", u.quests_posted || 0, T.a1],
                          ["✅", "Realizadas", u.quests_done || 0, T.ok],
                          ["📅", "Desde", new Date(u.created_at).toLocaleDateString("es-MX",
                            { month: "short", year: "2-digit" }), T.gold],
                        ].map(([ic, lb, val, col]) => (
                          <div key={lb} style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                            borderRadius: 13, padding: "10px 6px", textAlign: "center" }}>
                            <div style={{ fontSize: 18, marginBottom: 3 }}>{ic}</div>
                            <div style={{ fontSize: typeof val === "number" ? 19 : 11,
                              fontWeight: 800, color: col, lineHeight: 1 }}>{val}</div>
                            <div style={{ fontSize: 9, color: T.tx3, marginTop: 3 }}>{lb}</div>
                          </div>
                        ))}
                      </div>

                      {/* Reseñas */}
                      <div style={{ fontFamily: "'Playfair Display',serif",
                        fontSize: 16, color: T.tx1, marginBottom: 2 }}>Reseñas</div>
                      {!u.resenas?.length ? (
                        <div style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                          borderRadius: 14, padding: 24, textAlign: "center",
                          color: T.tx3, fontSize: 12 }}>Sin reseñas aún 🌱</div>
                      ) : u.resenas.slice().reverse().map(r => (
                        <div key={r.id} style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                          borderRadius: 14, padding: 12, marginBottom: 5 }}>
                          <div style={{ display: "flex", alignItems: "center",
                            gap: 9, marginBottom: 7 }}>
                            <Av name={r.de_nombre} size={28} />
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 12, fontWeight: 700,
                                  color: T.tx1 }}>{r.de_nombre}</span>
                                <span style={{ fontSize: 9.5, color: T.tx3 }}>{ago(r.created_at)}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center",
                                gap: 5, marginTop: 2 }}>
                                <StarsRow v={r.estrellas} size={11} />
                                <span style={{ fontSize: 9, background: T.bg3, color: T.tx3,
                                  border: `1px solid ${T.ln}`, borderRadius: 5,
                                  padding: "1px 6px" }}>{r.tipo}</span>
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: T.tx2,
                            lineHeight: 1.65, paddingLeft: 37 }}>{r.texto}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ══════ CALIFICAR ══════ */}
            {screen === "calificar" && perfilData && (
              <div style={{ ...ss, animation: "slideIn .3s ease", overflowY: "auto" }}>
                <div style={{ padding: "8px 14px 12px",
                  display: "flex", alignItems: "center", gap: 8 }}>
                  <BackBtn onClick={back} />
                  <div style={{ fontFamily: "'Playfair Display',serif",
                    fontSize: 19, color: T.tx1 }}>Calificar</div>
                </div>
                <div style={{ padding: "0 14px 28px",
                  display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                    borderRadius: 16, padding: 13, display: "flex", alignItems: "center", gap: 11 }}>
                    <Av name={perfilData.nombre} size={48} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: T.tx1 }}>
                        {perfilData.nombre}
                      </div>
                      <div style={{ fontSize: 11, color: T.tx2 }}>{perfilData.facultad}</div>
                    </div>
                  </div>

                  <div style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                    borderRadius: 16, padding: 14 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .8,
                      color: T.tx3, textTransform: "uppercase", marginBottom: 12 }}>Calificación</div>
                    <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
                      <StarsRow v={calStars} size={36} editable onChange={setCalStars} />
                    </div>
                    {calStars > 0 && (
                      <div style={{ textAlign: "center", fontSize: 13, color: T.gold, fontWeight: 700 }}>
                        {["","Muy malo 😞","Regular 😐","Bien 🙂","Muy bien 😊","¡Excelente! 🌟"][calStars]}
                      </div>
                    )}
                  </div>

                  <div style={{ background: T.bg2, border: `1px solid ${T.ln}`,
                    borderRadius: 16, padding: 13 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: .8,
                      color: T.tx3, textTransform: "uppercase", marginBottom: 9 }}>Rol</div>
                    <div style={{ display: "flex", gap: 7 }}>
                      {["como solicitante","como ayudante"].map(r => (
                        <button key={r} onClick={() => setCalTipo(r)} style={{
                          flex: 1, background: calTipo === r ? `${T.a1}18` : T.bg3,
                          border: `2px solid ${calTipo === r ? T.a1 : T.ln}`,
                          borderRadius: 11, padding: "9px 4px", fontSize: 11, fontWeight: 600,
                          color: calTipo === r ? T.a1 : T.tx2, transition: "all .13s",
                        }}>
                          {r === "como solicitante" ? "🙋 Solicitante" : "🤝 Ayudante"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <TArea label="Comentario" value={calText}
                    onChange={e => setCalText(e.target.value)}
                    placeholder="Describe tu experiencia…" rows={4} />

                  <Btn onClick={enviarCal} disabled={!calStars || !calText.trim() || calLoad}
                    sz="lg" sx={{ width: "100%" }}>
                    {calLoad ? "Enviando…" : "Enviar Calificación ⭐"}
                  </Btn>
                </div>
              </div>
            )}

            {/* ══════ CHAT LIST ══════ */}
            {screen === "chatlist" && (
              <div style={{ ...ss, animation: "fadeUp .3s ease" }}>
                <div style={{ padding: "8px 14px 12px", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'Playfair Display',serif",
                    fontSize: 25, color: T.tx1 }}>Chats</div>
                  <div style={{ fontSize: 10.5, color: T.tx3, marginTop: 2 }}>
                    Mensajes en tiempo real · <span style={{ color: T.ok }}>● activo</span>
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: "auto",
                  padding: "0 13px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
                  {chatUsers.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "48px 20px", color: T.tx2 }}>
                      <div style={{ fontSize: 38, marginBottom: 10 }}>💬</div>
                      <div style={{ fontWeight: 600 }}>Sin conversaciones</div>
                      <div style={{ fontSize: 11, color: T.tx3, marginTop: 5 }}>
                        Acepta una misión para chatear
                      </div>
                    </div>
                  ) : chatUsers.map(u => (
                    <div key={u.id} onClick={() => openChat(u)} className="tap" style={{
                      background: T.bg2, border: `1px solid ${T.ln}`, borderRadius: 16,
                      padding: "11px 13px", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 11,
                      transition: "border-color .13s",
                    }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = T.ln2}
                      onMouseLeave={e => e.currentTarget.style.borderColor = T.ln}>
                      <Av name={u.nombre} size={44} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.tx1 }}>{u.nombre}</div>
                        <div style={{ fontSize: 11, color: T.tx3 }}>{u.facultad}</div>
                      </div>
                      <span style={{ color: T.a1, fontSize: 20 }}>›</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══════ CHATROOM ══════ */}
            {screen === "chat" && chatWith && (
              <div style={{ ...ss, animation: "slideIn .3s ease" }}>
                <div style={{ padding: "8px 14px 10px",
                  display: "flex", alignItems: "center", gap: 9,
                  flexShrink: 0, borderBottom: `1px solid ${T.ln}` }}>
                  <BackBtn onClick={back} />
                  <Av name={chatWith.nombre} size={34} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.tx1 }}>
                      {chatWith.nombre}
                    </div>
                    <div style={{ fontSize: 10, color: T.ok }}>● En línea</div>
                  </div>
                  <Btn v="ghost" sz="sm" onClick={() => openPerfil(chatWith.id)}>Perfil</Btn>
                </div>

                <div style={{ flex: 1, overflowY: "auto",
                  padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {msgs.length === 0 && (
                    <div style={{ textAlign: "center", color: T.tx3, fontSize: 12, padding: "24px 0" }}>
                      Inicia la conversación 👋
                    </div>
                  )}
                  {msgs.map(m => {
                    const mine = m.de_user_id === me.id;
                    return (
                      <div key={m.id} style={{ display: "flex",
                        justifyContent: mine ? "flex-end" : "flex-start",
                        alignItems: "flex-end", gap: 7 }}>
                        {!mine && <Av name={chatWith.nombre} size={24} sx={{ flexShrink: 0 }} />}
                        <div style={{
                          maxWidth: "74%",
                          background: mine ? T.a1 : T.bg2,
                          border: `1px solid ${mine ? T.a1 : T.ln}`,
                          borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                          padding: "9px 13px",
                        }}>
                          <div style={{ fontSize: 13, color: mine ? "#fff" : T.tx1,
                            lineHeight: 1.5 }}>{m.texto}</div>
                          <div style={{ fontSize: 9, color: mine ? "rgba(255,255,255,.5)" : T.tx3,
                            marginTop: 3, textAlign: "right" }}>{ago(m.created_at)}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEnd} />
                </div>

                <div style={{ padding: "9px 13px 11px",
                  borderTop: `1px solid ${T.ln}`, display: "flex", gap: 8, flexShrink: 0 }}>
                  <input value={msgText} onChange={e => setMsgText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && enviarMsg()}
                    placeholder="Escribe un mensaje…"
                    style={{ flex: 1, background: T.bg2, border: `1px solid ${T.ln}`,
                      borderRadius: 22, padding: "9px 15px", color: T.tx1,
                      fontSize: 13, outline: "none" }} />
                  <button onClick={enviarMsg} className="tap" style={{
                    background: msgText.trim() ? T.a1 : T.ln, border: "none",
                    borderRadius: "50%", width: 38, height: 38, color: "#fff",
                    fontSize: 16, display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0, transition: "background .14s",
                  }}>↑</button>
                </div>
              </div>
            )}

            {/* ── Toast ── */}
            {toast && (
              <div style={{
                position: "absolute", bottom: 82, left: "50%",
                background: T.bg2, border: `1px solid ${toastColor}`,
                borderRadius: 14, padding: "10px 18px", fontSize: 12.5, fontWeight: 600,
                color: toastColor, whiteSpace: "nowrap",
                animation: "toastIn .3s ease", zIndex: 999,
                boxShadow: `0 8px 32px rgba(0,0,0,.5), 0 0 20px ${toastColor}22`,
              }}>
                {toast.type === "ok" ? "✓ " : "✗ "}{toast.msg}
              </div>
            )}

            {/* ── Navbar ── */}
            <div style={{ height: 62, background: T.bg2, borderTop: `1px solid ${T.ln}`,
              display: "flex", alignItems: "center", justifyContent: "space-around",
              padding: "0 6px 6px", flexShrink: 0 }}>
              {[
                { id: "mapa",   icon: "🗺️", label: "Mapa"    },
                { id: "feed",   icon: "📋", label: "Misiones"},
                { id: "nueva",  icon: "＋",  fab: true        },
                { id: "chat",   icon: "💬", label: "Chat"    },
                { id: "perfil", icon: "👤", label: "Perfil"  },
              ].map(({ id, icon, label, fab }) => (
                <button key={id} onClick={() => navTo(id)} className="tap" style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  background: fab ? T.a1 : "transparent", border: "none",
                  borderRadius: fab ? "50%" : 0, width: fab ? 46 : undefined,
                  height: fab ? 46 : undefined, padding: fab ? 0 : "4px 10px",
                  boxShadow: fab ? `0 4px 20px ${T.aG}` : "none",
                  transform: fab ? "translateY(-10px)" : "none",
                }}>
                  <span style={{ fontSize: fab ? 20 : 20 }}>{icon}</span>
                  {!fab && (
                    <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: .3,
                      color: navTab === id ? T.a1 : T.tx3, textTransform: "uppercase" }}>
                      {label}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* home indicator */}
            <div style={{ height: 14, background: T.bg1, display: "flex",
              alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <div style={{ width: 100, height: 4, background: T.ln, borderRadius: 4 }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
