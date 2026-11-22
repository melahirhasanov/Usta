// Frontend-in src/constants/data.js faylındakı siyahı ilə eyni olmalıdır
const CATEGORIES = [
  "Alçıpan ustası", "Avtomobil elektrik ustası", "Avtomobil təmiri ustası", "Bərbər", "Çilingər",
  "Dülgər", "Elektrikçi", "Fasad ustası", "Fayans ustası", "Hovuz ustası",
  "İsitmə və soyutma ustası", "İşıqlandırma ustası", "İT mütəxəssisi", "Kafel ustası",
  "Kanalizasiya ustası", "Kombi ustası", "Kondisioner ustası", "Laminat ustası", "Loyiha ustası",
  "Malyar (Rəngsaz)", "Mebel ustası", "Metal konstruksiya ustası", "Metlax ustası", "Mühəndis",
  "Musiqi alətləri təmiri ustası", "Oboy ustası", "Parket ustası", "Pəncərə ustası", "Pol ustası",
  "Qapı ustası", "Qaz ustası", "Santexnik", "Şüşə ustası", "Tavan ustası", "Təmizlik ustası",
  "Tikinti ustası", "Toxuculuq ustası", "Təmir-tikinti ustası", "Usta-memar", "Vitraj ustası",
  "Vulkanizasiya ustası", "Xalça ustası", "Yanğın təhlükəsizliyi ustası",
  "Yüksəkmərtəbəli bina ustası", "Zinət əşyaları ustası", "Zolaq çəkmə ustası"
];

// Yayımlanmış frontend: FRONTEND_URL təyin edilməyəndə istifadə olunur (CORS və şifrə bərpası linkləri)
const DEFAULT_FRONTEND_URL = process.env.NODE_ENV === "production" ? "https://steady-tarsier-317aaf.netlify.app" : "http://localhost:5173";
const FRONTEND_URL = (process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL).split(",")[0].trim().replace(/\/+$/, "");

module.exports = { CATEGORIES, FRONTEND_URL };
