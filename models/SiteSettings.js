const mongoose = require("mongoose");

// Saytın ümumi parametrləri — tək sənəd (key: "main"), admin paneldən idarə olunur
const schema = new mongoose.Schema(
  {
    key: { type: String, default: "main", unique: true },
    announcement: { type: String, trim: true, maxlength: 300, default: "" },
    announcementActive: { type: Boolean, default: false },
    registrationEnabled: { type: Boolean, default: true },
    ordersEnabled: { type: Boolean, default: true },
    showDemo: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "elustu_settings" } // baza başqa layihələrlə ortaqdır
);

const FIELDS = ["announcement", "announcementActive", "registrationEnabled", "ordersEnabled", "showDemo"];
const Model = mongoose.model("SiteSettings", schema);

let cache = null;
let cachedAt = 0;
async function getSettings() {
  if (cache && Date.now() - cachedAt < 15000) return cache;
  const doc = (await Model.findOne({ key: "main" }).lean()) || new Model().toObject();
  cache = Object.fromEntries(FIELDS.map((f) => [f, doc[f]]));
  cachedAt = Date.now();
  return cache;
}
async function saveSettings(update) {
  await Model.updateOne({ key: "main" }, { $set: update }, { upsert: true, runValidators: true });
  cache = null;
  return getSettings();
}

module.exports = { getSettings, saveSettings, FIELDS };
