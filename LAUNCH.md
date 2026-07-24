# دليل الإطلاق — Talah Platform

## ترتيب التشغيل

### 1. قاعدة البيانات (Supabase → SQL Editor)
شغّل الملفات بالترتيب ده، كل واحد مرة واحدة بس:
1. `supabase/schema.sql` ✅ (اتعمل)
2. `supabase/auth.sql` ✅ (اتعمل)
3. `supabase/ops.sql` ← فيه دور المطعم + نظام استلام الطلبات
4. `supabase/launch.sql` ← فيه وقت التحضير + فترات التوصيل + الإعدادات

### 2. حسابات الدخول
الحسابات الحالية اتعملت بباسوردات ظهرت في الشات — **غيّرها**:

```sql
update auth.users
set encrypted_password = extensions.crypt('الباسورد_الجديد', extensions.gen_salt('bf'))
where email = 'admin@talah.app';
```
كرر لكل حساب.

### 3. حساب لكل مطعم
```sql
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
  'authenticated', 'vendorX@talah.app',
  extensions.crypt('باسورد', extensions.gen_salt('bf')),
  now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', ''
where not exists (select 1 from auth.users where email = 'vendorX@talah.app');

insert into auth.identities (id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email', u.id::text, now(), now(), now()
from auth.users u where u.email = 'vendorX@talah.app'
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

insert into profiles (id, role, restaurant_id, name)
select u.id, 'vendor', <رقم_المطعم>, '<اسم المطعم>' from auth.users u
where u.email = 'vendorX@talah.app'
on conflict (id) do update set role = 'vendor', restaurant_id = <رقم_المطعم>;
```

### 4. فترات التوصيل للسوبر ماركت
```sql
insert into delivery_slots (restaurant_id, start_time, end_time, capacity) values
  (<رقم_السوبر_ماركت>, '12:00', '14:00', 6),
  (<رقم_السوبر_ماركت>, '18:00', '20:00', 6);
```
الـ capacity = أقصى عدد طلبات تقدر توصّلها في الفترة دي. اربطها بعدد المندوبين مش بسرعة السوبر ماركت.

### 5. البيانات الحقيقية
كل البيانات الحالية تجريبية. من `/admin` → تبويب **المطاعم والمنيو**:
- عدّل الأسعار والأصناف
- اضبط وقت التحضير لكل مطعم
- حدّد إذا كان مطعم ولا سوبر ماركت

المندوبين والمناطق لسه محتاجين تعديل مباشر:
```sql
update drivers set name = '...', phone = '+20...' where id = 1;
update zones set name = '...' where id = 1;
```

## الروابط
| مين | الرابط | دخول |
|---|---|---|
| العميل | `/` | مفيش |
| طلباتي | `/my-orders` | مفيش — بالموبايل |
| المطعم | `/vendor` | إيميل وباسورد |
| المندوب | `/driver` | إيميل وباسورد |
| الإدارة | `/admin` | إيميل وباسورد |

## التنبيهات
التطبيق بيعمل صوت + إشعار متصفح لما يجي طلب جديد (للإدارة والمطعم والمندوب).
لازم الصفحة تفضل مفتوحة. أول مرة هيطلب إذن الإشعارات — وافق.

## اللي لسه مؤجل
- الشاليهات (مخفية من القائمة، الصفحة لسه موجودة على `/chalets`)
- الطلبات المخصصة (اطلب أي حاجة)
- الجزارة والأسماك والدواجن كأنواع منفصلة
- تجميع أكتر من طلب في رحلة واحدة للمندوب

## نظام الورديات (جديد)

### 6. تفعيل الورديات
شغّل `supabase/shifts.sql` في SQL Editor بعد `launch.sql`.

### إزاي بيشتغل
1. إنت بتضيف الورديات من `/admin` → تبويب **الورديات**
2. المندوب بيشوف ورديته القادمة في `/driver` وممكن يطلب استبدال (مع سبب اختياري)
3. أي مندوب تاني بيشوف طلبات الاستبدال المفتوحة في نفس الصفحة ويقدر يقبلها بضغطة واحدة
4. لو محدش قبل، المندوب بيضغط "محدش وافق — بلّغ الإدارة" والطلب يظهر فوق في تبويب الورديات عندك بعلامة تحذير حمراء
