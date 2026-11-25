# Təhlükəsizlik

## Qorunma
- Şifrələr bcrypt ilə saxlanılır; bərpa tokenlərinin yalnız SHA-256 hash-ı yazılır.
- JWT alqoritmi sabitdir (HS256); şifrə dəyişəndə və ya hesab bloklananda köhnə tokenlər işləmir.
- Müştəri email-i və telefon ictimai API-də və onlayn siyahıda qaytarılmır.
- Söhbətə yalnız iki iştirakçı daxil olur; usta yalnız əlaqəsi olan müştəriyə zəng edə bilir.
- Giriş cəhdləri IP və hesab üzrə məhduddur; Mongo operatorları təmizlənir.
- Yüklənən profil şəklinin formatı baytlarına görə yoxlanılır və çevrilir (EXIF/GPS silinir).
- Admin əməliyyatları jurnala yazılır.

## Qaydalar
- `.env`, ehtiyat nüsxələr və istifadəçi məlumatı heç vaxt repo-ya əlavə edilmir.
- Yeni endpoint: əvvəl giriş (`requireAuth`), sonra sahiblik yoxlaması, yalnız lazım olan sahələr.

## Boşluq bildirmək
İctimai issue açmayın — GitHub-da repo-nun **Security → Report a vulnerability** bölməsindən yazın.
