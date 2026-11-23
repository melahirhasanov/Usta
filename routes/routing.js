const express = require("express");

const router = express.Router();

// Real yol məsafəsi: OSRM marşrut servisi (OpenStreetMap yolları üzrə maşınla).
// OSRM_URL ilə öz serverinizi göstərə bilərsiniz; standart olaraq pulsuz ictimai demo server istifadə olunur.
const OSRM_URL = process.env.OSRM_URL || "https://router.project-osrm.org";
const MAX_POINTS = 50;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // "lat,lng|lat,lng" -> { at, distanceKm, durationMin }

const round = (n) => Number(n).toFixed(4); // ~10 m dəqiqlik — keş açarı üçün
const keyOf = (a, b) => `${round(a[0])},${round(a[1])}|${round(b[0])},${round(b[1])}`;
const validPoint = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(Number(n)));

// POST { origin: [lat, lng], points: [{ id, lat, lng }] } -> { results: { id: { distanceKm, durationMin } } }
router.post("/distances", async (req, res) => {
  const { origin, points } = req.body || {};
  if (!validPoint(origin) || !Array.isArray(points)) return res.status(400).json({ message: "Yanlış koordinatlar" });

  const list = points.slice(0, MAX_POINTS).filter((p) => p && p.id && validPoint([p.lat, p.lng]));
  const results = {};
  const missing = [];
  const now = Date.now();
  for (const p of list) {
    const hit = cache.get(keyOf(origin, [p.lat, p.lng]));
    if (hit && now - hit.at < CACHE_TTL_MS) results[p.id] = { distanceKm: hit.distanceKm, durationMin: hit.durationMin };
    else missing.push(p);
  }

  if (missing.length) {
    try {
      const coords = [origin, ...missing.map((p) => [p.lat, p.lng])].map(([lat, lng]) => `${Number(lng)},${Number(lat)}`).join(";");
      const url = `${OSRM_URL}/table/v1/driving/${coords}?sources=0&annotations=distance,duration`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      if (data.code !== "Ok") throw new Error(data.code);
      missing.forEach((p, i) => {
        const meters = data.distances?.[0]?.[i + 1];
        const seconds = data.durations?.[0]?.[i + 1];
        if (meters == null) return;
        const value = { distanceKm: Math.round(meters / 100) / 10, durationMin: Math.max(1, Math.round(seconds / 60)) };
        results[p.id] = value;
        cache.set(keyOf(origin, [p.lat, p.lng]), { ...value, at: now });
      });
    } catch (error) {
      // Servis əlçatmazdırsa, client düz xətt məsafəsinə qayıdır
      console.warn("OSRM məsafə xətası:", error.message);
      return res.json({ results, partial: true });
    }
  }

  if (cache.size > 5000) cache.clear();
  res.json({ results });
});

// ---------- Ünvan axtarışı (geocoding): OpenStreetMap Nominatim ----------
// Nominatim qaydaları: tanınan User-Agent, saniyədə ən çox 1 sorğu, nəticələri keşləmək.
const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const geoCache = new Map(); // normallaşdırılmış sorğu -> { at, results }
let lastGeoCall = 0;
let geoQueue = Promise.resolve();

// Sorğuları ardıcıl və ən azı 1 san. aralıqla göndərir
function throttledFetch(url) {
  const run = geoQueue.then(async () => {
    const wait = lastGeoCall + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGeoCall = Date.now();
    return fetch(url, {
      headers: { "User-Agent": "UstaTap/1.0 (usta-tap.netlify.app)", "Accept-Language": "az,en" },
      signal: AbortSignal.timeout(8000),
    });
  });
  geoQueue = run.catch(() => {});
  return run;
}

// "Təbriz küçəsi, Nərimanov, Bakı, ..." -> qısa başlıq + alt sətir
function toPlace(item) {
  const a = item.address || {};
  const street = [a.road || a.pedestrian || a.neighbourhood, a.house_number].filter(Boolean).join(" ");
  const title = item.name || street || item.display_name.split(",")[0];
  const area = [a.suburb || a.city_district || a.quarter, a.city || a.town || a.village].filter(Boolean);
  const subtitle = [...new Set(area)].filter((s) => s !== title).join(", ");
  return { title, subtitle, lat: Number(item.lat), lng: Number(item.lon) };
}

// GET /geocode?q=Təbriz küçəsi -> { results: [{ title, subtitle, lat, lng }] }
router.get("/geocode", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  if (q.length < 3) return res.json({ results: [] });
  const key = q.toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < GEO_TTL_MS) return res.json({ results: hit.results });

  try {
    // Azərbaycanla məhdud, Bakı ərazisinə üstünlük verilir
    const params = new URLSearchParams({
      q, format: "jsonv2", addressdetails: "1", limit: "6", countrycodes: "az", viewbox: "49.55,40.65,50.40,40.25",
    });
    const response = await throttledFetch(`${NOMINATIM_URL}/search?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    // Eyni adlı küçənin bir neçə hissəsi ayrıca qayıdır — başlıq+alt sətir üzrə təkləşdirilir
    const seen = new Set();
    const results = (Array.isArray(data) ? data : [])
      .map(toPlace)
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .filter((p) => {
        const id = `${p.title}|${p.subtitle}`.toLowerCase();
        return !seen.has(id) && seen.add(id);
      })
      // Bakı/Abşeron ərazisindəki nəticələr öndə (sabit sıralama — Nominatim-in öz sırası qorunur)
      .map((p, i) => ({ p, i, near: p.lat <= 40.65 && p.lat >= 40.25 && p.lng >= 49.55 && p.lng <= 50.4 }))
      .sort((a, b) => b.near - a.near || a.i - b.i)
      .map(({ p }) => p);
    if (geoCache.size > 2000) geoCache.clear();
    geoCache.set(key, { at: Date.now(), results });
    res.json({ results });
  } catch (error) {
    console.warn("Geocoding xətası:", error.message);
    res.status(502).json({ results: [], message: "Ünvan axtarışı hazırda işləmir" });
  }
});

module.exports = router;
