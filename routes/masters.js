const express = require("express")
const mongoose = require("mongoose")
const Master = require("../models/Master")
const Order = require("../models/Order")
const { requireAuth, requireRole } = require("../middleware/auth")
const { CATEGORIES } = require("../config/constants")
const { checkCoords, checkName, checkPhone, firstError } = require("../middleware/validate")
const { getSettings } = require("../models/SiteSettings")
const router = express.Router()

// İctimai sahələr: şifrə, bərpa tokeni və telefon nömrəsi heç vaxt qaytarılmır
// (müştəri ustaya saytdan zəng edir, nömrə paylaşılmır)
const PRIVATE_FIELDS = "-password -resetPasswordToken -resetPasswordExpires"
const PUBLIC_FIELDS = `${PRIVATE_FIELDS} -phone -email -followers -following -isBlocked -profileImageId -passwordChangedAt`

// Yolda olan və ya işi icra edən ustalar "məşğul" sayılır
async function busyMasterIds() {
    const ids = await Order.distinct("master", { status: { $in: ["on_the_way", "in_progress"] } })
    return new Set(ids.map(String))
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Ustaların siyahısı: ?search=&category=&city=
router.get("/", async (req, res) => {
    try {
        const { search, category, city } = req.query
        const query = { isBlocked: { $ne: true } }
        if (!(await getSettings()).showDemo) query.isDemo = { $ne: true }
        if (search) {
            const rx = { $regex: escapeRegex(String(search).slice(0, 80)), $options: "i" }
            query.$or = [{ name: rx }, { surname: rx }, { category: rx }, { city: rx }]
        }
        if (category) query.category = String(category)
        if (city) query.city = String(city)

        const [ustalar, busy] = await Promise.all([
            Master.find(query).select(PUBLIC_FIELDS).sort({ createdAt: -1 }).lean(),
            busyMasterIds(),
        ])
        res.json(ustalar.map((u) => ({ ...u, isAvailable: u.isAvailable !== false, isBusy: busy.has(String(u._id)) })))
    } catch (error) {
        console.error("Ustalar yüklənərkən xəta:", error)
        res.status(500).json({ message: "Ustalar yüklənmədi" })
    }
})

// Daxil olmuş ustanın öz profili (telefon daxil)
router.get("/me", requireAuth, requireRole("master"), async (req, res) => {
    const usta = await Master.findById(req.userId).select(PRIVATE_FIELDS)
    if (!usta) return res.status(404).json({ message: "Usta tapılmadı" })
    res.json(usta)
})

// Usta "sifariş qəbul edirəm" rejimini açıb-bağlayır
router.put("/me/availability", requireAuth, requireRole("master"), async (req, res) => {
    const isAvailable = Boolean(req.body.isAvailable)
    await Master.updateOne({ _id: req.userId }, { isAvailable })
    res.json({ isAvailable })
})

// Daxil olmuş ustanın öz profilini yeniləməsi
router.put("/me", requireAuth, requireRole("master"), async (req, res) => {
    try {
        const allowed = ["name", "surname", "phone", "city", "category", "bio", "experience"]
        const update = {}
        for (const key of allowed) {
            if (req.body[key] !== undefined) update[key] = req.body[key]
        }
        const invalid = firstError(
            update.name !== undefined ? checkName(update.name, "Ad") : null,
            update.surname !== undefined ? checkName(update.surname, "Soyad") : null,
            update.phone !== undefined ? checkPhone(update.phone) : null,
            update.category !== undefined && !CATEGORIES.includes(update.category) ? "İxtisas siyahıdan seçilməlidir" : null,
            update.bio !== undefined && (typeof update.bio !== "string" || update.bio.length > 600) ? "Bio 600 simvoldan çox ola bilməz" : null,
            update.city !== undefined && (typeof update.city !== "string" || update.city.length > 50) ? "Şəhər düzgün deyil" : null
        )
        if (invalid) return res.status(400).json({ message: invalid })
        if (update.phone !== undefined) update.phone = String(update.phone)
        if (update.experience !== undefined) update.experience = Math.max(0, Math.min(70, Number(update.experience) || 0))

        const { latitude, longitude } = req.body
        if (latitude != null && longitude != null) {
            const badCoords = checkCoords(latitude, longitude)
            if (badCoords) return res.status(400).json({ message: badCoords })
            update.location = { type: "Point", coordinates: [parseFloat(longitude), parseFloat(latitude)] }
        }

        const usta = await Master.findByIdAndUpdate(req.userId, update, { new: true, runValidators: true })
            .select(PRIVATE_FIELDS)
        if (!usta) return res.status(404).json({ message: "Usta tapılmadı" })
        res.json(usta)
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: "Bu telefon nömrəsi artıq istifadə olunur" })
        }
        console.error("Profil yenilənmədi:", error)
        res.status(400).json({ message: "Profil yenilənmədi" })
    }
})

router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ message: "Usta tapılmadı" })
        }
        const usta = await Master.findOne({ _id: id, isBlocked: { $ne: true } }).select(PUBLIC_FIELDS).lean()
        if (!usta || (usta.isDemo && !(await getSettings()).showDemo)) return res.status(404).json({ message: "Usta tapılmadı" })
        const busy = await Order.exists({ master: id, status: { $in: ["on_the_way", "in_progress"] } })
        res.json({ ...usta, isAvailable: usta.isAvailable !== false, isBusy: Boolean(busy) })
    } catch (error) {
        console.error("Usta yüklənərkən xəta:", error)
        res.status(500).json({ message: "Usta yüklənmədi" })
    }
})

module.exports = router
