// Qeydiyyat və profil üçün ortaq yoxlamalar. Xəta varsa mətn, yoxdursa null qaytarır.
const EMAIL_RE = /^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

const str = (v) => typeof v === "string";

function checkEmail(email) {
  if (!str(email) || email.length > 120 || !EMAIL_RE.test(email.trim())) return "Email düzgün deyil";
  return null;
}

function checkPassword(password) {
  if (!str(password) || password.length < 8) return "Şifrə ən azı 8 simvol olmalıdır";
  if (Buffer.byteLength(password) > 72) return "Şifrə çox uzundur (ən çox 72 bayt)"; // bcrypt 72 baytdan sonrasını nəzərə almır
  return null;
}

function checkName(value, label) {
  if (!str(value) || value.trim().length < 2 || value.trim().length > 50) return `${label} 2-50 simvol olmalıdır`;
  return null;
}

function checkPhone(phone, required = true) {
  if (phone == null || phone === "") return required ? "Telefon nömrəsi tələb olunur" : null;
  if (!/^\d{9,15}$/.test(String(phone))) return "Telefon nömrəsi yalnız rəqəmlərdən ibarət olmalıdır (9-15)";
  return null;
}

function checkCoords(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return "Xəritədə yer düzgün seçilməyib";
  return null;
}

const firstError = (...errors) => errors.find(Boolean) || null;

module.exports = { checkEmail, checkPassword, checkName, checkPhone, checkCoords, firstError };
