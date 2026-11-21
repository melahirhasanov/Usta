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

module.exports = router;
