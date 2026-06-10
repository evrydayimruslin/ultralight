-- Resort Manager: Core tables for ski/golf resort operations
-- 12 tables covering rooms, ski, golf, restaurant, store, and guidelines

-- 1. ROOMS — Static registry of all 185 rooms (401-837)
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

-- 5. SKI RENTAL ITEMS (junction: rental <-> equipment)
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

-- 8. TEE TIME CART ASSIGNMENTS (junction: tee_time <-> cart)
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
