# Resort Manager MCP — Implementation Plan

> **Status:** Implemented
> **Author:** Claude + Russell
> **Date:** 2026-03-20
> **Scope:** Single MCP app (`resort-manager`) with D1 database for ski/golf resort operations
> **Platform:** Ultralight (Cloudflare D1, Deno sandbox, MCP protocol)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Database Schema](#3-database-schema)
4. [Room Registry & Seeding](#4-room-registry--seeding)
5. [Function Inventory](#5-function-inventory)
6. [Email Agent System](#6-email-agent-system)
7. [Approval Queue](#7-approval-queue)
8. [AI Integration](#8-ai-integration)
9. [Database Browse & Admin Access](#9-database-browse--admin-access)
10. [Manifest & Permissions](#10-manifest--permissions)
11. [Implementation Sprints](#11-implementation-sprints)
12. [Metering & Cost Projections](#12-metering--cost-projections)
13. [Risk Register](#13-risk-register)
14. [File Map](#14-file-map)
15. [Appendix: Room Directory](#15-appendix-room-directory)

---

## 1. System Overview

A single Ultralight MCP that manages all operations for a ski/golf resort:

- **Room reservations** — 180+ rooms across buildings 4–8, four tiers
- **Ski equipment rentals** — inventory tracking, multi-item rentals, Tohoku pass support
- **Ski lesson bookings** — instructor scheduling
- **Golf tee times** — hole assignments, cart tracking, party management
- **Restaurant reservations** — party size, set menus, allergy tracking
- **Resort store** — product inventory, transaction history
- **Resort guidelines** — key-value reference data (policies, rates, hours, contacts)
- **Email agent** — inbound classification, AI-drafted replies, admin approval queue
- **Admin chatbot** — natural language interface via Ultralight Desktop

### Design Principles

1. **Single MCP, single D1** — all tables in one database for cross-domain JOINs
2. **`room_number` as the universal join key** — every service references a room
3. **`guest_name` as human identifier** — guests don't have accounts, identified by name + room
4. **Admin-owned data** — one `user_id` (resort admin), staff access via `ul.permissions`
5. **Approval-gated mutations** — email replies and AI-suggested DB changes queue for review
6. **Convention-compliant** — follows `ultralight-spec/` exactly

---

## 2. Architecture

```
                    ┌─────────────────────────────────────────┐
                    │            ULTRALIGHT PLATFORM          │
                    │                                         │
                    │  ┌───────────────────────────────────┐  │
                    │  │      resort-manager MCP            │  │
                    │  │      (one D1 database)             │  │
                    │  │                                    │  │
                    │  │  ┌──────────┐  ┌───────────────┐  │  │
                    │  │  │  DOMAIN  │  │   CROSS-CUT   │  │  │
                    │  │  │          │  │               │  │  │
                    │  │  │ rooms_*  │  │ guest_*       │  │  │
                    │  │  │ ski_*    │  │ approvals_*   │  │  │
                    │  │  │ golf_*   │  │ email_*       │  │  │
                    │  │  │ rest_*   │  │ guidelines_*  │  │  │
                    │  │  │ store_*  │  │ report_*      │  │  │
                    │  │  │          │  │ db_browse     │  │  │
                    │  │  └──────────┘  └───────────────┘  │  │
                    │  └──────────┬────────────────────────┘  │
                    │             │                            │
                    │    ┌────────┴────────┐                   │
                    │    │                 │                   │
                    │  ┌─▼───────────┐  ┌─▼───────────────┐   │
                    │  │  DESKTOP    │  │  EMAIL TRIGGER   │   │
                    │  │  CHATBOT    │  │                  │   │
                    │  │             │  │  CF Worker cron  │   │
                    │  │  Admin &    │  │  or Resend       │   │
                    │  │  staff      │  │  inbound webhook │   │
                    │  │  natural    │  │       │          │   │
                    │  │  language   │  │       ▼          │   │
                    │  │  queries    │  │  email_process() │   │
                    │  │  + approval │  │  email_send()    │   │
                    │  └─────────────┘  └─────────────────┘   │
                    └─────────────────────────────────────────┘
```

### Access Patterns

| Actor | Interface | Capabilities |
|-------|-----------|-------------|
| Resort admin (father-in-law) | Desktop chatbot | Full CRUD, approvals, reports, DB browse |
| Front desk staff | Desktop (granted) | rooms_*, guest_*, restaurant_* |
| Ski shop staff | Desktop (granted) | ski_* only |
| Golf pro shop | Desktop (granted) | golf_* only |
| Store clerk | Desktop (granted) | store_* only |
| Email agent | Automated trigger | email_process, email_send (approval-gated) |

---

## 3. Database Schema

### Migration `001_initial.sql` — Core Tables

12 tables, all following `ultralight-spec/conventions/d1-schema.md`:

```sql
-- ============================================================
-- RESORT MANAGER — Migration 001: Core Tables
-- ============================================================

-- 1. ROOMS — Static registry of all 180+ rooms
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    room_number TEXT NOT NULL,
    building INTEGER NOT NULL,
    floor_room INTEGER NOT NULL,
    tier TEXT NOT NULL,
    listed_price REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'available',
    current_reservation_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rooms_user ON rooms(user_id);
CREATE UNIQUE INDEX idx_rooms_user_number ON rooms(user_id, room_number);
CREATE INDEX idx_rooms_tier ON rooms(user_id, tier);
CREATE INDEX idx_rooms_status ON rooms(user_id, status);

-- 2. ROOM RESERVATIONS
CREATE TABLE IF NOT EXISTS room_reservations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    room_number TEXT NOT NULL,
    guest_name TEXT NOT NULL,
    num_guests INTEGER NOT NULL DEFAULT 1,
    nights_staying INTEGER NOT NULL DEFAULT 1,
    check_in_date TEXT NOT NULL,
    check_out_date TEXT NOT NULL,
    group_name TEXT,
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_amount REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'confirmed',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_room_res_user ON room_reservations(user_id);
CREATE INDEX idx_room_res_room ON room_reservations(user_id, room_number);
CREATE INDEX idx_room_res_guest ON room_reservations(user_id, guest_name);
CREATE INDEX idx_room_res_dates ON room_reservations(user_id, check_in_date, check_out_date);
CREATE INDEX idx_room_res_status ON room_reservations(user_id, status);

-- 3. SKI EQUIPMENT INVENTORY
CREATE TABLE IF NOT EXISTS ski_equipment (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    brand TEXT,
    product TEXT,
    size TEXT,
    gender TEXT,
    qty_total INTEGER NOT NULL DEFAULT 0,
    qty_rented INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ski_equip_user ON ski_equipment(user_id);
CREATE INDEX idx_ski_equip_cat ON ski_equipment(user_id, category);

-- 4. SKI RENTALS
CREATE TABLE IF NOT EXISTS ski_rentals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    guest_name TEXT NOT NULL,
    room_number TEXT,
    tohoku_pass INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_amount REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ski_rental_user ON ski_rentals(user_id);
CREATE INDEX idx_ski_rental_guest ON ski_rentals(user_id, guest_name);
CREATE INDEX idx_ski_rental_room ON ski_rentals(user_id, room_number);
CREATE INDEX idx_ski_rental_status ON ski_rentals(user_id, status);

-- 5. SKI RENTAL ITEMS (junction: rental ↔ equipment)
CREATE TABLE IF NOT EXISTS ski_rental_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    rental_id TEXT NOT NULL,
    equipment_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ski_items_user ON ski_rental_items(user_id);
CREATE INDEX idx_ski_items_rental ON ski_rental_items(user_id, rental_id);
CREATE INDEX idx_ski_items_equip ON ski_rental_items(user_id, equipment_id);

-- 6. SKI LESSONS
CREATE TABLE IF NOT EXISTS ski_lessons (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    lesson_date TEXT NOT NULL,
    lesson_time TEXT NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    instructor TEXT,
    guest_name TEXT NOT NULL,
    room_number TEXT,
    num_students INTEGER DEFAULT 1,
    skill_level TEXT,
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_amount REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ski_lesson_user ON ski_lessons(user_id);
CREATE INDEX idx_ski_lesson_date ON ski_lessons(user_id, lesson_date);
CREATE INDEX idx_ski_lesson_instructor ON ski_lessons(user_id, instructor);

-- 7. TEE TIMES
CREATE TABLE IF NOT EXISTS tee_times (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tee_date TEXT NOT NULL,
    tee_time TEXT NOT NULL,
    guest_name TEXT NOT NULL,
    room_number TEXT,
    starting_hole INTEGER NOT NULL DEFAULT 1,
    num_in_party INTEGER NOT NULL DEFAULT 1,
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_amount REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tee_user ON tee_times(user_id);
CREATE INDEX idx_tee_date ON tee_times(user_id, tee_date);
CREATE INDEX idx_tee_guest ON tee_times(user_id, guest_name);

-- 8. TEE TIME CART ASSIGNMENTS (junction: tee_time ↔ cart)
CREATE TABLE IF NOT EXISTS tee_time_carts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tee_time_id TEXT NOT NULL,
    cart_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tee_carts_user ON tee_time_carts(user_id);
CREATE INDEX idx_tee_carts_tee ON tee_time_carts(user_id, tee_time_id);

-- 9. RESTAURANT RESERVATIONS
CREATE TABLE IF NOT EXISTS restaurant_reservations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    res_date TEXT NOT NULL,
    res_time TEXT NOT NULL,
    num_people INTEGER NOT NULL DEFAULT 1,
    set_menu TEXT,
    allergies TEXT,
    guest_name TEXT NOT NULL,
    room_number TEXT,
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rest_res_user ON restaurant_reservations(user_id);
CREATE INDEX idx_rest_res_date ON restaurant_reservations(user_id, res_date);
CREATE INDEX idx_rest_res_guest ON restaurant_reservations(user_id, guest_name);

-- 10. STORE PRODUCTS
CREATE TABLE IF NOT EXISTS store_products (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    brand TEXT,
    price REAL NOT NULL DEFAULT 0,
    qty_available INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_store_prod_user ON store_products(user_id);
CREATE INDEX idx_store_prod_cat ON store_products(user_id, category);

-- 11. STORE TRANSACTIONS
CREATE TABLE IF NOT EXISTS store_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    guest_name TEXT,
    room_number TEXT,
    payment_method TEXT,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_amount REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_store_tx_user ON store_transactions(user_id);
CREATE INDEX idx_store_tx_product ON store_transactions(user_id, product_id);
CREATE INDEX idx_store_tx_guest ON store_transactions(user_id, guest_name);

-- 12. RESORT GUIDELINES (key-value + category)
CREATE TABLE IF NOT EXISTS guidelines (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_guidelines_user ON guidelines(user_id);
CREATE UNIQUE INDEX idx_guidelines_user_key ON guidelines(user_id, key);
CREATE INDEX idx_guidelines_cat ON guidelines(user_id, category);
```

### Migration `002_approval_queue.sql` — Admin Approval System

```sql
-- ============================================================
-- RESORT MANAGER — Migration 002: Approval Queue
-- ============================================================

CREATE TABLE IF NOT EXISTS approval_queue (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'normal',
    title TEXT NOT NULL,
    summary TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    admin_notes TEXT,
    related_table TEXT,
    related_id TEXT,
    original_email_id TEXT,
    expires_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_approval_user ON approval_queue(user_id);
CREATE INDEX idx_approval_status ON approval_queue(user_id, status);
CREATE INDEX idx_approval_type ON approval_queue(user_id, type);
CREATE INDEX idx_approval_priority ON approval_queue(user_id, priority, created_at);
```

**Approval types:**

| `type` | Trigger | Payload |
|--------|---------|---------|
| `email_reply` | Inbound email classified as needing a reply | `{ to, subject, draft_body, original_body }` |
| `email_skip` | Inbound email classified as no-reply | `{ from, subject, reason, original_body }` |
| `db_change` | AI-suggested database mutation from email context | `{ table, action, data, reason }` |
| `manual_override` | Admin overrides a `email_skip` to generate reply | `{ original_approval_id }` |

**Status flow:**
```
pending → approved → executed
pending → revised  → executed
pending → rejected
pending → expired
```

### Migration `003_email_log.sql` — Email Tracking

```sql
-- ============================================================
-- RESORT MANAGER — Migration 003: Email Log
-- ============================================================

CREATE TABLE IF NOT EXISTS email_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    from_address TEXT,
    to_address TEXT,
    subject TEXT,
    body_text TEXT,
    body_html TEXT,
    thread_id TEXT,
    in_reply_to TEXT,
    classification TEXT,
    approval_id TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    error_message TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_email_user ON email_log(user_id);
CREATE INDEX idx_email_direction ON email_log(user_id, direction);
CREATE INDEX idx_email_thread ON email_log(user_id, thread_id);
CREATE INDEX idx_email_from ON email_log(user_id, from_address);
CREATE INDEX idx_email_status ON email_log(user_id, status);
```

**Direction values:** `inbound`, `outbound`
**Classification values:** `reservation_request`, `cancellation`, `inquiry`, `complaint`, `confirmation`, `spam`, `other`
**Status values:** `received`, `processing`, `queued`, `approved`, `sent`, `failed`

---

## 4. Room Registry & Seeding

Rooms cannot be seeded via migration (requires `user_id` at runtime). Instead, a `rooms_initialize` function runs once on first setup.

### Room Numbering Convention

- Buildings: 4, 5, 6, 7, 8
- Rooms per building: 01–37
- Room number format: `"401"` through `"837"` (building + room, no separator)
- Total: up to 185 rooms (5 buildings × 37 rooms)

### Room Tiers

| Tier | Description | Typical Price Range |
|------|-------------|-------------------|
| Twin | Standard twin room | Base rate |
| Corner King | Corner room with king bed | 1.3× base |
| Junior Suite | Junior suite | 1.6× base |
| Onsen Suite | Suite with private onsen | 2.2× base |

### Seeding Strategy

The `rooms_initialize` function accepts a tier mapping and price table. The admin calls it once via Desktop:

> "Initialize all resort rooms"

The function:
1. Checks if rooms already exist (idempotent — skips if count > 0)
2. Generates all room records with UUIDs
3. Assigns tiers based on a mapping provided in the function (or as args)
4. Inserts via `ultralight.db.batch()` for atomicity
5. Returns summary: `{ total_rooms, by_tier: { Twin: N, ... } }`

The tier-to-room mapping must be provided by the resort admin at implementation time (which specific rooms are which tier). A reasonable default can be coded based on common resort patterns (suites on higher floors, corner rooms at ends of corridors), but the admin should verify and adjust.

---

## 5. Function Inventory

### 5.1 Room Management (6 functions)

```typescript
// Initialize room registry (run once)
export async function rooms_initialize(args: {
    tier_map?: Record<string, string>,  // e.g. { "401": "Twin", "501": "Corner King" }
    price_map?: Record<string, number>  // e.g. { "Twin": 15000, "Corner King": 20000 }
}): Promise<{ total_rooms: number, by_tier: Record<string, number> }>

// List rooms with filters
export async function rooms_list(args: {
    status?: string,           // 'available' | 'occupied' | 'maintenance'
    tier?: string,             // 'Twin' | 'Corner King' | 'Junior Suite' | 'Onsen Suite'
    building?: number,         // 4-8
    check_in?: string,        // ISO date — check availability for date range
    check_out?: string
}): Promise<{ rooms: Room[], total: number }>

// Book a room
export async function rooms_book(args: {
    room_number: string,
    guest_name: string,
    num_guests: number,
    check_in_date: string,
    check_out_date: string,
    nights_staying: number,
    group_name?: string,
    payment_method?: string,
    payment_amount?: number,
    notes?: string
}): Promise<{ reservation: RoomReservation }>

// Update reservation
export async function rooms_update(args: {
    reservation_id: string,
    room_number?: string,       // room change
    check_out_date?: string,    // extend/shorten
    nights_staying?: number,
    payment_status?: string,
    payment_amount?: number,
    status?: string,
    notes?: string
}): Promise<{ reservation: RoomReservation }>

// Check in / check out
export async function rooms_checkin(args: {
    reservation_id: string
}): Promise<{ reservation: RoomReservation, room: Room }>

export async function rooms_checkout(args: {
    reservation_id: string
}): Promise<{ reservation: RoomReservation, room: Room, unpaid_items: UnpaidSummary }>
```

**`rooms_checkout` is critical** — on checkout, it:
1. Updates reservation status to `'checked_out'`
2. Sets room status back to `'available'`, clears `current_reservation_id`
3. Queries ALL unpaid items across services for that room number
4. Returns a consolidated bill: unpaid ski rentals, lessons, tee times, restaurant, store purchases

### 5.2 Ski Operations (6 functions)

```typescript
// Equipment inventory
export async function ski_inventory(args: {
    category?: string,   // 'skis' | 'boots' | 'poles' | 'helmet' | 'jacket' | 'pants'
    available_only?: boolean
}): Promise<{ equipment: Equipment[], total: number }>

// Add/update equipment (admin)
export async function ski_equipment_manage(args: {
    action: 'add' | 'update',
    equipment_id?: string,      // required for update
    category?: string,
    brand?: string,
    product?: string,
    size?: string,
    gender?: string,
    qty_total?: number
}): Promise<{ equipment: Equipment }>

// Create rental
export async function ski_rent(args: {
    guest_name: string,
    room_number?: string,
    tohoku_pass?: boolean,
    equipment_ids: string[],
    payment_method?: string,
    payment_amount?: number
}): Promise<{ rental: Rental, items: Equipment[] }>

// Return rental
export async function ski_return(args: {
    rental_id: string
}): Promise<{ rental: Rental, returned_items: number }>

// Book ski lesson
export async function ski_book_lesson(args: {
    guest_name: string,
    room_number?: string,
    lesson_date: string,
    lesson_time: string,
    duration_minutes?: number,
    instructor?: string,
    num_students?: number,
    skill_level?: string,
    payment_method?: string,
    payment_amount?: number
}): Promise<{ lesson: SkiLesson }>

// View lessons schedule
export async function ski_lessons_list(args: {
    date?: string,
    instructor?: string,
    guest_name?: string
}): Promise<{ lessons: SkiLesson[], total: number }>
```

**`ski_rent` transactional logic:**
1. Validate all `equipment_ids` exist and have `qty_available > 0` (i.e., `qty_total - qty_rented > 0`)
2. Create `ski_rentals` row
3. Create `ski_rental_items` junction rows
4. Increment `qty_rented` on each equipment row
5. All via `ultralight.db.batch()` for atomicity

**`ski_return` reversal:**
1. Set rental status to `'returned'`
2. Decrement `qty_rented` for each item in `ski_rental_items`
3. Batch execution

### 5.3 Golf Operations (3 functions)

```typescript
// Book tee time
export async function golf_book_tee(args: {
    guest_name: string,
    room_number?: string,
    tee_date: string,
    tee_time: string,
    starting_hole?: number,     // default 1
    num_in_party?: number,
    cart_ids?: string[],
    payment_method?: string,
    payment_amount?: number
}): Promise<{ tee_time: TeeTime, carts: string[] }>

// View availability
export async function golf_availability(args: {
    date: string,
    starting_hole?: number
}): Promise<{ available_times: string[], booked: TeeTime[] }>

// Cancel tee time
export async function golf_cancel(args: {
    tee_time_id: string
}): Promise<{ cancelled: TeeTime }>
```

### 5.4 Restaurant Operations (3 functions)

```typescript
// Book table
export async function restaurant_book(args: {
    guest_name: string,
    room_number?: string,
    res_date: string,
    res_time: string,
    num_people: number,
    set_menu?: string,
    allergies?: string,
    payment_method?: string,
    notes?: string
}): Promise<{ reservation: RestaurantReservation }>

// Today's reservations
export async function restaurant_today(args: {
    date?: string   // defaults to today
}): Promise<{ reservations: RestaurantReservation[], total_covers: number }>

// Cancel restaurant reservation
export async function restaurant_cancel(args: {
    reservation_id: string
}): Promise<{ cancelled: RestaurantReservation }>
```

### 5.5 Store Operations (4 functions)

```typescript
// Record sale
export async function store_sell(args: {
    product_id: string,
    quantity?: number,
    guest_name?: string,
    room_number?: string,
    payment_method?: string,
    payment_amount?: number
}): Promise<{ transaction: StoreTransaction, product: StoreProduct }>

// View inventory
export async function store_inventory(args: {
    category?: string,
    low_stock_only?: boolean   // qty_available < 5
}): Promise<{ products: StoreProduct[], total: number }>

// Add/restock product
export async function store_manage(args: {
    action: 'add' | 'restock' | 'update_price',
    product_id?: string,
    name?: string,
    category?: string,
    brand?: string,
    price?: number,
    qty_add?: number
}): Promise<{ product: StoreProduct }>

// Sales history
export async function store_sales(args: {
    date?: string,
    guest_name?: string,
    product_id?: string
}): Promise<{ transactions: StoreTransaction[], total_revenue: number }>
```

### 5.6 Cross-Domain Functions (4 functions)

```typescript
// Everything for a guest/room — THE killer query
export async function guest_summary(args: {
    guest_name?: string,
    room_number?: string
}): Promise<{
    room: Room | null,
    reservation: RoomReservation | null,
    ski_rentals: Rental[],
    ski_lessons: SkiLesson[],
    tee_times: TeeTime[],
    restaurant_reservations: RestaurantReservation[],
    store_purchases: StoreTransaction[],
    total_unpaid: number
}>

// All unpaid items across all services
export async function guest_billing(args: {
    room_number?: string,
    guest_name?: string,
    payment_status?: string      // default 'unpaid'
}): Promise<{
    rooms: { items: any[], subtotal: number },
    ski: { items: any[], subtotal: number },
    lessons: { items: any[], subtotal: number },
    golf: { items: any[], subtotal: number },
    restaurant: { items: any[], subtotal: number },
    store: { items: any[], subtotal: number },
    grand_total: number
}>

// Daily operations report
export async function report_daily(args: {
    date?: string    // defaults to today
}): Promise<{
    occupancy: { total_rooms: number, occupied: number, rate: string },
    check_ins: RoomReservation[],
    check_outs: RoomReservation[],
    ski_rentals_active: number,
    lessons_today: SkiLesson[],
    tee_times_today: TeeTime[],
    restaurant_covers: number,
    store_revenue: number,
    pending_approvals: number,
    revenue_today: { rooms: number, ski: number, golf: number, restaurant: number, store: number, total: number }
}>

// Revenue report for period
export async function report_revenue(args: {
    start_date: string,
    end_date: string
}): Promise<{
    by_service: Record<string, number>,
    by_payment_method: Record<string, number>,
    by_payment_status: Record<string, number>,
    total: number,
    unpaid: number
}>
```

### 5.7 Guidelines (3 functions)

```typescript
// Get guideline(s)
export async function guidelines_get(args: {
    key?: string,
    category?: string
}): Promise<{ guidelines: Guideline[] }>

// Set guideline
export async function guidelines_set(args: {
    key: string,
    value: string,
    category?: string
}): Promise<{ guideline: Guideline }>

// Remove guideline
export async function guidelines_remove(args: {
    key: string
}): Promise<{ removed: boolean }>
```

**Example guidelines:**
```
key: "check_in_time"       value: "15:00"              category: "policies"
key: "check_out_time"      value: "11:00"              category: "policies"
key: "ski_rental_rates"    value: "Full set: ¥5000..."  category: "pricing"
key: "restaurant_hours"    value: "Breakfast 7-9..."    category: "hours"
key: "pet_policy"          value: "No pets allowed..."  category: "policies"
key: "emergency_contact"   value: "+81-xxx-xxxx"        category: "contacts"
key: "tohoku_pass_info"    value: "Discounted..."       category: "promotions"
```

### 5.8 Email & Approval Functions (5 functions)

See sections 6 and 7 for detailed design.

```typescript
export async function email_process(args: { ... }): Promise<{ ... }>
export async function email_send(args: { ... }): Promise<{ ... }>
export async function email_log_list(args: { ... }): Promise<{ ... }>
export async function approvals_list(args: { ... }): Promise<{ ... }>
export async function approvals_act(args: { ... }): Promise<{ ... }>
```

### 5.9 Admin & DB Access (2 functions)

```typescript
// Raw SQL query (read-only by default)
export async function db_browse(args: {
    sql: string,
    params?: any[],
    mode?: 'read' | 'write'  // default 'read'
}): Promise<{ rows: any[], meta: { columns: string[], row_count: number } }>

// Table schema inspector
export async function db_tables(args: {}): Promise<{
    tables: { name: string, columns: Column[], row_count: number }[]
}>
```

### Total Function Count: **36 functions**

| Domain | Functions | Count |
|--------|-----------|-------|
| Rooms | rooms_initialize, rooms_list, rooms_book, rooms_update, rooms_checkin, rooms_checkout | 6 |
| Ski | ski_inventory, ski_equipment_manage, ski_rent, ski_return, ski_book_lesson, ski_lessons_list | 6 |
| Golf | golf_book_tee, golf_availability, golf_cancel | 3 |
| Restaurant | restaurant_book, restaurant_today, restaurant_cancel | 3 |
| Store | store_sell, store_inventory, store_manage, store_sales | 4 |
| Cross-domain | guest_summary, guest_billing, report_daily, report_revenue | 4 |
| Guidelines | guidelines_get, guidelines_set, guidelines_remove | 3 |
| Email | email_process, email_send, email_log_list | 3 |
| Approvals | approvals_list, approvals_act | 2 |
| Admin | db_browse, db_tables | 2 |
| **Total** | | **36** |

---

## 6. Email Agent System

### 6.1 Inbound Email Flow

```
Email arrives at resort inbox
        │
        ▼
┌──────────────────┐
│  External Trigger │
│  (CF Worker cron  │
│   or webhook)     │
│                   │
│  Calls:           │
│  email_process()  │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  email_process()                          │
│                                          │
│  1. Fetch unread emails via IMAP/Gmail   │
│     API using ultralight.env keys        │
│                                          │
│  2. For each email:                      │
│     a. Log to email_log (direction:      │
│        'inbound')                        │
│     b. Call ultralight.ai() to classify: │
│        - reservation_request             │
│        - cancellation                    │
│        - inquiry                         │
│        - complaint                       │
│        - spam                            │
│     c. Load relevant DB context:         │
│        - Guest reservations if known     │
│        - Room availability if booking    │
│        - Guidelines for policies         │
│     d. AI drafts response (if replying)  │
│     e. AI suggests DB changes            │
│        (if applicable)                   │
│     f. Queue approval(s)                 │
│                                          │
│  3. Return processing summary            │
└──────────────────────────────────────────┘
```

### 6.2 AI Classification & Drafting

The `email_process` function uses two `ultralight.ai()` calls per email:

**Call 1: Classify + Decide**
```typescript
const classification = await ultralight.ai({
    model: 'openai/gpt-4o',
    messages: [
        {
            role: 'system',
            content: `You are an email classifier for a ski/golf resort.
Classify this email and decide whether it needs a reply.

Resort context:
- Check-in: ${guidelines.check_in_time}
- Check-out: ${guidelines.check_out_time}
- Room types: Twin, Corner King, Junior Suite, Onsen Suite

Current availability: ${JSON.stringify(availability)}

Respond with JSON:
{
    "classification": "reservation_request|cancellation|inquiry|complaint|spam|other",
    "should_reply": true|false,
    "reason": "...",
    "db_changes": [
        { "table": "room_reservations", "action": "insert|update|delete", "data": {...}, "reason": "..." }
    ]
}`
        },
        { role: 'user', content: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}` }
    ]
});
```

**Call 2: Draft Reply (if should_reply = true)**
```typescript
const draft = await ultralight.ai({
    model: 'openai/gpt-4o',
    messages: [
        {
            role: 'system',
            content: `Draft a professional reply for this resort email.
Use the following guidelines and data to ensure accuracy.

Guidelines: ${JSON.stringify(relevantGuidelines)}
Guest history: ${JSON.stringify(guestData)}
Availability: ${JSON.stringify(availability)}

Tone: Professional, warm, helpful. Resort name: [Resort Name].
Language: Match the language of the incoming email (Japanese/English).`
        },
        { role: 'user', content: `Original email:\n${email.body}\n\nClassification: ${classification}\nContext: ${JSON.stringify(dbContext)}` }
    ]
});
```

### 6.3 Approval Items Generated Per Email

Each inbound email generates 1–3 approval queue items:

| Condition | Approval Type | Example |
|-----------|--------------|---------|
| AI says reply needed | `email_reply` | Draft response to reservation inquiry |
| AI says no reply | `email_skip` | Spam, auto-confirmation, newsletter |
| AI detects DB change needed | `db_change` | "Book room 512 for March 25–28" → INSERT |

### 6.4 Outbound Email Flow

```
Admin approves in Desktop
        │
        ▼
approvals_act({ id, action: 'approve' })
        │
        ▼
If type == 'email_reply':
  → email_send() fires
  → Resend API: POST /emails
  → email_log updated (direction: 'outbound', status: 'sent')
  → approval_queue status → 'executed'

If type == 'db_change':
  → Execute the SQL from payload
  → Update affected table
  → approval_queue status → 'executed'
```

### 6.5 Required Environment Variables

```
RESEND_API_KEY          — Resend API key for sending emails
RESORT_EMAIL_ADDRESS    — from address for outbound emails
GMAIL_API_KEY           — or IMAP credentials for reading inbound
RESORT_NAME             — resort display name for email templates
```

Set via `ul.set` with env var configuration, stored encrypted per-app.

### 6.6 External Trigger Options

Since Ultralight has no built-in cron, the email check needs an external trigger:

**Option A: Cloudflare Worker Cron Trigger (Recommended)**
- Add a cron trigger to the existing Ultralight worker (or a small dedicated worker)
- Every 5 minutes: `POST /mcp/{appId}` with `email_process` tool call
- Authenticated via service account token
- Zero cost on Cloudflare free plan (up to 100K invocations/day)

**Option B: Resend Inbound Webhook**
- Configure Resend to POST to a webhook endpoint on new email
- Near-real-time processing
- Requires a public endpoint (can be a thin Cloudflare Worker → MCP call)

**Option C: Manual**
- Admin says "check email" in Desktop chatbot
- Agent calls `email_process()`
- Good for low-volume initially, upgrade to automated later

**Recommendation:** Start with Option C (zero infrastructure), upgrade to Option A when volume warrants it.

---

## 7. Approval Queue

### 7.1 Functions

```typescript
// List pending approvals
export async function approvals_list(args: {
    status?: string,     // default 'pending'
    type?: string,       // filter by type
    limit?: number       // default 20
}): Promise<{
    approvals: Approval[],
    counts: { pending: number, approved_today: number, rejected_today: number }
}>

// Act on approval
export async function approvals_act(args: {
    approval_id: string,
    action: 'approve' | 'reject' | 'revise',
    revision?: string,           // revised email body (for revise action)
    admin_notes?: string
}): Promise<{
    approval: Approval,
    result?: any                 // execution result (sent email, DB change)
}>
```

### 7.2 Approval Execution Logic

When `action === 'approve'` or `action === 'revise'`:

```typescript
if (approval.type === 'email_reply') {
    const payload = JSON.parse(approval.payload);
    const body = args.revision || payload.draft_body;  // use revision if provided

    // Send via Resend
    const result = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ultralight.env.RESEND_API_KEY}` },
        body: JSON.stringify({
            from: ultralight.env.RESORT_EMAIL_ADDRESS,
            to: payload.to,
            subject: payload.subject,
            html: body
        })
    });

    // Log outbound email
    await ultralight.db.run(`INSERT INTO email_log (id, user_id, direction, ...) VALUES (?, ?, 'outbound', ...)`,
        [crypto.randomUUID(), ultralight.user.id, ...]);
}

if (approval.type === 'db_change') {
    const payload = JSON.parse(approval.payload);
    // Execute the proposed SQL change
    // The payload contains { table, action, data, sql, params }
    await ultralight.db.run(payload.sql, payload.params);
}

if (approval.type === 'email_skip' && args.action === 'revise') {
    // Admin overrides "no reply" decision — generate a reply draft
    // Create new approval of type 'email_reply' with the revision as draft body
}
```

### 7.3 Desktop Chatbot UX

Natural language approval flow:

```
Admin: "Show me pending approvals"
Agent: calls approvals_list({ status: 'pending' })
→ "You have 3 pending items:
   1. [email_reply] Reply to Suzuki-san re: March reservation inquiry
   2. [db_change] Add reservation: Room 512, Tanaka, Mar 25-28
   3. [email_skip] Newsletter from ski manufacturer (spam)"

Admin: "Approve 1 and 2, reject 3"
Agent: calls approvals_act() three times
→ "Done. Reply sent to Suzuki-san. Room 512 booked for Tanaka Mar 25-28.
   Manufacturer email archived."

Admin: "Actually, change the Tanaka reservation to room 515 instead"
Agent: calls rooms_update({ reservation_id: '...', room_number: '515' })
→ "Updated. Tanaka is now in room 515 (Corner King)."
```

---

## 8. AI Integration

### 8.1 Usage Points

| Function | AI Model | Purpose |
|----------|----------|---------|
| `email_process` | `openai/gpt-4o` | Email classification + reply drafting |
| `email_process` | `openai/gpt-4o` | DB change suggestion |
| `guest_summary` | (none) | Pure SQL — no AI needed |
| `report_daily` | (none) | Pure SQL aggregation |

### 8.2 AI Cost Estimate

Per inbound email: ~2 AI calls × ~1,000 tokens each = ~2,000 tokens
At GPT-4o rates via OpenRouter: ~0.02 Light per email
At 20 emails/day: ~0.4 Light/day = ~12 Light/month ≈ $0.015/month

**AI cost is negligible** for this use case.

### 8.3 Required Permission

```json
{
    "permissions": ["ai:call", "net:fetch"]
}
```

- `ai:call` — for email classification and drafting
- `net:fetch` — for Resend email API and Gmail/IMAP API

---

## 9. Database Browse & Admin Access

### 9.1 In-App Solution (Now)

Two functions provide admin database access without platform changes:

**`db_browse`** — raw SQL query tool
```typescript
export async function db_browse(args: {
    sql: string,
    params?: any[],
    mode?: 'read' | 'write'
}): Promise<{ rows: any[], meta: { columns: string[], row_count: number } }> {
    // Safety: default to read-only
    const mode = args.mode || 'read';

    if (mode === 'read') {
        // Validate SQL starts with SELECT
        const trimmed = args.sql.trim().toUpperCase();
        if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
            throw new Error('Read mode only allows SELECT queries. Set mode: "write" for mutations.');
        }
    }

    const result = await ultralight.db.all(args.sql, args.params || []);
    return {
        rows: result,
        meta: {
            columns: result.length > 0 ? Object.keys(result[0]) : [],
            row_count: result.length
        }
    };
}
```

**`db_tables`** — schema inspector
```typescript
export async function db_tables(args: {}): Promise<{
    tables: { name: string, columns: any[], row_count: number }[]
}> {
    // SQLite system query for table list
    const tables = await ultralight.db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_%' AND user_id = ?",
        [ultralight.user.id]
    );

    // Note: sqlite_master doesn't have user_id — this query would need
    // to be handled differently. See implementation notes below.
    // ...
}
```

**Implementation note:** `sqlite_master` is a system table without `user_id`. The SDK's user_id validation would block this query. Two options:
1. Hard-code the table list in the function (we know our schema)
2. Request a platform-level `db_tables` tool that bypasses user_id for system tables only

For now, option 1 is practical — the function returns the known schema statically.

### 9.2 Platform Feature (Future)

For the marketplace metadata / developer toggle, a future platform sprint would add:

```typescript
// In manifest.json
{
    "db_access": {
        "owner_browse": true,     // owner can see DB in Desktop
        "owner_export": true,     // owner can export CSV/JSON
        "developer_browse": false, // developer cannot see production data
        "schema_visible": true     // schema shown in marketplace listing
    }
}
```

This is **not blocking** for the resort MCP — the in-app `db_browse` function covers the admin's needs fully.

---

## 10. Manifest & Permissions

### `manifest.json`

```json
{
    "name": "resort-manager",
    "version": "1.0.0",
    "description": "Complete resort management system for ski/golf resort operations",
    "permissions": ["ai:call", "net:fetch"],
    "storage": "d1",
    "env_vars": {
        "RESEND_API_KEY": { "type": "universal", "required": false },
        "RESORT_EMAIL_ADDRESS": { "type": "universal", "required": false },
        "GMAIL_API_KEY": { "type": "universal", "required": false },
        "RESORT_NAME": { "type": "universal", "required": false }
    },
    "functions": {
        "rooms_initialize": {
            "description": "Initialize room registry with all 180+ rooms, tiers, and prices. Run once on first setup.",
            "parameters": [
                { "name": "tier_map", "type": "object", "required": false, "description": "Room number to tier mapping" },
                { "name": "price_map", "type": "object", "required": false, "description": "Tier to nightly price mapping" }
            ]
        },
        "rooms_list": {
            "description": "List rooms with optional filters for status, tier, building, and date availability",
            "parameters": [
                { "name": "status", "type": "string", "required": false },
                { "name": "tier", "type": "string", "required": false },
                { "name": "building", "type": "number", "required": false },
                { "name": "check_in", "type": "string", "required": false },
                { "name": "check_out", "type": "string", "required": false }
            ]
        },
        "rooms_book": {
            "description": "Book a room for a guest with check-in/out dates, party size, and payment details",
            "parameters": [
                { "name": "room_number", "type": "string", "required": true },
                { "name": "guest_name", "type": "string", "required": true },
                { "name": "num_guests", "type": "number", "required": true },
                { "name": "check_in_date", "type": "string", "required": true },
                { "name": "check_out_date", "type": "string", "required": true },
                { "name": "nights_staying", "type": "number", "required": true },
                { "name": "group_name", "type": "string", "required": false },
                { "name": "payment_method", "type": "string", "required": false },
                { "name": "payment_amount", "type": "number", "required": false },
                { "name": "notes", "type": "string", "required": false }
            ]
        },
        "guest_summary": {
            "description": "Get complete guest profile: room, all reservations, rentals, purchases, and unpaid balance",
            "parameters": [
                { "name": "guest_name", "type": "string", "required": false },
                { "name": "room_number", "type": "string", "required": false }
            ]
        },
        "guest_billing": {
            "description": "Get all unpaid items across every service for a guest or room, with subtotals per category",
            "parameters": [
                { "name": "room_number", "type": "string", "required": false },
                { "name": "guest_name", "type": "string", "required": false }
            ]
        },
        "report_daily": {
            "description": "Daily operations snapshot: occupancy, check-ins/outs, activities, revenue, pending approvals",
            "parameters": [
                { "name": "date", "type": "string", "required": false }
            ]
        },
        "email_process": {
            "description": "Process inbound emails: classify, draft replies, suggest DB changes, queue for approval",
            "parameters": [
                { "name": "emails", "type": "array", "required": false, "description": "Emails to process (or fetches from inbox)" }
            ]
        },
        "approvals_list": {
            "description": "List pending approval items (email replies, DB changes) awaiting admin action",
            "parameters": [
                { "name": "status", "type": "string", "required": false },
                { "name": "type", "type": "string", "required": false }
            ]
        },
        "approvals_act": {
            "description": "Approve, reject, or revise a queued approval item. Executes on approval (sends email or applies DB change).",
            "parameters": [
                { "name": "approval_id", "type": "string", "required": true },
                { "name": "action", "type": "string", "required": true },
                { "name": "revision", "type": "string", "required": false },
                { "name": "admin_notes", "type": "string", "required": false }
            ]
        },
        "db_browse": {
            "description": "Run raw SQL queries against the resort database. Read-only by default, set mode:'write' for mutations.",
            "parameters": [
                { "name": "sql", "type": "string", "required": true },
                { "name": "params", "type": "array", "required": false },
                { "name": "mode", "type": "string", "required": false }
            ]
        }
    }
}
```

*Note: Only key functions shown in manifest for brevity. All 36 functions would be declared.*

---

## 11. Implementation Sprints

### Sprint 1: Foundation (Schema + Rooms + Guidelines)
**Estimated time: 2–3 hours**

| # | Task | Files |
|---|------|-------|
| 1.1 | Write `001_initial.sql` with all 12 tables | `migrations/001_initial.sql` |
| 1.2 | Implement `rooms_initialize` with batch insert | `index.ts` |
| 1.3 | Implement `rooms_list` with all filter combinations | `index.ts` |
| 1.4 | Implement `rooms_book` with availability check + room status update | `index.ts` |
| 1.5 | Implement `rooms_update` | `index.ts` |
| 1.6 | Implement `rooms_checkin` / `rooms_checkout` | `index.ts` |
| 1.7 | Implement `guidelines_get` / `guidelines_set` / `guidelines_remove` | `index.ts` |
| 1.8 | Write `manifest.json` with room + guideline functions | `manifest.json` |
| 1.9 | Test: initialize rooms, book, check in, check out, verify billing | manual |

**Exit criteria:** Can initialize rooms, book a guest, check in/out, and manage guidelines via Desktop.

### Sprint 2: Services (Ski + Golf + Restaurant + Store)
**Estimated time: 3–4 hours**

| # | Task | Files |
|---|------|-------|
| 2.1 | Implement `ski_inventory` / `ski_equipment_manage` | `index.ts` |
| 2.2 | Implement `ski_rent` with batch inventory decrement | `index.ts` |
| 2.3 | Implement `ski_return` with batch inventory increment | `index.ts` |
| 2.4 | Implement `ski_book_lesson` / `ski_lessons_list` | `index.ts` |
| 2.5 | Implement `golf_book_tee` / `golf_availability` / `golf_cancel` | `index.ts` |
| 2.6 | Implement `restaurant_book` / `restaurant_today` / `restaurant_cancel` | `index.ts` |
| 2.7 | Implement `store_sell` / `store_inventory` / `store_manage` / `store_sales` | `index.ts` |
| 2.8 | Update manifest with all service functions | `manifest.json` |
| 2.9 | Test: full service lifecycle for each domain | manual |

**Exit criteria:** All CRUD operations work for every service domain.

### Sprint 3: Cross-Domain Intelligence
**Estimated time: 2 hours**

| # | Task | Files |
|---|------|-------|
| 3.1 | Implement `guest_summary` with multi-table LEFT JOINs | `index.ts` |
| 3.2 | Implement `guest_billing` with per-service subtotals | `index.ts` |
| 3.3 | Implement `report_daily` with aggregations | `index.ts` |
| 3.4 | Implement `report_revenue` with date range + GROUP BY | `index.ts` |
| 3.5 | Wire `rooms_checkout` to call billing summary | `index.ts` |
| 3.6 | Test: guest summary shows data across all services | manual |

**Exit criteria:** Can pull up full guest profile, consolidated bill, and daily/revenue reports.

### Sprint 4: Approval Queue + Email Agent
**Estimated time: 3–4 hours**

| # | Task | Files |
|---|------|-------|
| 4.1 | Write `002_approval_queue.sql` | `migrations/002_approval_queue.sql` |
| 4.2 | Write `003_email_log.sql` | `migrations/003_email_log.sql` |
| 4.3 | Implement `approvals_list` / `approvals_act` | `index.ts` |
| 4.4 | Implement `email_process` with AI classification + drafting | `index.ts` |
| 4.5 | Implement `email_send` via Resend API | `index.ts` |
| 4.6 | Implement `email_log_list` | `index.ts` |
| 4.7 | Wire approval execution: email_reply → send, db_change → execute | `index.ts` |
| 4.8 | Set env vars: RESEND_API_KEY, RESORT_EMAIL_ADDRESS | config |
| 4.9 | Test: mock inbound email → classify → draft → approve → send | manual |

**Exit criteria:** Full email flow works: inbound → classify → queue → approve → send/execute.

### Sprint 5: Admin Access + Polish
**Estimated time: 1–2 hours**

| # | Task | Files |
|---|------|-------|
| 5.1 | Implement `db_browse` with read/write mode safety | `index.ts` |
| 5.2 | Implement `db_tables` with static schema reflection | `index.ts` |
| 5.3 | Final manifest.json with all 36 functions | `manifest.json` |
| 5.4 | Seed initial guidelines (check-in/out times, policies, rates) | via `guidelines_set` |
| 5.5 | End-to-end test: full guest lifecycle from booking to checkout | manual |
| 5.6 | Staff permission grants for department-specific access | via `ul.permissions` |

**Exit criteria:** Complete resort MCP deployed, admin can browse DB, staff permissions set.

### Sprint 6 (Optional): Email Automation
**Estimated time: 2–3 hours**

| # | Task | Files |
|---|------|-------|
| 6.1 | Create CF Worker cron trigger for `email_process` | separate worker |
| 6.2 | Or: Resend inbound webhook → CF Worker → MCP call | separate worker |
| 6.3 | Test automated email processing end-to-end | integration test |

**Exit criteria:** Emails processed automatically without admin "check email" command.

---

## 12. Metering & Cost Projections

### D1 Usage Estimate (Per Month)

| Operation | Estimate | Reads | Writes |
|-----------|----------|-------|--------|
| Room bookings/updates | 50/day × 30 = 1,500 | 3,000 | 1,500 |
| Guest lookups | 100/day × 30 = 3,000 | 15,000 | 0 |
| Ski rentals | 30/day × 30 = 900 | 2,700 | 2,700 |
| Golf bookings | 20/day × 30 = 600 | 1,200 | 600 |
| Restaurant | 40/day × 30 = 1,200 | 2,400 | 1,200 |
| Store sales | 50/day × 30 = 1,500 | 3,000 | 1,500 |
| Reports | 10/day × 30 = 300 | 6,000 | 0 |
| Email processing | 20/day × 30 = 600 | 1,800 | 1,200 |
| Approvals | 20/day × 30 = 600 | 1,200 | 600 |
| DB browse | 10/day × 30 = 300 | 600 | 0 |
| **Total** | | **~37,000** | **~9,300** |

**Verdict:** Comfortably within free tier (50K reads, 10K writes). Pro tier recommended for busy season headroom.

### Rate Limit Check

Peak usage: ~200 reads/hour, ~50 writes/hour during busy check-in period
Free tier: 100 reads/min, 20 writes/min → 6,000 reads/hour, 1,200 writes/hour
**No rate limit concerns** even on free tier.

### AI Cost

~20 emails/day × 2 AI calls × ~$0.001/call = ~$0.04/day = **~$1.20/month**

### Storage

12 tables × ~1000 rows average × ~200 bytes/row ≈ 2.4 MB
Free tier: 50 MB → **No concerns**

---

## 13. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|-----------|
| 30s timeout on `rooms_initialize` (185 inserts) | Medium | Low | Use `db.batch()` — single roundtrip, well under 30s |
| Email API key exposed in env vars | High | Low | Encrypted by platform, never in code |
| AI drafts inappropriate email reply | High | Medium | Approval queue prevents any email from sending without human review |
| Concurrent booking of same room | Medium | Medium | Check availability inside `rooms_book`, fail if already booked for dates |
| Guest name misspellings fragment data | Medium | High | Normalize names (trim, title case). Add fuzzy search to `guest_summary` |
| `sqlite_master` blocked by user_id validation | Low | Certain | Use static schema reflection in `db_tables` — we know our own tables |
| Email inbox polling misses emails | Low | Medium | Log every processed email ID, skip already-seen on next poll |
| Staff overwrites admin data | Medium | Low | Function-level permissions via `ul.permissions` — staff only get domain-specific functions |

---

## 14. File Map

```
apps/mcps/resort-manager/
├── index.ts                        # All 36 functions (~1200-1500 lines)
├── manifest.json                   # Function schemas, permissions, env vars
└── migrations/
    ├── 001_initial.sql             # 12 core tables (~200 lines)
    ├── 002_approval_queue.sql      # Approval queue table
    └── 003_email_log.sql           # Email tracking table
```

**Single file architecture** — follows Ultralight convention. All functions in `index.ts`. Helper functions (internal, not exported) handle shared logic like date validation, name normalization, and SQL builders.

### Helper Functions (not exported, not MCP tools)

```typescript
// Internal helpers — not exported, not visible as MCP tools
function normalizeGuestName(name: string): string
function validateDateRange(checkIn: string, checkOut: string): void
function todayISO(): string
function buildWhereClause(filters: Record<string, any>): { sql: string, params: any[] }
function formatCurrency(amount: number): string
```

---

## 15. Appendix: Room Directory

### Room Number Format

| Building | Rooms | Range | Count |
|----------|-------|-------|-------|
| 4 | 01–37 | 401–437 | 37 |
| 5 | 01–37 | 501–537 | 37 |
| 6 | 01–37 | 601–637 | 37 |
| 7 | 01–37 | 701–737 | 37 |
| 8 | 01–37 | 801–837 | 37 |
| **Total** | | | **185** |

### Tier Assignment

The exact tier-to-room mapping must be provided by the resort admin. A default can be proposed:

```
Suggestion (adjust per actual property):
- Twin:          Standard rooms (01–20 in each building)
- Corner King:   Corner rooms (21–28 in each building)
- Junior Suite:  Higher floors (29–33 in each building)
- Onsen Suite:   Premium rooms (34–37 in each building)
```

The `rooms_initialize` function accepts a `tier_map` override, so the admin can provide the exact mapping at setup time. If not provided, the default mapping above is used.

### Room Status Values

| Status | Meaning |
|--------|---------|
| `available` | Ready for booking |
| `occupied` | Guest checked in |
| `maintenance` | Out of service |
| `blocked` | Held for group/VIP |

---

## Revision History

| Date | Change |
|------|--------|
| 2026-03-20 | Initial draft |
