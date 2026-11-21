// Qeydiyyat və profil üçün ortaq yoxlamalar. Xəta varsa mətn, yoxdursa null qaytarır.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v) => typeof v === "string";

function checkEmail(email) {
  if (!str(email) || email.length > 120 || !EMAIL_RE.test(email.trim())) return "Email düzgün deyil";
  return null;
}

function checkPassword(password) {
  if (!str(password) || password.length < 6) return "Şifrə ən azı 6 simvol olmalıdır";
  if (password.length > 128) return "Şifrə çox uzundur";
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
