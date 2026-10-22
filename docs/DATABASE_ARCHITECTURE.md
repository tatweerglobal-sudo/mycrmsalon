# معمارية قاعدة بيانات My CRM Salon SaaS (Database Architecture)

تم تصميم معمارية قاعدة البيانات خصيصاً لمراكز التجميل والصالونات غير الطبية بنظام متعدد المستأجرين (Multi-Tenant SaaS)، متوافقة مع محرك **PostgreSQL 14+** وخدمة **Neon Cloud Database**.

---

## 1. المبادئ الأساسية للتصميم والتحصين الأمني

1. **معرفات UUID v4:** استخدام `gen_random_uuid()` كمفاتيح أساسية لجميع الجداول لمنع التخمين وحماية خصوصية السجلات.
2. **عزل المستأجر الإلزامي (Strict Tenant Isolation):** كل جدول فرعي يحتوي على عمود `tenant_id` غير قابل للقيمة الفارغة (`NOT NULL`) ومرتبط بجدول `tenants(id)` مع الحذف التتابعي `ON DELETE CASCADE`.
3. **فرض أمان الصفوف الإجباري (FORCE ROW LEVEL SECURITY):**
   - تم تفعيل وفرض `FORCE ROW LEVEL SECURITY` على جميع جداول المستأجر.
   - هذا يمنع تجاوز سياسات الـ RLS حتى لمستخدمي الاتصال ومالكي الجداول (Table Owners).
4. **دور تشغيلي مقيد محظور من تجاوز RLS (Dedicated App Role):**
   - التطبيق يتصل عبر دور `salon_app_role` الممنوح صراحة `NOBYPASSRLS` و `NOSUPERUSER`.
   - لا يمكن لأي استعلام صادر من التطبيق تجاوز عزل المستأجرين تحت أي ظرف.
5. **مفاتيح أجنبية مركبة متسقة مع المستأجر (Tenant-Consistent Composite Foreign Keys):**
   - لمنع ربط سجلات مستأجر بسجلات مستأجر آخر (Cross-Tenant Foreign Key Injection)، تعتمد العلاقات على مفاتيح مركبة تشمل `(tenant_id, id)`:
     - `branches`: `CONSTRAINT uq_branches_tenant_id UNIQUE (tenant_id, id)`
     - `salon_staff`: `FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)`
     - `customers`: `CONSTRAINT uq_customers_tenant_id UNIQUE (tenant_id, id)`
     - `services`: `FOREIGN KEY (tenant_id, category_id) REFERENCES service_categories(tenant_id, id)`
     - `appointments`:
       - `FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)`
       - `FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)`
       - `FOREIGN KEY (tenant_id, staff_id) REFERENCES salon_staff(tenant_id, id)`
     - `appointment_services`:
       - `FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id)`
       - `FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id)`
   - **النتيجة:** قاعدة البيانات نفسها ترفض فورياً أي حجز لموعد في مركز أ يشير إلى عميلة أو فرع أو خبيرة تتبع مركز ب.
6. **فرادة أرقام الهواتف المحصورة بالمستأجر (Tenant-Scoped Phone Uniqueness):**
   - تم تصميم قيد فريد مركب: `UNIQUE(tenant_id, phone_normalized)`.
   - هذا يتيح لنفس العميلة التسجيل في أكثر من صالون مختلف على المنصة دون تضارب، بينما يمنع تماماً تكرار تسجيلها داخل الصالون الواحد.

---

## 2. مخطط الجداول (Entity-Relationship Overview)

### أ. المستأجرين والفروع والمستخدمين (Tenants & Branches & Users)
- **`tenants`**: بيانات مركز التجميل، النطاق، العملة، المنطقة الزمنية، حالة الاشتراك (`trial`, `active`, `suspended`)، والحدود القصوى للفروع والموظفين.
- **`branches`**: فروع المركز، العناوين، وأوقات العمل الأسبوعية.
- **`users`**: الحسابات الشخصية الموحدة، البريد، الهاش المشفر لكلمة المرور (bcrypt)، قفل الحساب المؤقت، وإصدار التوكن `token_version` للإبطال الفوري للجلسات.
- **`memberships`**: جدول الربط بين المستخدم والمركز مع تحديد الدور والفرع المسند.

### ب. الكادر التجميلي (Staff)
- **`salon_staff`**: ملفات خبيرات وأخصائيات التجميل، التخصصات، نسب العمولات، وجداول الدوام.
- **`staff_services`**: ربط الخبيرات بالخدمات المعتمدة لهن مع إمكانية تحديد تسعير أو مدة خاصة بكل خبيرة.

### ج. العملاء (CRM)
- **`customers`**: ملفات العملاء، الأسماء، الأرقام بالصيغة الدولية E.164، التفضيلات، الملاحظات الشخصية، نقاط الولاء، وسجل الإنفاق التراكمي.

### د. الخدمات غير الطبية (Services)
- **`service_categories`**: تصنيفات الخدمات (عناية بالشعر، أظافر، مكياج، سبا، بشرة غير طبية).
- **`services`**: تفاصيل كل خدمة، المدة بالدقائق، فترات الراحة/التعقيم (`buffer_minutes`)، والأسعار.

### هـ. المواعيد والحجوزات (Appointments)
- **`appointments`**: المواعيد، وقت البدء والانتهاء، العميل، الخبيرة، الفرع، حالة الموعد (`booked`, `confirmed`, `in_progress`, `completed`, `cancelled`)، وحالة السداد.
- **`appointment_services`**: الخدمات المحددة في كل موعد مع السعر الفعلي والمدة.

### و. الأمان وتحديد معدل الطلبات (Security & Rate Limits)
- **`auth_rate_limits`**: جدول الحالة المشتركة لتحديد معدل الطلبات وحماية نقاط الدخول في البيئات الموزعة.
- **`audit_logs`**: تسجيل كافة الحركات الحساسة (تسجيل الدخول، تعديل الأسعار، إلغاء المواعيد، حذف العملاء) مع حفظ الـ IP والـ User-Agent.

---

## 3. آلية تطبيق التحديثات (Migrations)

تتم إدارة الترقيات عبر ملفات تتابعية داخل مجلد `migrations/`:
- `001_initial_saas_schema.sql`: البنية التأسيسية الشاملة مع FORCE RLS والمفاتيح المركبة.
- يتم التتبع التلقائي للترقيات المنفذة عبر جدول `_schema_migrations`.
- السكريبت المعتمد للترقية: `npm run migrate` عبر `tsx scripts/migrate.ts`.
- التراجع التلقائي (Rollback): عند حدوث أي خطأ في أي جملة SQL، تتراجع المعاملة بالكامل ولا يتم تسجيل الإصدار كمنفذ.
