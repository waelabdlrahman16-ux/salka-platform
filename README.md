# سالكة — Salka Platform (Pilot)

Village marketplace for Telal El Sokhna: restaurant delivery + chalet bookings + full driver system.
Your code, your data — free hosting (Vercel + Supabase free tiers).

## Architecture rule (do not break)
Driver NEVER goes on `orders`. The chain is always:
`Order → delivery_assignment → Driver`. Every rejection = new assignment row with `attempt_number + 1`. Full history preserved.

## Screens
| Route | Who | What |
|---|---|---|
| `/` | Customer | Restaurants list |
| `/restaurant/:id` | Customer | Menu → cart → checkout (name, phone, zone, unit, landmark) |
| `/chalets` | Customer | Chalet listings + booking |
| `/track/:id` | Customer | Order tracking, auto-refresh 10s, driver name + phone |
| `/admin` | Admin | Unassigned orders, active deliveries, driver management, all orders, bookings, earnings |
| `/driver/:id` | Driver | Offers → accept/reject(+reason) → picked up → out → delivered. Earnings auto-created (50 = 40 driver + 10 platform) |

## Setup (one time, ~20 minutes)

### 1. Database — Supabase (free)
1. Create account at https://supabase.com → **New project** (free plan)
2. Wait for the project to initialize
3. Open **SQL Editor** → **New query** → paste ALL of `supabase/schema.sql` → **Run**
4. Go to **Project Settings → API** and copy:
   - `Project URL`
   - `anon public` key

### 2. Local run (optional)
```bash
npm install
cp .env.example .env        # paste your URL + anon key inside
npm run dev
```

### 3. Deploy — Vercel (free)
1. Push this folder to a GitHub repository
2. https://vercel.com → **Add New → Project** → import the repo
3. In **Environment Variables** add:
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
4. **Deploy**. Done — you get a permanent URL. Add a custom domain later from Vercel settings.

### 4. Share it
- Customers: the main URL (WhatsApp groups + printed QR at gates/restaurants)
- Drivers: `yoururl.vercel.app/driver/1` (each driver gets their own id link)
- Admin: `yoururl.vercel.app/admin`
- "Add to Home Screen" on any phone = app-like icon, no store needed

## Business settings (edit in code)
`src/lib/supabase.ts`: `DELIVERY_FEE = 50`, `DRIVER_EARNING = 40`, `ADMIN_AMOUNT = 10`

## Auth & roles setup (run once, after schema.sql)

1. **SQL Editor** → paste `supabase/auth.sql` → Run
2. **Authentication → Users → Add user** (tick *Auto Confirm User*) for each:
   - `admin@salka.app` — you
   - `driver1@salka.app`, `driver2@salka.app`, `driver3@salka.app`
3. **SQL Editor** → paste `supabase/link-users.sql` → Run (gives each user their role + driver link)

### How access works now
| Who | URL | Login |
|---|---|---|
| Customer | `/` | none — orders with name, phone, zone, unit |
| Customer tracking | `/track/<token>` | none — private token link, not guessable |
| Driver | `/driver` | yes — sees only HIS assignments |
| Admin | `/admin` | yes — assign drivers, monitor, earnings |

Wrong role is redirected to its own screen. A logged-in user with no profile row sees "account not activated".

### What changed in the database
- Open pilot policies removed; every table now has role-based row-level security
- Orders are created through the `place_order` function (customers never write to tables directly)
- Tracking goes through `track_order(token)` — order IDs can no longer be enumerated to read customer names and phones

## Next increments (in order)
1. Rejection → reassignment test (attempt_number 2)
2. PWA manifest + icons (Add to Home Screen looks native)
3. Custom orders — "اطلب أي حاجة" (Mrsool pattern)
4. Supermarket + food vendors (butcher / fish / poultry)
5. Nawy-style property details (photos, amenities, WhatsApp)
