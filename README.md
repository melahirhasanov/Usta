# Əlüstü — backend

Yaxınlıqdakı ustanı tapmaq üçün platformanın API-si: Express, MongoDB (Mongoose), Socket.io.
Frontend ayrıca repo-dadır. Canlı sayt: https://elustu.netlify.app

## İşə salma

```bash
npm ci
cp .env.example .env   # dəyərləri doldurun
npm run dev            # http://localhost:8080
npm test               # təhlükəsizlik testləri
```

## Struktur

| Qovluq | Məzmun |
|---|---|
| `config/` | Sabitlər: ixtisaslar, frontend ünvanı |
| `middleware/` | Giriş yoxlaması, sorğu limitləri, məlumat yoxlamaları |
| `models/` | Mongoose modelləri |
| `routes/` | REST endpoint-lər (`routes/admin/` — admin panel) |
| `services/` | Giriş, email, şifrə bərpası |
| `socket/` | Chat, zəng siqnalları, onlayn status, canlı izləmə |
| `scripts/` | `create-admin`, nümunə profillər |
| `test/` | Avtomatik testlər |

Təhlükəsizlik qaydaları: [SECURITY.md](SECURITY.md). Yayımlama: `render.yaml`.
