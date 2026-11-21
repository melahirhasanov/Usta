// Ümumi təhlükəsizlik middleware-ləri: NoSQL injection təmizləmə və sorğu limiti

// "$" ilə başlayan və ya "." olan açarları silir: { email: { $ne: null } } kimi Mongo operator
// injection-larının qarşısını alır (məs. şifrə bərpasında başqasının hesabını tapmaq)
function stripOperators(value) {
  if (Array.isArray(value)) return value.map(stripOperators);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (key.startsWith("$") || key.includes(".")) delete value[key];
      else value[key] = stripOperators(value[key]);
    }
  }
  return value;
}

function sanitize(req, res, next) {
  stripOperators(req.body);
  stripOperators(req.query);
  stripOperators(req.params);
  next();
}

/**
 * Sadə yaddaşdaxili sorğu limiti (tək server üçün kifayətdir; bir neçə server olarsa Redis lazımdır).
 * windowMs ərzində eyni açardan (standart: IP + marşrut) ən çox `max` sorğu.
 */
function rateLimit({ windowMs, max, message = "Çox sayda sorğu göndərildi. Bir az sonra yenidən cəhd edin.", key }) {
  const hits = new Map(); // key -> { count, resetAt }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const id = key ? key(req) : `${req.ip}|${req.baseUrl}${req.path}`;
    const now = Date.now();
    const entry = hits.get(id);
    if (!entry || entry.resetAt <= now) {
      hits.set(id, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }
    next();
  };
}

const MIN = 60 * 1000;

// Hazır limitlər
const limits = {
  // Giriş, qeydiyyat, şifrə bərpası: brute-force-a qarşı
  auth: rateLimit({ windowMs: 15 * MIN, max: 10, message: "Çox sayda cəhd. 15 dəqiqə sonra yenidən yoxlayın." }),
  // Bərpa emaili: eyni IP-dən saatda 5
  passwordReset: rateLimit({ windowMs: 60 * MIN, max: 5, message: "Çox sayda bərpa sorğusu. Bir saat sonra yenidən yoxlayın." }),
  // Sifariş və şikayət yaratmaq: spam-a qarşı
  create: rateLimit({ windowMs: 60 * MIN, max: 30, key: (req) => `${req.ip}|create|${req.baseUrl}` }),
  // Marşrut proxy-si (xarici OSRM servisini qorumaq üçün)
  routing: rateLimit({ windowMs: MIN, max: 60, key: (req) => `${req.ip}|routing` }),
  // Ümumi API limiti
  api: rateLimit({ windowMs: MIN, max: 600, key: (req) => `${req.ip}|api` }),
};

module.exports = { sanitize, rateLimit, limits, stripOperators };
