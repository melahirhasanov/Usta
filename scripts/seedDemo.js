/**
 * Nümunə ustalar və işlər. Yalnız "masters" və "posts" kolleksiyalarına ƏLAVƏ edir, hər yazı isDemo: true olur.
 * Rəy, reytinq və tamamlanmış iş uydurulmur; hesablara giriş mümkün deyil; saytda "Nümunə profil" nişanı ilə görünür.
 *   node scripts/seedDemo.js            — yalnız plan (heç nə yazmır)
 *   node scripts/seedDemo.js --apply    — yazır
 *   node scripts/seedDemo.js --remove   — bütün nümunələri silir (real yazılara toxunmur)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;
const Master = require("../models/master");
const Post = require("../models/Post");
const { CATEGORIES } = require("../constants");

const PER_CATEGORY_BAKU = 5;
const BAKU = [["Nəsimi", 40.3925, 49.8425], ["Nərimanov", 40.4045, 49.8725], ["Yasamal", 40.3865, 49.8095], ["Xətai", 40.383, 49.895], ["Binəqədi", 40.46, 49.83], ["Sabunçu", 40.443, 49.948], ["Nizami", 40.3985, 49.9455]];
const REGIONS = [
  ["Sumqayıt", 40.5897, 49.6686], ["Gəncə", 40.6828, 46.3606], ["Mingəçevir", 40.77, 47.0489], ["Lənkəran", 38.7529, 48.8515],
  ["Şəki", 41.1975, 47.1571], ["Yevlax", 40.6172, 47.15], ["Şirvan", 39.9378, 48.929], ["Quba", 41.3611, 48.5134],
  ["Xaçmaz", 41.4591, 48.806], ["Şamaxı", 40.6314, 48.6414], ["Qəbələ", 40.9814, 47.8458], ["Bərdə", 40.3744, 47.1266],
  ["Masallı", 39.0341, 48.6654], ["Şəmkir", 40.8298, 46.0178], ["Naxçıvan", 39.2089, 45.4122],
];
const REGION_CATEGORIES = ["Santexnik", "Elektrikçi", "Kondisioner ustası", "Kombi ustası", "Mebel ustası", "Malyar (Rəngsaz)", "Təmizlik ustası", "Təmir-tikinti ustası"];
const NAMES = ["Elçin", "Rəşad", "Anar", "Vüqar", "Tural", "Ceyhun", "Emin", "Natiq", "Samir", "Fuad", "Ramil", "Orxan", "İlqar", "Mübariz", "Zaur", "Elnur", "Rövşən", "Kamran", "Nicat", "Pərviz"];
const SURNAMES = ["Məmmədov", "Əliyev", "Hüseynov", "Quliyev", "İsmayılov", "Abbasov", "Cəfərov", "Rzayev", "Kərimov", "Novruzov", "Səfərov", "Bayramov", "Nəbiyev", "Süleymanov", "Qasımov", "Musayev", "Babayev"];

// Sabit toxumlu təsadüf: hər işə salmada eyni nəticə
let seed = 20261125;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const jitter = (km) => ((rnd() - 0.5) * 2 * km) / 111;

function build() {
  const list = [];
  const add = (category, city, area, lat, lng, km) => {
    const n = list.length;
    const experience = 2 + Math.floor(rnd() * 18);
    list.push({
      name: pick(NAMES), surname: pick(SURNAMES), email: `numune${n}@elustu.invalid`, phone: `+99400${String(n).padStart(7, "0")}`,
      password: "!demo-giris-mumkun-deyil", city, category, experience, isDemo: true, isAvailable: true,
      bio: `${category} — ${area} və ətraf. Nümunə profil: saytda usta səhifəsinin necə göründüyünü göstərir.`,
      location: { type: "Point", coordinates: [lng + jitter(km), lat + jitter(km)] },
    });
  };
  CATEGORIES.forEach((c, ci) => {
    for (let i = 0; i < PER_CATEGORY_BAKU; i++) { const [area, lat, lng] = BAKU[(ci + i) % BAKU.length]; add(c, "Bakı", area, lat, lng, 1.2); }
  });
  for (const [city, lat, lng] of REGIONS) for (const c of REGION_CATEGORIES) add(c, city, city, lat, lng, 1.5);
  return list;
}

const TITLES = ["Nümunə iş 1", "Nümunə iş 2"];
const PALETTES = [["#0F766E", "#14B8A6"], ["#B45309", "#F59E0B"]];
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Hər ixtisas üçün 2 örtük şəkli (stok foto deyil: kiminsə real işi kimi görünməsin)
async function covers() {
  const map = {};
  for (const [ci, c] of CATEGORIES.entries()) {
    map[c] = [];
    for (let i = 0; i < 2; i++) {
      const [a, b] = PALETTES[i];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${a}"/><circle cx="${i ? 650 : 150}" cy="130" r="240" fill="${b}" opacity=".45"/><circle cx="${i ? 100 : 700}" cy="560" r="200" fill="${b}" opacity=".3"/><text x="400" y="300" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="46" font-weight="bold" fill="#fff">${xml(c)}</text><text x="400" y="360" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="28" fill="#fff">${TITLES[i]}</text></svg>`;
      const r = await cloudinary.uploader.upload(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, { public_id: `demo/cat-${ci}-${i}`, overwrite: true, format: "png" });
      map[c].push(r.secure_url);
    }
  }
  return map;
}

async function main() {
  const mode = process.argv[2];
  if (mode && !["--apply", "--remove"].includes(mode)) throw new Error("Naməlum parametr");
  await mongoose.connect(process.env.DB_URL);
  const before = { masters: await Master.countDocuments({ isDemo: { $ne: true } }), posts: await Post.countDocuments({ isDemo: { $ne: true } }) };

  if (mode === "--remove") {
    console.log("Silindi:", (await Post.deleteMany({ isDemo: true })).deletedCount, "iş,", (await Master.deleteMany({ isDemo: true })).deletedCount, "usta");
  } else {
    const masters = build();
    console.log(`Plan: ${masters.length} usta (Bakı ${masters.filter((m) => m.city === "Bakı").length}, rayonlar ${masters.filter((m) => m.city !== "Bakı").length}), ${masters.length * 2} iş`);
    if (mode === "--apply") {
      if (await Master.exists({ isDemo: true })) throw new Error("Nümunələr artıq var. Əvvəl --remove edin.");
      const media = await covers();
      const docs = await Master.insertMany(masters);
      const posts = await Post.insertMany(docs.flatMap((m) => media[m.category].map((url, i) => ({ user: m._id, title: TITLES[i], description: `${m.category} üçün nümunə paylaşım.`, media: url, mediaType: "image", isDemo: true }))));
      const byUser = new Map();
      posts.forEach((p) => byUser.set(String(p.user), [...(byUser.get(String(p.user)) || []), p._id]));
      await Master.bulkWrite(docs.map((m) => ({ updateOne: { filter: { _id: m._id, isDemo: true }, update: { posts: byUser.get(String(m._id)) } } })));
      console.log("Yazıldı:", docs.length, "usta,", posts.length, "iş");
    }
  }
  const after = { masters: await Master.countDocuments({ isDemo: { $ne: true } }), posts: await Post.countDocuments({ isDemo: { $ne: true } }) };
  console.log("Real yazılar (əvvəl → sonra):", before, "→", after);
  await mongoose.disconnect();
}

cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
main().catch((e) => { console.error("Xəta:", e.message); process.exit(1); });
