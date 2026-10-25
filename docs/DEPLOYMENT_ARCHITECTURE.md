# معمارية النشر والتطوير (Deployment Architecture)

يعتمد مشروع **My CRM Salon SaaS** معمارية نشر مزدوجة ومنفصلة تماماً (Decoupled Deployment Architecture) لضمان الأمان والسرعة.

---

## 1. البيئتان المنفصلتان

```
┌──────────────────────────────────────────────┐
│  1. Static Frontend Preview (Hostinger)      │
│  - Domain: crmsalon.de                       │
│  - Output: out/ (HTML, CSS, Static JS)       │
│  - No Node.js execution                      │
│  - No Database Credentials in Browser        │
│  - Branch: feature/beauty-saas-foundation    │
└──────────────────────────────────────────────┘
                       ▲
                       │ (API Calls over HTTPS)
                       ▼
┌──────────────────────────────────────────────┐
│  2. SaaS Core Backend (Secure Node / Neon)   │
│  - Next.js API Routes / Node.js Server       │
│  - Private Neon PostgreSQL Database          │
│  - Server Sessions, Cookies, RLS Enforcement │
│  - Strict Tenant Context                     │
│  - Branch: feature/salon-phase-01-core       │
└──────────────────────────────────────────────┘
```

---

## 2. قواعد أمان النشر الصارمة

1. **الموقع المباشر الحالي (`crmsalon.de`):**
   - يعمل كنسخة معاينة ثابتة (Static Preview) عبر استضافة HTML العادية.
   - يمنع منعاً باتاً استدعاء مكتبة `pg` أو وضع سلاسل اتصال Neon داخل ملفات Client Component في React.
2. **عزل فرع التطوير (`feature/salon-phase-01-core`):**
   - هذا الفرع مخصص للأعمال الأساسية والمعمارية (Phase 1).
   - غير مربوط بأي نشر تلقائي على Hostinger لحماية الموقع الحي المباشر.
3. **أوامر البناء المعتمدة:**
   - البناء الكامل للتطوير والـ CI: `npm run build`
   - بناء النسخة الثابتة للمعاينة: `npm run build:static`
   - إنتاج حزمة ZIP النظيفة لـ `public_html`: `npm run package:static`
4. **حماية أسرار البيئة:**
   - ملفات `.env` و `.env.local` مدرجة في `.gitignore` وممنوعة من الرفع لمستودع GitHub.
