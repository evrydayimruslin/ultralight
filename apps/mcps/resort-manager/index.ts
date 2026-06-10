// Resort Manager — Ultralight MCP App
//
// Complete ski/golf resort management system:
// rooms, ski rentals/lessons, golf tee times, restaurant,
// store, guidelines, email agent, and admin approval queue.
//
// Storage: Ultralight D1 (14 tables across 3 migrations)
// AI: ultralight.ai() for email classification + reply drafting
// Network: Resend API for outbound email
// Permissions: ai:call, net:fetch

const ultralight = globalThis.ultralight;

type SqlValue = string | number | null;

interface SqlStatement {
  sql: string;
  params: SqlValue[];
}

interface CountRow {
  cnt: number;
}

interface NamedCountRow {
  count: number;
}

interface TotalRow {
  total: number;
}

interface RevenueRow {
  rev: number;
}

interface CoversRow {
  covers: number;
}

interface RoomRow {
  id: string;
  room_number: string;
  building: number;
  floor_room: number;
  tier: string;
  listed_price: number;
  status: string;
  current_reservation_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RoomReservationRow {
  id: string;
  room_number: string;
  guest_name: string;
  num_guests: number;
  nights_staying: number;
  check_in_date: string;
  check_out_date: string;
  group_name: string | null;
  payment_method: string | null;
  payment_status: string;
  payment_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface RoomNumberRow {
  room_number: string;
}

interface PaymentAmountRow {
  id: string;
  payment_amount: number | null;
  payment_status?: string;
}

interface SkiEquipmentRow {
  id: string;
  category: string;
  brand: string | null;
  product: string | null;
  size: string | null;
  gender: string | null;
  qty_total: number;
  qty_rented: number;
  qty_available?: number;
  created_at?: string;
  updated_at?: string;
}

interface EquipmentIdRow {
  equipment_id: string;
}

interface TeeTimeRow {
  id: string;
  tee_date: string;
  tee_time: string;
  guest_name: string;
  room_number: string | null;
  starting_hole: number;
  num_in_party: number;
  payment_status: string;
  payment_amount: number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

interface LessonRow {
  id: string;
  lesson_date: string;
  lesson_time: string;
  instructor: string | null;
  guest_name: string;
  room_number: string | null;
  num_students: number;
  skill_level: string | null;
  payment_status: string;
  payment_amount: number;
  notes: string | null;
}

interface RestaurantReservationRow {
  id: string;
  res_date: string;
  res_time: string;
  num_people: number;
  set_menu: string | null;
  allergies: string | null;
  guest_name: string;
  room_number: string | null;
  payment_status: string;
  payment_amount?: number | null;
  notes: string | null;
}

interface StoreProductRow {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  price: number;
  qty_available: number;
  created_at?: string;
  updated_at?: string;
}

interface StoreTransactionRow {
  id: string;
  product_id: string;
  quantity: number;
  guest_name: string | null;
  room_number: string | null;
  payment_method: string | null;
  payment_status: string;
  payment_amount: number;
  product_name?: string | null;
  product_category?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface GuidelineRow {
  id?: string;
  key: string;
  value: string;
  category: string | null;
}

interface ApprovalQueueRow {
  id: string;
  type: string;
  status: string;
  priority: string;
  title: string;
  summary: string;
  payload: string | null;
  original_email_id: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface EmailClassificationChange {
  table?: string;
  action?: string;
  data?: Record<string, unknown>;
  reason?: string;
}

interface EmailClassificationResult {
  classification: string;
  should_reply: boolean;
  reason: string;
  priority: 'high' | 'normal' | 'low';
  db_changes: EmailClassificationChange[];
}

interface ParsedApprovalQueueRow extends Omit<ApprovalQueueRow, 'payload'> {
  payload: Record<string, unknown>;
}

interface ApprovalCounts {
  pending: number;
  approved_today: number;
  rejected_today: number;
}

function sumPaymentAmounts<T extends { payment_amount?: number | null }>(items: T[]): number {
  return items.reduce((sum, item) => sum + (item.payment_amount || 0), 0);
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// ============================================
// INTERNAL HELPERS
// ============================================

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function nowISO(): string {
  return new Date().toISOString();
}

function normalizeGuestName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function uid(): string {
  return ultralight.user.id;
}

// ============================================
// 1. ROOMS — Initialize, List, Book, Update, Check-in, Check-out
// ============================================

// ── ROOMS INITIALIZE ──

export async function rooms_initialize(args: {
  tier_map?: Record<string, string>;
  price_map?: Record<string, number>;
}): Promise<unknown> {
  const { tier_map, price_map } = args;

  // Check if already initialized
  const existing: CountRow | null = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM rooms WHERE user_id = ?',
    [uid()]
  );
  if (existing && existing.cnt > 0) {
    return { success: false, message: 'Rooms already initialized. Found ' + existing.cnt + ' rooms.', total_rooms: existing.cnt };
  }

  // Default tier assignment: Twin (01-20), Corner King (21-28), Junior Suite (29-33), Onsen Suite (34-37)
  function defaultTier(floorRoom: number): string {
    if (floorRoom >= 34) return 'Onsen Suite';
    if (floorRoom >= 29) return 'Junior Suite';
    if (floorRoom >= 21) return 'Corner King';
    return 'Twin';
  }

  // Default prices per tier
  const defaultPrices: Record<string, number> = {
    'Twin': 15000,
    'Corner King': 20000,
    'Junior Suite': 25000,
    'Onsen Suite': 35000,
  };
  const prices = price_map || defaultPrices;

  const now = nowISO();
  const statements: SqlStatement[] = [];
  const tierCounts: Record<string, number> = {};

  for (let building = 4; building <= 8; building++) {
    for (let room = 1; room <= 37; room++) {
      const roomStr = room.toString().padStart(2, '0');
      const roomNumber = '' + building + roomStr;
      const tier = (tier_map && tier_map[roomNumber]) || defaultTier(room);
      const price = prices[tier] || 15000;

      tierCounts[tier] = (tierCounts[tier] || 0) + 1;

      statements.push({
        sql: 'INSERT INTO rooms (id, user_id, room_number, building, floor_room, tier, listed_price, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [crypto.randomUUID(), uid(), roomNumber, building, room, tier, price, 'available', now, now],
      });
    }
  }

  await ultralight.db.batch(statements);

  return {
    success: true,
    total_rooms: statements.length,
    by_tier: tierCounts,
    prices: prices,
  };
}

// ── ROOMS LIST ──

export async function rooms_list(args: {
  status?: string;
  tier?: string;
  building?: number;
  check_in?: string;
  check_out?: string;
  room_number?: string;
}): Promise<unknown> {
  const { status, tier, building, check_in, check_out, room_number } = args;

  let sql = 'SELECT * FROM rooms WHERE user_id = ?';
  const params: SqlValue[] = [uid()];

  if (room_number) {
    sql += ' AND room_number = ?';
    params.push(room_number);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (tier) {
    sql += ' AND tier = ?';
    params.push(tier);
  }
  if (building) {
    sql += ' AND building = ?';
    params.push(building);
  }

  sql += ' ORDER BY room_number ASC';

  let rooms: RoomRow[] = await ultralight.db.all(sql, params);

  // Filter by date availability if requested
  if (check_in && check_out) {
    const booked: RoomNumberRow[] = await ultralight.db.all(
      'SELECT DISTINCT room_number FROM room_reservations WHERE user_id = ? AND status != ? AND check_in_date < ? AND check_out_date > ?',
      [uid(), 'cancelled', check_out, check_in]
    );
    const bookedSet = new Set(booked.map((reservation) => reservation.room_number));
    rooms = rooms.filter((room) => !bookedSet.has(room.room_number));
  }

  return { rooms: rooms, total: rooms.length };
}

// ── ROOMS BOOK ──

export async function rooms_book(args: {
  room_number: string;
  guest_name: string;
  num_guests: number;
  check_in_date: string;
  check_out_date: string;
  nights_staying: number;
  group_name?: string;
  payment_method?: string;
  payment_amount?: number;
  notes?: string;
}): Promise<unknown> {
  const { room_number, guest_name, num_guests, check_in_date, check_out_date, nights_staying, group_name, payment_method, payment_amount, notes } = args;

  if (!room_number || !guest_name || !check_in_date || !check_out_date) {
    throw new Error('room_number, guest_name, check_in_date, and check_out_date are required');
  }

  // Verify room exists
  const room: RoomRow | null = await ultralight.db.first(
    'SELECT * FROM rooms WHERE user_id = ? AND room_number = ?',
    [uid(), room_number]
  );
  if (!room) {
    throw new Error('Room ' + room_number + ' not found');
  }

  // Check for conflicts
  const conflict: Pick<RoomReservationRow, 'id' | 'guest_name' | 'check_in_date' | 'check_out_date'> | null = await ultralight.db.first(
    'SELECT id, guest_name, check_in_date, check_out_date FROM room_reservations WHERE user_id = ? AND room_number = ? AND status != ? AND check_in_date < ? AND check_out_date > ?',
    [uid(), room_number, 'cancelled', check_out_date, check_in_date]
  );
  if (conflict) {
    throw new Error('Room ' + room_number + ' is already booked from ' + conflict.check_in_date + ' to ' + conflict.check_out_date + ' by ' + conflict.guest_name);
  }

  const id = crypto.randomUUID();
  const now = nowISO();
  const name = normalizeGuestName(guest_name);

  await ultralight.db.run(
    'INSERT INTO room_reservations (id, user_id, room_number, guest_name, num_guests, nights_staying, check_in_date, check_out_date, group_name, payment_method, payment_status, payment_amount, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), room_number, name, num_guests || 1, nights_staying || 1, check_in_date, check_out_date, group_name || null, payment_method || null, 'unpaid', payment_amount || 0, 'confirmed', notes || null, now, now]
  );

  return {
    success: true,
    reservation: {
      id: id,
      room_number: room_number,
      room_tier: room.tier,
      guest_name: name,
      check_in_date: check_in_date,
      check_out_date: check_out_date,
      nights_staying: nights_staying || 1,
      status: 'confirmed',
    },
  };
}

// ── ROOMS UPDATE ──

export async function rooms_update(args: {
  reservation_id: string;
  room_number?: string;
  check_in_date?: string;
  check_out_date?: string;
  nights_staying?: number;
  num_guests?: number;
  guest_name?: string;
  group_name?: string;
  payment_method?: string;
  payment_status?: string;
  payment_amount?: number;
  status?: string;
  notes?: string;
}): Promise<unknown> {
  const { reservation_id } = args;
  if (!reservation_id) throw new Error('reservation_id is required');

  const existing: RoomReservationRow | null = await ultralight.db.first(
    'SELECT * FROM room_reservations WHERE id = ? AND user_id = ?',
    [reservation_id, uid()]
  );
  if (!existing) throw new Error('Reservation not found: ' + reservation_id);

  const now = nowISO();
  const setClauses: string[] = ['updated_at = ?'];
  const params: SqlValue[] = [now];

  const fields: Record<string, SqlValue | undefined> = {
    room_number: args.room_number,
    check_in_date: args.check_in_date,
    check_out_date: args.check_out_date,
    nights_staying: args.nights_staying,
    num_guests: args.num_guests,
    guest_name: args.guest_name ? normalizeGuestName(args.guest_name) : undefined,
    group_name: args.group_name,
    payment_method: args.payment_method,
    payment_status: args.payment_status,
    payment_amount: args.payment_amount,
    status: args.status,
    notes: args.notes,
  };

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      setClauses.push(key + ' = ?');
      params.push(val);
    }
  }

  params.push(reservation_id, uid());
  await ultralight.db.run(
    'UPDATE room_reservations SET ' + setClauses.join(', ') + ' WHERE id = ? AND user_id = ?',
    params
  );

  const updated: RoomReservationRow | null = await ultralight.db.first(
    'SELECT * FROM room_reservations WHERE id = ? AND user_id = ?',
    [reservation_id, uid()]
  );

  return { success: true, reservation: updated };
}

// ── ROOMS CHECK-IN ──

export async function rooms_checkin(args: {
  reservation_id: string;
}): Promise<unknown> {
  const { reservation_id } = args;
  if (!reservation_id) throw new Error('reservation_id is required');

  const res: RoomReservationRow | null = await ultralight.db.first(
    'SELECT * FROM room_reservations WHERE id = ? AND user_id = ?',
    [reservation_id, uid()]
  );
  if (!res) throw new Error('Reservation not found: ' + reservation_id);
  if (res.status === 'checked_in') throw new Error('Guest already checked in');

  const now = nowISO();

  await ultralight.db.batch([
    {
      sql: 'UPDATE room_reservations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      params: ['checked_in', now, reservation_id, uid()],
    },
    {
      sql: 'UPDATE rooms SET status = ?, current_reservation_id = ?, updated_at = ? WHERE room_number = ? AND user_id = ?',
      params: ['occupied', reservation_id, now, res.room_number, uid()],
    },
  ]);

  const room: RoomRow | null = await ultralight.db.first(
    'SELECT * FROM rooms WHERE room_number = ? AND user_id = ?',
    [res.room_number, uid()]
  );

  return {
    success: true,
    reservation: { ...res, status: 'checked_in' },
    room: room,
  };
}

// ── ROOMS CHECK-OUT ──

export async function rooms_checkout(args: {
  reservation_id: string;
}): Promise<unknown> {
  const { reservation_id } = args;
  if (!reservation_id) throw new Error('reservation_id is required');

  const res: RoomReservationRow | null = await ultralight.db.first(
    'SELECT * FROM room_reservations WHERE id = ? AND user_id = ?',
    [reservation_id, uid()]
  );
  if (!res) throw new Error('Reservation not found: ' + reservation_id);

  const now = nowISO();

  await ultralight.db.batch([
    {
      sql: 'UPDATE room_reservations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      params: ['checked_out', now, reservation_id, uid()],
    },
    {
      sql: 'UPDATE rooms SET status = ?, current_reservation_id = NULL, updated_at = ? WHERE room_number = ? AND user_id = ?',
      params: ['available', now, res.room_number, uid()],
    },
  ]);

  // Gather all unpaid items for this room/guest
  const unpaidRooms: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, payment_amount FROM room_reservations WHERE user_id = ? AND room_number = ? AND payment_status = ? AND id = ?',
    [uid(), res.room_number, 'unpaid', reservation_id]
  );
  const unpaidSki: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, payment_amount FROM ski_rentals WHERE user_id = ? AND room_number = ? AND payment_status = ?',
    [uid(), res.room_number, 'unpaid']
  );
  const unpaidLessons: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, payment_amount FROM ski_lessons WHERE user_id = ? AND room_number = ? AND payment_status = ?',
    [uid(), res.room_number, 'unpaid']
  );
  const unpaidGolf: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, payment_amount FROM tee_times WHERE user_id = ? AND room_number = ? AND payment_status = ?',
    [uid(), res.room_number, 'unpaid']
  );
  const unpaidRestaurant: Pick<PaymentAmountRow, 'id'>[] = await ultralight.db.all(
    'SELECT id FROM restaurant_reservations WHERE user_id = ? AND room_number = ? AND payment_status = ?',
    [uid(), res.room_number, 'unpaid']
  );
  const unpaidStore: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, payment_amount FROM store_transactions WHERE user_id = ? AND room_number = ? AND payment_status = ?',
    [uid(), res.room_number, 'unpaid']
  );

  const unpaid_items = {
    room: { count: unpaidRooms.length, subtotal: sumPaymentAmounts(unpaidRooms) },
    ski_rentals: { count: unpaidSki.length, subtotal: sumPaymentAmounts(unpaidSki) },
    ski_lessons: { count: unpaidLessons.length, subtotal: sumPaymentAmounts(unpaidLessons) },
    golf: { count: unpaidGolf.length, subtotal: sumPaymentAmounts(unpaidGolf) },
    restaurant: { count: unpaidRestaurant.length, subtotal: 0 },
    store: { count: unpaidStore.length, subtotal: sumPaymentAmounts(unpaidStore) },
    grand_total: sumPaymentAmounts(unpaidRooms) + sumPaymentAmounts(unpaidSki) + sumPaymentAmounts(unpaidLessons) + sumPaymentAmounts(unpaidGolf) + sumPaymentAmounts(unpaidStore),
  };

  return {
    success: true,
    reservation: { ...res, status: 'checked_out' },
    unpaid_items: unpaid_items,
  };
}

// ============================================
// 2. SKI — Equipment, Rentals, Lessons
// ============================================

// ── SKI INVENTORY ──

export async function ski_inventory(args: {
  category?: string;
  available_only?: boolean;
}): Promise<unknown> {
  const { category, available_only } = args;

  let sql = 'SELECT *, (qty_total - qty_rented) as qty_available FROM ski_equipment WHERE user_id = ?';
  const params: SqlValue[] = [uid()];

  if (category) {
    sql += ' AND category = ?';
    params.push(category.toLowerCase().trim());
  }
  if (available_only) {
    sql += ' AND (qty_total - qty_rented) > 0';
  }

  sql += ' ORDER BY category, brand, size';
  const equipment: SkiEquipmentRow[] = await ultralight.db.all(sql, params);

  return { equipment: equipment, total: equipment.length };
}

// ── SKI EQUIPMENT MANAGE ──

export async function ski_equipment_manage(args: {
  action: string;
  equipment_id?: string;
  category?: string;
  brand?: string;
  product?: string;
  size?: string;
  gender?: string;
  qty_total?: number;
}): Promise<unknown> {
  const { action, equipment_id, category, brand, product, size, gender, qty_total } = args;
  const now = nowISO();

  if (action === 'add') {
    if (!category) throw new Error('category is required when adding equipment');
    const id = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO ski_equipment (id, user_id, category, brand, product, size, gender, qty_total, qty_rented, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, uid(), category.toLowerCase().trim(), brand || null, product || null, size || null, gender || null, qty_total || 0, 0, now, now]
    );
    const created: SkiEquipmentRow | null = await ultralight.db.first('SELECT *, (qty_total - qty_rented) as qty_available FROM ski_equipment WHERE id = ? AND user_id = ?', [id, uid()]);
    return { success: true, equipment: created };
  }

  if (action === 'update') {
    if (!equipment_id) throw new Error('equipment_id is required for update');

    const setClauses: string[] = ['updated_at = ?'];
    const params: SqlValue[] = [now];
    if (category !== undefined) { setClauses.push('category = ?'); params.push(category.toLowerCase().trim()); }
    if (brand !== undefined) { setClauses.push('brand = ?'); params.push(brand); }
    if (product !== undefined) { setClauses.push('product = ?'); params.push(product); }
    if (size !== undefined) { setClauses.push('size = ?'); params.push(size); }
    if (gender !== undefined) { setClauses.push('gender = ?'); params.push(gender); }
    if (qty_total !== undefined) { setClauses.push('qty_total = ?'); params.push(qty_total); }

    params.push(equipment_id, uid());
    await ultralight.db.run(
      'UPDATE ski_equipment SET ' + setClauses.join(', ') + ' WHERE id = ? AND user_id = ?',
      params
    );
    const updated: SkiEquipmentRow | null = await ultralight.db.first('SELECT *, (qty_total - qty_rented) as qty_available FROM ski_equipment WHERE id = ? AND user_id = ?', [equipment_id, uid()]);
    return { success: true, equipment: updated };
  }

  throw new Error('action must be "add" or "update"');
}

// ── SKI RENT ──

export async function ski_rent(args: {
  guest_name: string;
  room_number?: string;
  tohoku_pass?: boolean;
  equipment_ids: string[];
  payment_method?: string;
  payment_amount?: number;
}): Promise<unknown> {
  const { guest_name, room_number, tohoku_pass, equipment_ids, payment_method, payment_amount } = args;

  if (!guest_name || !equipment_ids || equipment_ids.length === 0) {
    throw new Error('guest_name and equipment_ids are required');
  }

  // Validate availability for all items
  for (const eqId of equipment_ids) {
    const eq: Pick<SkiEquipmentRow, 'id' | 'category' | 'qty_total' | 'qty_rented'> | null = await ultralight.db.first(
      'SELECT id, category, qty_total, qty_rented FROM ski_equipment WHERE id = ? AND user_id = ?',
      [eqId, uid()]
    );
    if (!eq) throw new Error('Equipment not found: ' + eqId);
    if (eq.qty_total - eq.qty_rented <= 0) {
      throw new Error('Equipment ' + eqId + ' (' + eq.category + ') is not available');
    }
  }

  const rentalId = crypto.randomUUID();
  const now = nowISO();
  const name = normalizeGuestName(guest_name);

  const statements: SqlStatement[] = [];

  // Create rental
  statements.push({
    sql: 'INSERT INTO ski_rentals (id, user_id, guest_name, room_number, tohoku_pass, status, payment_method, payment_status, payment_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    params: [rentalId, uid(), name, room_number || null, tohoku_pass ? 1 : 0, 'active', payment_method || null, 'unpaid', payment_amount || 0, now, now],
  });

  // Create junction rows and increment qty_rented
  for (const eqId of equipment_ids) {
    statements.push({
      sql: 'INSERT INTO ski_rental_items (id, user_id, rental_id, equipment_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      params: [crypto.randomUUID(), uid(), rentalId, eqId, now, now],
    });
    statements.push({
      sql: 'UPDATE ski_equipment SET qty_rented = qty_rented + 1, updated_at = ? WHERE id = ? AND user_id = ?',
      params: [now, eqId, uid()],
    });
  }

  await ultralight.db.batch(statements);

  // Fetch the items for the response
  const items: SkiEquipmentRow[] = await ultralight.db.all(
    'SELECT e.* FROM ski_equipment e INNER JOIN ski_rental_items ri ON ri.equipment_id = e.id AND ri.user_id = e.user_id WHERE ri.rental_id = ? AND ri.user_id = ?',
    [rentalId, uid()]
  );

  return {
    success: true,
    rental: { id: rentalId, guest_name: name, room_number: room_number || null, tohoku_pass: !!tohoku_pass, status: 'active' },
    items: items,
    item_count: equipment_ids.length,
  };
}

// ── SKI RETURN ──

export async function ski_return(args: {
  rental_id: string;
}): Promise<unknown> {
  const { rental_id } = args;
  if (!rental_id) throw new Error('rental_id is required');

  const rental: { id: string; status: string } | null = await ultralight.db.first(
    'SELECT * FROM ski_rentals WHERE id = ? AND user_id = ?',
    [rental_id, uid()]
  );
  if (!rental) throw new Error('Rental not found: ' + rental_id);
  if (rental.status === 'returned') throw new Error('Rental already returned');

  const items: EquipmentIdRow[] = await ultralight.db.all(
    'SELECT equipment_id FROM ski_rental_items WHERE rental_id = ? AND user_id = ?',
    [rental_id, uid()]
  );

  const now = nowISO();
  const statements: SqlStatement[] = [];

  statements.push({
    sql: 'UPDATE ski_rentals SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    params: ['returned', now, rental_id, uid()],
  });

  for (const item of items) {
    statements.push({
      sql: 'UPDATE ski_equipment SET qty_rented = MAX(0, qty_rented - 1), updated_at = ? WHERE id = ? AND user_id = ?',
      params: [now, item.equipment_id, uid()],
    });
  }

  await ultralight.db.batch(statements);

  return { success: true, rental_id: rental_id, returned_items: items.length };
}

// ── SKI BOOK LESSON ──

export async function ski_book_lesson(args: {
  guest_name: string;
  room_number?: string;
  lesson_date: string;
  lesson_time: string;
  duration_minutes?: number;
  instructor?: string;
  num_students?: number;
  skill_level?: string;
  payment_method?: string;
  payment_amount?: number;
  notes?: string;
}): Promise<unknown> {
  const { guest_name, room_number, lesson_date, lesson_time, duration_minutes, instructor, num_students, skill_level, payment_method, payment_amount, notes } = args;

  if (!guest_name || !lesson_date || !lesson_time) {
    throw new Error('guest_name, lesson_date, and lesson_time are required');
  }

  const id = crypto.randomUUID();
  const now = nowISO();
  const name = normalizeGuestName(guest_name);

  await ultralight.db.run(
    'INSERT INTO ski_lessons (id, user_id, lesson_date, lesson_time, duration_minutes, instructor, guest_name, room_number, num_students, skill_level, payment_method, payment_status, payment_amount, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), lesson_date, lesson_time, duration_minutes || 60, instructor || null, name, room_number || null, num_students || 1, skill_level || null, payment_method || null, 'unpaid', payment_amount || 0, notes || null, now, now]
  );

  return {
    success: true,
    lesson: { id: id, guest_name: name, lesson_date: lesson_date, lesson_time: lesson_time, instructor: instructor || null, status: 'booked' },
  };
}

// ── SKI LESSONS LIST ──

export async function ski_lessons_list(args: {
  date?: string;
  instructor?: string;
  guest_name?: string;
}): Promise<unknown> {
  const { date, instructor, guest_name } = args;

  let sql = 'SELECT * FROM ski_lessons WHERE user_id = ?';
  const params: SqlValue[] = [uid()];

  if (date) {
    sql += ' AND lesson_date = ?';
    params.push(date);
  }
  if (instructor) {
    sql += ' AND instructor = ?';
    params.push(instructor);
  }
  if (guest_name) {
    sql += ' AND guest_name LIKE ?';
    params.push('%' + normalizeGuestName(guest_name) + '%');
  }

  sql += ' ORDER BY lesson_date ASC, lesson_time ASC';
  const lessons: LessonRow[] = await ultralight.db.all(sql, params);

  return { lessons: lessons, total: lessons.length };
}

// ============================================
// 3. GOLF — Tee Times
// ============================================

// ── GOLF BOOK TEE ──

export async function golf_book_tee(args: {
  guest_name: string;
  room_number?: string;
  tee_date: string;
  tee_time: string;
  starting_hole?: number;
  num_in_party?: number;
  cart_ids?: string[];
  payment_method?: string;
  payment_amount?: number;
  notes?: string;
}): Promise<unknown> {
  const { guest_name, room_number, tee_date, tee_time, starting_hole, num_in_party, cart_ids, payment_method, payment_amount, notes } = args;

  if (!guest_name || !tee_date || !tee_time) {
    throw new Error('guest_name, tee_date, and tee_time are required');
  }

  const teeId = crypto.randomUUID();
  const now = nowISO();
  const name = normalizeGuestName(guest_name);

  const statements: SqlStatement[] = [];

  statements.push({
    sql: 'INSERT INTO tee_times (id, user_id, tee_date, tee_time, guest_name, room_number, starting_hole, num_in_party, payment_method, payment_status, payment_amount, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    params: [teeId, uid(), tee_date, tee_time, name, room_number || null, starting_hole || 1, num_in_party || 1, payment_method || null, 'unpaid', payment_amount || 0, notes || null, now, now],
  });

  if (cart_ids && cart_ids.length > 0) {
    for (const cartId of cart_ids) {
      statements.push({
        sql: 'INSERT INTO tee_time_carts (id, user_id, tee_time_id, cart_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        params: [crypto.randomUUID(), uid(), teeId, cartId, now, now],
      });
    }
  }

  await ultralight.db.batch(statements);

  return {
    success: true,
    tee_time: { id: teeId, guest_name: name, tee_date: tee_date, tee_time: tee_time, starting_hole: starting_hole || 1, num_in_party: num_in_party || 1 },
    carts: cart_ids || [],
  };
}

// ── GOLF AVAILABILITY ──

export async function golf_availability(args: {
  date: string;
  starting_hole?: number;
}): Promise<unknown> {
  const { date, starting_hole } = args;
  if (!date) throw new Error('date is required');

  let sql = 'SELECT * FROM tee_times WHERE user_id = ? AND tee_date = ?';
  const params: SqlValue[] = [uid(), date];

  if (starting_hole) {
    sql += ' AND starting_hole = ?';
    params.push(starting_hole);
  }

  sql += ' ORDER BY tee_time ASC';
  const booked: TeeTimeRow[] = await ultralight.db.all(sql, params);

  // Generate all possible tee times (every 10 minutes from 06:00 to 16:00)
  const allTimes: string[] = [];
  for (let h = 6; h <= 16; h++) {
    for (let m = 0; m < 60; m += 10) {
      if (h === 16 && m > 0) break;
      allTimes.push(h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0'));
    }
  }

  const bookedTimes = new Set(booked.map((teeTime) => teeTime.tee_time));
  const available = allTimes.filter((t) => !bookedTimes.has(t));

  return { date: date, available_times: available, booked: booked, total_booked: booked.length };
}

// ── GOLF CANCEL ──

export async function golf_cancel(args: {
  tee_time_id: string;
}): Promise<unknown> {
  const { tee_time_id } = args;
  if (!tee_time_id) throw new Error('tee_time_id is required');

  const tee: TeeTimeRow | null = await ultralight.db.first(
    'SELECT * FROM tee_times WHERE id = ? AND user_id = ?',
    [tee_time_id, uid()]
  );
  if (!tee) throw new Error('Tee time not found: ' + tee_time_id);

  const now = nowISO();
  await ultralight.db.batch([
    {
      sql: 'DELETE FROM tee_time_carts WHERE tee_time_id = ? AND user_id = ?',
      params: [tee_time_id, uid()],
    },
    {
      sql: 'DELETE FROM tee_times WHERE id = ? AND user_id = ?',
      params: [tee_time_id, uid()],
    },
  ]);

  return { success: true, cancelled: tee };
}

// ============================================
// 4. RESTAURANT
// ============================================

// ── RESTAURANT BOOK ──

export async function restaurant_book(args: {
  guest_name: string;
  room_number?: string;
  res_date: string;
  res_time: string;
  num_people: number;
  set_menu?: string;
  allergies?: string;
  payment_method?: string;
  notes?: string;
}): Promise<unknown> {
  const { guest_name, room_number, res_date, res_time, num_people, set_menu, allergies, payment_method, notes } = args;

  if (!guest_name || !res_date || !res_time) {
    throw new Error('guest_name, res_date, and res_time are required');
  }

  const id = crypto.randomUUID();
  const now = nowISO();
  const name = normalizeGuestName(guest_name);

  await ultralight.db.run(
    'INSERT INTO restaurant_reservations (id, user_id, res_date, res_time, num_people, set_menu, allergies, guest_name, room_number, payment_method, payment_status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), res_date, res_time, num_people || 1, set_menu || null, allergies || null, name, room_number || null, payment_method || null, 'unpaid', notes || null, now, now]
  );

  return {
    success: true,
    reservation: { id: id, guest_name: name, res_date: res_date, res_time: res_time, num_people: num_people || 1, set_menu: set_menu || null },
  };
}

// ── RESTAURANT TODAY ──

export async function restaurant_today(args: {
  date?: string;
}): Promise<unknown> {
  const date = args.date || todayISO();

  const reservations: RestaurantReservationRow[] = await ultralight.db.all(
    'SELECT * FROM restaurant_reservations WHERE user_id = ? AND res_date = ? ORDER BY res_time ASC',
    [uid(), date]
  );

  const totalCovers = reservations.reduce((sum, reservation) => sum + (reservation.num_people || 0), 0);

  return { date: date, reservations: reservations, total_covers: totalCovers, total_reservations: reservations.length };
}

// ── RESTAURANT CANCEL ──

export async function restaurant_cancel(args: {
  reservation_id: string;
}): Promise<unknown> {
  const { reservation_id } = args;
  if (!reservation_id) throw new Error('reservation_id is required');

  const res: RestaurantReservationRow | null = await ultralight.db.first(
    'SELECT * FROM restaurant_reservations WHERE id = ? AND user_id = ?',
    [reservation_id, uid()]
  );
  if (!res) throw new Error('Restaurant reservation not found: ' + reservation_id);

  await ultralight.db.run(
    'DELETE FROM restaurant_reservations WHERE id = ? AND user_id = ?',
    [reservation_id, uid()]
  );

  return { success: true, cancelled: res };
}

// ============================================
// 5. STORE
// ============================================

// ── STORE SELL ──

export async function store_sell(args: {
  product_id: string;
  quantity?: number;
  guest_name?: string;
  room_number?: string;
  payment_method?: string;
  payment_amount?: number;
}): Promise<unknown> {
  const { product_id, quantity, guest_name, room_number, payment_method, payment_amount } = args;

  if (!product_id) throw new Error('product_id is required');

  const product: StoreProductRow | null = await ultralight.db.first(
    'SELECT * FROM store_products WHERE id = ? AND user_id = ?',
    [product_id, uid()]
  );
  if (!product) throw new Error('Product not found: ' + product_id);

  const qty = quantity || 1;
  if (product.qty_available < qty) {
    throw new Error('Insufficient stock. Available: ' + product.qty_available + ', requested: ' + qty);
  }

  const txId = crypto.randomUUID();
  const now = nowISO();
  const amount = payment_amount !== undefined ? payment_amount : product.price * qty;

  await ultralight.db.batch([
    {
      sql: 'INSERT INTO store_transactions (id, user_id, product_id, quantity, guest_name, room_number, payment_method, payment_status, payment_amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params: [txId, uid(), product_id, qty, guest_name ? normalizeGuestName(guest_name) : null, room_number || null, payment_method || null, 'unpaid', amount, now, now],
    },
    {
      sql: 'UPDATE store_products SET qty_available = qty_available - ?, updated_at = ? WHERE id = ? AND user_id = ?',
      params: [qty, now, product_id, uid()],
    },
  ]);

  return {
    success: true,
    transaction: { id: txId, product_id: product_id, product_name: product.name, quantity: qty, amount: amount },
  };
}

// ── STORE INVENTORY ──

export async function store_inventory(args: {
  category?: string;
  low_stock_only?: boolean;
}): Promise<unknown> {
  const { category, low_stock_only } = args;

  let sql = 'SELECT * FROM store_products WHERE user_id = ?';
  const params: SqlValue[] = [uid()];

  if (category) {
    sql += ' AND category = ?';
    params.push(category.toLowerCase().trim());
  }
  if (low_stock_only) {
    sql += ' AND qty_available < 5';
  }

  sql += ' ORDER BY category, name';
  const products: StoreProductRow[] = await ultralight.db.all(sql, params);

  return { products: products, total: products.length };
}

// ── STORE MANAGE ──

export async function store_manage(args: {
  action: string;
  product_id?: string;
  name?: string;
  category?: string;
  brand?: string;
  price?: number;
  qty_add?: number;
}): Promise<unknown> {
  const { action, product_id, name, category, brand, price, qty_add } = args;
  const now = nowISO();

  if (action === 'add') {
    if (!name) throw new Error('name is required when adding a product');
    const id = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO store_products (id, user_id, name, category, brand, price, qty_available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, uid(), name, category ? category.toLowerCase().trim() : null, brand || null, price || 0, qty_add || 0, now, now]
    );
    const created: StoreProductRow | null = await ultralight.db.first('SELECT * FROM store_products WHERE id = ? AND user_id = ?', [id, uid()]);
    return { success: true, product: created };
  }

  if (action === 'restock') {
    if (!product_id || !qty_add) throw new Error('product_id and qty_add are required for restock');
    await ultralight.db.run(
      'UPDATE store_products SET qty_available = qty_available + ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [qty_add, now, product_id, uid()]
    );
    const updated: StoreProductRow | null = await ultralight.db.first('SELECT * FROM store_products WHERE id = ? AND user_id = ?', [product_id, uid()]);
    return { success: true, product: updated };
  }

  if (action === 'update_price') {
    if (!product_id || price === undefined) throw new Error('product_id and price are required for update_price');
    await ultralight.db.run(
      'UPDATE store_products SET price = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [price, now, product_id, uid()]
    );
    const updated: StoreProductRow | null = await ultralight.db.first('SELECT * FROM store_products WHERE id = ? AND user_id = ?', [product_id, uid()]);
    return { success: true, product: updated };
  }

  throw new Error('action must be "add", "restock", or "update_price"');
}

// ── STORE SALES ──

export async function store_sales(args: {
  date?: string;
  guest_name?: string;
  product_id?: string;
  limit?: number;
}): Promise<unknown> {
  const { date, guest_name, product_id, limit } = args;

  let sql = 'SELECT t.*, p.name as product_name, p.category as product_category FROM store_transactions t LEFT JOIN store_products p ON p.id = t.product_id AND p.user_id = t.user_id WHERE t.user_id = ?';
  const params: SqlValue[] = [uid()];

  if (date) {
    sql += ' AND DATE(t.created_at) = ?';
    params.push(date);
  }
  if (guest_name) {
    sql += ' AND t.guest_name LIKE ?';
    params.push('%' + normalizeGuestName(guest_name) + '%');
  }
  if (product_id) {
    sql += ' AND t.product_id = ?';
    params.push(product_id);
  }

  sql += ' ORDER BY t.created_at DESC LIMIT ?';
  params.push(limit || 50);

  const transactions: StoreTransactionRow[] = await ultralight.db.all(sql, params);
  const totalRevenue = transactions.reduce((sum, transaction) => sum + (transaction.payment_amount || 0), 0);

  return { transactions: transactions, total_revenue: totalRevenue, count: transactions.length };
}

// ============================================
// 6. CROSS-DOMAIN — Guest Summary, Billing, Reports
// ============================================

// ── GUEST SUMMARY ──

export async function guest_summary(args: {
  guest_name?: string;
  room_number?: string;
  sections?: string[];
}): Promise<unknown> {
  const { guest_name, room_number } = args;
  // Default sections: lightweight overview. Pass ["all"] or specific sections for more.
  // Available sections: room, reservation, ski_rentals, ski_lessons, tee_times, restaurant, store, billing
  const sections = args.sections || ['room', 'reservation', 'billing'];
  const wantAll = sections.includes('all');
  const want = (s: string) => wantAll || sections.includes(s);

  if (!guest_name && !room_number) {
    throw new Error('Either guest_name or room_number is required');
  }

  let room = null;
  let reservation = null;

  if (room_number) {
    if (want('room')) {
      room = await ultralight.db.first(
        'SELECT * FROM rooms WHERE user_id = ? AND room_number = ?',
        [uid(), room_number]
      );
    }
    reservation = await ultralight.db.first(
      'SELECT * FROM room_reservations WHERE user_id = ? AND room_number = ? AND status IN (?, ?) ORDER BY check_in_date DESC LIMIT 1',
      [uid(), room_number, 'confirmed', 'checked_in']
    );
  }

  // Build filter
  const filterCol = room_number ? 'room_number' : 'guest_name';
  const filterVal = room_number || normalizeGuestName(guest_name!);
  const filterOp = room_number ? '= ?' : 'LIKE ?';
  const filterParam = room_number ? filterVal : '%' + filterVal + '%';

  if (!reservation && guest_name) {
    reservation = await ultralight.db.first(
      'SELECT * FROM room_reservations WHERE user_id = ? AND guest_name LIKE ? AND status IN (?, ?) ORDER BY check_in_date DESC LIMIT 1',
      [uid(), '%' + normalizeGuestName(guest_name) + '%', 'confirmed', 'checked_in']
    );
  }

  // Only fetch detailed sections if requested
  const ski_rentals = want('ski_rentals') ? await ultralight.db.all(
    'SELECT * FROM ski_rentals WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' ORDER BY created_at DESC LIMIT 20',
    [uid(), filterParam]
  ) as PaymentAmountRow[] : [];
  const ski_lessons = want('ski_lessons') ? await ultralight.db.all(
    'SELECT * FROM ski_lessons WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' ORDER BY lesson_date DESC LIMIT 20',
    [uid(), filterParam]
  ) as PaymentAmountRow[] : [];
  const golf_tee_times = want('tee_times') ? await ultralight.db.all(
    'SELECT * FROM tee_times WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' ORDER BY tee_date DESC LIMIT 20',
    [uid(), filterParam]
  ) as PaymentAmountRow[] : [];
  const restaurant = want('restaurant') ? await ultralight.db.all(
    'SELECT * FROM restaurant_reservations WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' ORDER BY res_date DESC LIMIT 20',
    [uid(), filterParam]
  ) as RestaurantReservationRow[] : [];
  const store = want('store') ? await ultralight.db.all(
    'SELECT * FROM store_transactions WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' ORDER BY created_at DESC LIMIT 20',
    [uid(), filterParam]
  ) as PaymentAmountRow[] : [];

  // Always calculate unpaid total (lightweight — uses counts if full data not fetched)
  let total_unpaid = 0;
  if (reservation && reservation.payment_status === 'unpaid') {
    total_unpaid += reservation.payment_amount || 0;
  }

  if (want('billing') || wantAll) {
    // If we already fetched the data, sum from it
    const sumUnpaid = <T extends { payment_status?: string; payment_amount?: number | null }>(items: T[]) =>
      items.filter((item) => item.payment_status === 'unpaid').reduce((sum, item) => sum + (item.payment_amount || 0), 0);

    if (ski_rentals.length || ski_lessons.length || golf_tee_times.length || store.length) {
      total_unpaid += sumUnpaid(ski_rentals) + sumUnpaid(ski_lessons) + sumUnpaid(golf_tee_times) + sumUnpaid(store);
    } else {
      // Fetch just unpaid totals via aggregate queries
      const unpaidSum = async (table: string) => {
        const row: TotalRow | null = await ultralight.db.first(
          'SELECT COALESCE(SUM(payment_amount), 0) as total FROM ' + table + ' WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' AND payment_status = ?',
          [uid(), filterParam, 'unpaid']
        );
        return row?.total || 0;
      };
      total_unpaid += await unpaidSum('ski_rentals') + await unpaidSum('ski_lessons') + await unpaidSum('tee_times') + await unpaidSum('store_transactions');
    }
  }

  const result: Record<string, unknown> = {
    reservation: reservation,
    total_unpaid: total_unpaid,
  };

  if (want('room')) result.room = room;
  if (want('ski_rentals')) result.ski_rentals = ski_rentals;
  if (want('ski_lessons')) result.ski_lessons = ski_lessons;
  if (want('tee_times')) result.tee_times = golf_tee_times;
  if (want('restaurant')) result.restaurant_reservations = restaurant;
  if (want('store')) result.store_purchases = store;
  if (!wantAll && !sections.includes('room')) {
    result._note = 'Default lightweight summary. Pass sections: ["all"] or specific sections like ["ski_rentals", "store"] for full details.';
  }

  return result;
}

// ── GUEST BILLING ──

export async function guest_billing(args: {
  room_number?: string;
  guest_name?: string;
  payment_status?: string;
  itemized?: boolean;
}): Promise<unknown> {
  const { room_number, guest_name } = args;
  const payStatus = args.payment_status || 'unpaid';
  const itemized = args.itemized === true;

  if (!room_number && !guest_name) {
    throw new Error('Either room_number or guest_name is required');
  }

  const filterCol = room_number ? 'room_number' : 'guest_name';
  const filterOp = room_number ? '= ?' : 'LIKE ?';
  const filterParam = room_number || '%' + normalizeGuestName(guest_name!) + '%';

  if (!itemized) {
    // Totals-only mode (default) — fast aggregate queries, minimal response
    const sumFrom = async (table: string) => {
      const row: (NamedCountRow & TotalRow) | null = await ultralight.db.first(
        'SELECT COUNT(*) as count, COALESCE(SUM(payment_amount), 0) as total FROM ' + table + ' WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' AND payment_status = ?',
        [uid(), filterParam, payStatus]
      );
      return { count: row?.count || 0, subtotal: row?.total || 0 };
    };

    const rooms = await sumFrom('room_reservations');
    const ski_rentals = await sumFrom('ski_rentals');
    const ski_lessons = await sumFrom('ski_lessons');
    const golf = await sumFrom('tee_times');
    const restaurant = await sumFrom('restaurant_reservations');
    const store = await sumFrom('store_transactions');

    return {
      rooms, ski_rentals, ski_lessons, golf, restaurant, store,
      grand_total: rooms.subtotal + ski_rentals.subtotal + ski_lessons.subtotal + golf.subtotal + store.subtotal,
      _note: 'Totals-only summary. Pass itemized: true for line-item details.',
    };
  }

  // Itemized mode — full line items
  const roomItems: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, room_number, guest_name, payment_amount, payment_status FROM room_reservations WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' AND payment_status = ? LIMIT 50',
    [uid(), filterParam, payStatus]
  );
  const skiItems: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, room_number, guest_name, payment_amount, payment_status FROM ski_rentals WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' AND payment_status = ? LIMIT 50',
    [uid(), filterParam, payStatus]
  );
  const lessonItems: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, room_number, guest_name, payment_amount, payment_status FROM ski_lessons WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' AND payment_status = ? LIMIT 50',
    [uid(), filterParam, payStatus]
  );
  const golfItems: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, room_number, guest_name, payment_amount, payment_status FROM tee_times WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' AND payment_status = ? LIMIT 50',
    [uid(), filterParam, payStatus]
  );
  const restItems: Pick<PaymentAmountRow, 'id' | 'payment_status'>[] = await ultralight.db.all(
    'SELECT id, room_number, guest_name, payment_status FROM restaurant_reservations WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' AND payment_status = ? LIMIT 50',
    [uid(), filterParam, payStatus]
  );
  const storeItems: PaymentAmountRow[] = await ultralight.db.all(
    'SELECT id, room_number, guest_name, payment_amount, payment_status FROM store_transactions WHERE user_id = ? AND ' + filterCol + ' ' + filterOp + ' AND payment_status = ? LIMIT 50',
    [uid(), filterParam, payStatus]
  );

  return {
    rooms: { items: roomItems, subtotal: sumPaymentAmounts(roomItems) },
    ski_rentals: { items: skiItems, subtotal: sumPaymentAmounts(skiItems) },
    ski_lessons: { items: lessonItems, subtotal: sumPaymentAmounts(lessonItems) },
    golf: { items: golfItems, subtotal: sumPaymentAmounts(golfItems) },
    restaurant: { items: restItems, subtotal: 0 },
    store: { items: storeItems, subtotal: sumPaymentAmounts(storeItems) },
    grand_total: sumPaymentAmounts(roomItems) + sumPaymentAmounts(skiItems) + sumPaymentAmounts(lessonItems) + sumPaymentAmounts(golfItems) + sumPaymentAmounts(storeItems),
  };
}

// ── REPORT DAILY ──

export async function report_daily(args: {
  date?: string;
}): Promise<unknown> {
  const date = args.date || todayISO();

  // Occupancy
  const totalRooms: CountRow | null = await ultralight.db.first('SELECT COUNT(*) as cnt FROM rooms WHERE user_id = ?', [uid()]);
  const occupiedRooms: CountRow | null = await ultralight.db.first('SELECT COUNT(*) as cnt FROM rooms WHERE user_id = ? AND status = ?', [uid(), 'occupied']);
  const total = totalRooms ? totalRooms.cnt : 0;
  const occupied = occupiedRooms ? occupiedRooms.cnt : 0;

  // Check-ins and check-outs for this date
  const checkIns: RoomReservationRow[] = await ultralight.db.all(
    'SELECT * FROM room_reservations WHERE user_id = ? AND check_in_date = ? AND status IN (?, ?)',
    [uid(), date, 'confirmed', 'checked_in']
  );
  const checkOuts: RoomReservationRow[] = await ultralight.db.all(
    'SELECT * FROM room_reservations WHERE user_id = ? AND check_out_date = ? AND status IN (?, ?)',
    [uid(), date, 'checked_in', 'checked_out']
  );

  // Active ski rentals
  const activeRentals: CountRow | null = await ultralight.db.first('SELECT COUNT(*) as cnt FROM ski_rentals WHERE user_id = ? AND status = ?', [uid(), 'active']);

  // Today's lessons
  const lessons: LessonRow[] = await ultralight.db.all('SELECT * FROM ski_lessons WHERE user_id = ? AND lesson_date = ? ORDER BY lesson_time', [uid(), date]);

  // Today's tee times
  const teeTimes: TeeTimeRow[] = await ultralight.db.all('SELECT * FROM tee_times WHERE user_id = ? AND tee_date = ? ORDER BY tee_time', [uid(), date]);

  // Restaurant covers
  const restRow: CoversRow | null = await ultralight.db.first('SELECT COALESCE(SUM(num_people), 0) as covers FROM restaurant_reservations WHERE user_id = ? AND res_date = ?', [uid(), date]);

  // Store revenue today
  const storeRow: { revenue: number } | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as revenue FROM store_transactions WHERE user_id = ? AND DATE(created_at) = ?', [uid(), date]);

  // Pending approvals
  const pendingRow: CountRow | null = await ultralight.db.first('SELECT COUNT(*) as cnt FROM approval_queue WHERE user_id = ? AND status = ?', [uid(), 'pending']);

  // Revenue by service today
  const roomRev: RevenueRow | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as rev FROM room_reservations WHERE user_id = ? AND payment_status = ? AND DATE(updated_at) = ?', [uid(), 'paid', date]);
  const skiRev: RevenueRow | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as rev FROM ski_rentals WHERE user_id = ? AND payment_status = ? AND DATE(updated_at) = ?', [uid(), 'paid', date]);
  const lessonRev: RevenueRow | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as rev FROM ski_lessons WHERE user_id = ? AND payment_status = ? AND DATE(updated_at) = ?', [uid(), 'paid', date]);
  const golfRev: RevenueRow | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as rev FROM tee_times WHERE user_id = ? AND payment_status = ? AND DATE(updated_at) = ?', [uid(), 'paid', date]);

  return {
    date: date,
    occupancy: {
      total_rooms: total,
      occupied: occupied,
      available: total - occupied,
      rate: total > 0 ? Math.round((occupied / total) * 100) + '%' : '0%',
    },
    check_ins: checkIns,
    check_outs: checkOuts,
    ski_rentals_active: activeRentals ? activeRentals.cnt : 0,
    lessons_today: lessons,
    tee_times_today: teeTimes,
    restaurant_covers: restRow ? restRow.covers : 0,
    store_revenue: storeRow ? storeRow.revenue : 0,
    pending_approvals: pendingRow ? pendingRow.cnt : 0,
    revenue_today: {
      rooms: roomRev ? roomRev.rev : 0,
      ski: skiRev ? skiRev.rev : 0,
      lessons: lessonRev ? lessonRev.rev : 0,
      golf: golfRev ? golfRev.rev : 0,
      store: storeRow ? storeRow.revenue : 0,
      total: (roomRev ? roomRev.rev : 0) + (skiRev ? skiRev.rev : 0) + (lessonRev ? lessonRev.rev : 0) + (golfRev ? golfRev.rev : 0) + (storeRow ? storeRow.revenue : 0),
    },
  };
}

// ── REPORT REVENUE ──

export async function report_revenue(args: {
  start_date: string;
  end_date: string;
}): Promise<unknown> {
  const { start_date, end_date } = args;
  if (!start_date || !end_date) throw new Error('start_date and end_date are required');

  const roomRev: RevenueRow | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as rev FROM room_reservations WHERE user_id = ? AND check_in_date >= ? AND check_in_date <= ?', [uid(), start_date, end_date]);
  const skiRev: RevenueRow | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as rev FROM ski_rentals WHERE user_id = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?', [uid(), start_date, end_date]);
  const lessonRev: RevenueRow | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as rev FROM ski_lessons WHERE user_id = ? AND lesson_date >= ? AND lesson_date <= ?', [uid(), start_date, end_date]);
  const golfRev: RevenueRow | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as rev FROM tee_times WHERE user_id = ? AND tee_date >= ? AND tee_date <= ?', [uid(), start_date, end_date]);
  const storeRev: RevenueRow | null = await ultralight.db.first('SELECT COALESCE(SUM(payment_amount), 0) as rev FROM store_transactions WHERE user_id = ? AND DATE(created_at) >= ? AND DATE(created_at) <= ?', [uid(), start_date, end_date]);

  // By payment method
  const byMethod: Array<{ payment_method: string | null; total: number }> = await ultralight.db.all(
    'SELECT payment_method, SUM(payment_amount) as total FROM room_reservations WHERE user_id = ? AND check_in_date >= ? AND check_in_date <= ? AND payment_method IS NOT NULL GROUP BY payment_method',
    [uid(), start_date, end_date]
  );

  // Unpaid total
  const unpaidRow: TotalRow | null = await ultralight.db.first(
    'SELECT COALESCE(SUM(payment_amount), 0) as total FROM room_reservations WHERE user_id = ? AND check_in_date >= ? AND check_in_date <= ? AND payment_status = ?',
    [uid(), start_date, end_date, 'unpaid']
  );

  const methodMap: Record<string, number> = {};
  for (const m of byMethod) {
    methodMap[m.payment_method || 'unknown'] = m.total;
  }

  const rooms = roomRev ? roomRev.rev : 0;
  const ski = skiRev ? skiRev.rev : 0;
  const lessons = lessonRev ? lessonRev.rev : 0;
  const golf = golfRev ? golfRev.rev : 0;
  const store = storeRev ? storeRev.rev : 0;

  return {
    period: { start: start_date, end: end_date },
    by_service: { rooms: rooms, ski_rentals: ski, ski_lessons: lessons, golf: golf, store: store },
    by_payment_method: methodMap,
    total: rooms + ski + lessons + golf + store,
    unpaid: unpaidRow ? unpaidRow.total : 0,
  };
}

// ============================================
// 7. GUIDELINES
// ============================================

// ── GUIDELINES GET ──

export async function guidelines_get(args: {
  key?: string;
  category?: string;
}): Promise<unknown> {
  const { key, category } = args;

  if (key) {
    const row: GuidelineRow | null = await ultralight.db.first(
      'SELECT * FROM guidelines WHERE user_id = ? AND key = ?',
      [uid(), key]
    );
    return { guidelines: row ? [row] : [], total: row ? 1 : 0 };
  }

  let sql = 'SELECT * FROM guidelines WHERE user_id = ?';
  const params: SqlValue[] = [uid()];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY category, key';
  const rows: GuidelineRow[] = await ultralight.db.all(sql, params);

  return { guidelines: rows, total: rows.length };
}

// ── GUIDELINES SET ──

export async function guidelines_set(args: {
  key: string;
  value: string;
  category?: string;
}): Promise<unknown> {
  const { key, value, category } = args;
  if (!key || !value) throw new Error('key and value are required');

  const now = nowISO();
  const existing: Pick<GuidelineRow, 'id'> | null = await ultralight.db.first(
    'SELECT id FROM guidelines WHERE user_id = ? AND key = ?',
    [uid(), key]
  );

  if (existing) {
    await ultralight.db.run(
      'UPDATE guidelines SET value = ?, category = COALESCE(?, category), updated_at = ? WHERE id = ? AND user_id = ?',
      [value, category || null, now, existing.id, uid()]
    );
  } else {
    const id = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO guidelines (id, user_id, key, value, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, uid(), key, value, category || null, now, now]
    );
  }

  return { success: true, guideline: { key: key, value: value, category: category || null } };
}

// ── GUIDELINES REMOVE ──

export async function guidelines_remove(args: {
  key: string;
}): Promise<unknown> {
  const { key } = args;
  if (!key) throw new Error('key is required');

  await ultralight.db.run(
    'DELETE FROM guidelines WHERE user_id = ? AND key = ?',
    [uid(), key]
  );

  return { success: true, removed: true, key: key };
}

// ============================================
// 8. EMAIL AGENT
// ============================================

// ── EMAIL PROCESS ──

export async function email_process(args: {
  emails?: Array<{
    from: string;
    to?: string;
    subject: string;
    body: string;
    thread_id?: string;
  }>;
}): Promise<unknown> {
  const { emails } = args;

  if (!emails || emails.length === 0) {
    return { processed: 0, message: 'No emails provided. Pass emails array or connect to an inbox API.' };
  }

  const now = nowISO();
  const results: Array<Record<string, unknown>> = [];

  // Load guidelines for AI context
  const allGuidelines: Pick<GuidelineRow, 'key' | 'value' | 'category'>[] = await ultralight.db.all(
    'SELECT key, value, category FROM guidelines WHERE user_id = ?',
    [uid()]
  );
  const guidelinesText = allGuidelines.map((guideline) => guideline.key + ': ' + guideline.value).join('\n');

  // Check room availability for context
  const availableRooms: CountRow | null = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM rooms WHERE user_id = ? AND status = ?',
    [uid(), 'available']
  );

  for (const email of emails) {
    // 1. Log inbound email
    const emailId = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO email_log (id, user_id, direction, from_address, to_address, subject, body_text, thread_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [emailId, uid(), 'inbound', email.from, email.to || null, email.subject, email.body, email.thread_id || null, 'processing', now, now]
    );

    try {
      // 2. AI Classification
      const classifyResponse = await ultralight.ai({
        model: 'openai/gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an email classifier for a ski/golf resort. Classify this email and decide whether it needs a reply.\n\nResort guidelines:\n' + guidelinesText + '\n\nAvailable rooms: ' + (availableRooms ? availableRooms.cnt : 0) + '\n\nRespond with JSON only:\n{\n  "classification": "reservation_request|cancellation|inquiry|complaint|confirmation|spam|other",\n  "should_reply": true/false,\n  "reason": "brief explanation",\n  "priority": "high|normal|low",\n  "db_changes": [\n    { "table": "table_name", "action": "insert|update|delete", "data": {}, "reason": "why this change" }\n  ]\n}'
          },
          {
            role: 'user',
            content: 'From: ' + email.from + '\nSubject: ' + email.subject + '\n\n' + email.body,
          },
        ],
      });

      let classification: EmailClassificationResult;
      try {
        const content = classifyResponse.content || classifyResponse.text || '';
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
        classification = JSON.parse(jsonMatch[1] || content) as EmailClassificationResult;
      } catch (e) {
        classification = { classification: 'other', should_reply: false, reason: 'Failed to parse AI classification', priority: 'normal', db_changes: [] };
      }

      // Update email log with classification
      await ultralight.db.run(
        'UPDATE email_log SET classification = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [classification.classification, 'queued', now, emailId, uid()]
      );

      // 3. If should reply, draft a response
      if (classification.should_reply) {
        // Look up guest data if we can identify them
        let guestContext = '';
        const guestReservation: Pick<RoomReservationRow, 'guest_name' | 'room_number' | 'check_in_date' | 'check_out_date'> | null = await ultralight.db.first(
          'SELECT * FROM room_reservations WHERE user_id = ? AND status IN (?, ?) ORDER BY check_in_date DESC LIMIT 1',
          [uid(), 'confirmed', 'checked_in']
        );
        if (guestReservation) {
          guestContext = '\nGuest context: ' + guestReservation.guest_name + ' in room ' + guestReservation.room_number + ', check-in: ' + guestReservation.check_in_date + ', check-out: ' + guestReservation.check_out_date;
        }

        const draftResponse = await ultralight.ai({
          model: 'openai/gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'Draft a professional reply for this resort email. Be warm, helpful, and accurate.\n\nResort guidelines:\n' + guidelinesText + guestContext + '\n\nMatch the language of the incoming email (Japanese/English).',
            },
            {
              role: 'user',
              content: 'Reply to:\nFrom: ' + email.from + '\nSubject: ' + email.subject + '\n\n' + email.body + '\n\nClassification: ' + classification.classification,
            },
          ],
        });

        const draftBody = draftResponse.content || draftResponse.text || '';

        // Queue email reply approval
        const approvalId = crypto.randomUUID();
        await ultralight.db.run(
          'INSERT INTO approval_queue (id, user_id, type, status, priority, title, summary, payload, original_email_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [approvalId, uid(), 'email_reply', 'pending', classification.priority || 'normal',
            'Reply to: ' + email.subject,
            'From ' + email.from + ' — ' + classification.reason,
            JSON.stringify({ to: email.from, subject: 'Re: ' + email.subject, draft_body: draftBody, original_body: email.body }),
            emailId, now, now]
        );

        await ultralight.db.run(
          'UPDATE email_log SET approval_id = ?, updated_at = ? WHERE id = ? AND user_id = ?',
          [approvalId, now, emailId, uid()]
        );

        results.push({ email_id: emailId, classification: classification.classification, action: 'reply_queued', approval_id: approvalId });
      } else {
        // Queue skip notification
        const approvalId = crypto.randomUUID();
        await ultralight.db.run(
          'INSERT INTO approval_queue (id, user_id, type, status, priority, title, summary, payload, original_email_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [approvalId, uid(), 'email_skip', 'pending', 'low',
            'Skip: ' + email.subject,
            classification.reason,
            JSON.stringify({ from: email.from, subject: email.subject, reason: classification.reason, original_body: email.body }),
            emailId, now, now]
        );

        results.push({ email_id: emailId, classification: classification.classification, action: 'skip_queued', approval_id: approvalId });
      }

      // 4. Queue any suggested DB changes
      if (classification.db_changes && classification.db_changes.length > 0) {
        for (const change of classification.db_changes) {
          const changeApprovalId = crypto.randomUUID();
          await ultralight.db.run(
            'INSERT INTO approval_queue (id, user_id, type, status, priority, title, summary, payload, original_email_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [changeApprovalId, uid(), 'db_change', 'pending', classification.priority || 'normal',
              'DB: ' + change.action + ' ' + change.table,
              change.reason,
              JSON.stringify(change),
              emailId, now, now]
          );
        }
      }
    } catch (err) {
      await ultralight.db.run(
        'UPDATE email_log SET status = ?, error_message = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        ['failed', err instanceof Error ? err.message : String(err), now, emailId, uid()]
      );
      results.push({ email_id: emailId, action: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { processed: results.length, results: results };
}

// ── EMAIL SEND ──

export async function email_send(args: {
  to: string;
  subject: string;
  body: string;
  in_reply_to?: string;
}): Promise<unknown> {
  const { to, subject, body, in_reply_to } = args;

  if (!to || !subject || !body) throw new Error('to, subject, and body are required');

  const apiKey = ultralight.env.RESEND_API_KEY;
  const fromAddress = ultralight.env.RESORT_EMAIL_ADDRESS || 'resort@resend.dev';
  const resortName = ultralight.env.RESORT_NAME || 'Resort';

  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured. Set it via ul.set env vars.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resortName + ' <' + fromAddress + '>',
      to: [to],
      subject: subject,
      html: body.replace(/\n/g, '<br>'),
    }),
  });

  const now = nowISO();
  const emailId = crypto.randomUUID();

  if (response.ok) {
    await ultralight.db.run(
      'INSERT INTO email_log (id, user_id, direction, from_address, to_address, subject, body_html, in_reply_to, status, sent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [emailId, uid(), 'outbound', fromAddress, to, subject, body, in_reply_to || null, 'sent', now, now, now]
    );
    return { success: true, email_id: emailId, to: to, subject: subject };
  } else {
    const errBody = await response.text();
    await ultralight.db.run(
      'INSERT INTO email_log (id, user_id, direction, from_address, to_address, subject, body_html, status, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [emailId, uid(), 'outbound', fromAddress, to, subject, body, 'failed', errBody, now, now]
    );
    throw new Error('Email send failed: ' + errBody);
  }
}

// ── EMAIL LOG LIST ──

export async function email_log_list(args: {
  direction?: string;
  status?: string;
  limit?: number;
}): Promise<unknown> {
  const { direction, status, limit } = args;

  let sql = 'SELECT id, direction, from_address, to_address, subject, classification, status, sent_at, created_at FROM email_log WHERE user_id = ?';
  const params: SqlValue[] = [uid()];

  if (direction) {
    sql += ' AND direction = ?';
    params.push(direction);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit || 50);

  const emails = await ultralight.db.all(sql, params);
  return { emails: emails, total: emails.length };
}

// ============================================
// 9. APPROVAL QUEUE
// ============================================

// ── APPROVALS LIST ──

export async function approvals_list(args: {
  status?: string;
  type?: string;
  limit?: number;
}): Promise<unknown> {
  const targetStatus = args.status || 'pending';
  const { type, limit } = args;

  let sql = 'SELECT * FROM approval_queue WHERE user_id = ? AND status = ?';
  const params: SqlValue[] = [uid(), targetStatus];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  sql += ' ORDER BY CASE priority WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 WHEN \'low\' THEN 3 END, created_at ASC LIMIT ?';
  params.push(limit || 20);

  const approvals: ApprovalQueueRow[] = await ultralight.db.all(sql, params);

  // Parse payloads
  const parsed: ParsedApprovalQueueRow[] = approvals.map((approval) => ({
    ...approval,
    payload: parseJsonObject(approval.payload),
  }));

  // Counts
  const pendingRow: CountRow | null = await ultralight.db.first('SELECT COUNT(*) as cnt FROM approval_queue WHERE user_id = ? AND status = ?', [uid(), 'pending']);
  const todayApproved: CountRow | null = await ultralight.db.first('SELECT COUNT(*) as cnt FROM approval_queue WHERE user_id = ? AND status = ? AND DATE(resolved_at) = ?', [uid(), 'executed', todayISO()]);
  const todayRejected: CountRow | null = await ultralight.db.first('SELECT COUNT(*) as cnt FROM approval_queue WHERE user_id = ? AND status = ? AND DATE(resolved_at) = ?', [uid(), 'rejected', todayISO()]);

  return {
    approvals: parsed,
    total: parsed.length,
    counts: {
      pending: pendingRow ? pendingRow.cnt : 0,
      approved_today: todayApproved ? todayApproved.cnt : 0,
      rejected_today: todayRejected ? todayRejected.cnt : 0,
    },
  };
}

// ── APPROVALS ACT ──

export async function approvals_act(args: {
  approval_id: string;
  action: string;
  revision?: string;
  admin_notes?: string;
}): Promise<unknown> {
  const { approval_id, action, revision, admin_notes } = args;

  if (!approval_id || !action) throw new Error('approval_id and action are required');
  if (!['approve', 'reject', 'revise'].includes(action)) throw new Error('action must be "approve", "reject", or "revise"');

  const approval: ApprovalQueueRow | null = await ultralight.db.first(
    'SELECT * FROM approval_queue WHERE id = ? AND user_id = ?',
    [approval_id, uid()]
  );
  if (!approval) throw new Error('Approval not found: ' + approval_id);
  if (approval.status !== 'pending') throw new Error('Approval already resolved: ' + approval.status);

  const payload = parseJsonObject(approval.payload);
  const now = nowISO();
  let result: unknown = null;

  if (action === 'reject') {
    await ultralight.db.run(
      'UPDATE approval_queue SET status = ?, admin_notes = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      ['rejected', admin_notes || null, now, now, approval_id, uid()]
    );
    return { success: true, approval_id: approval_id, action: 'rejected' };
  }

  // Approve or revise
  if (approval.type === 'email_reply') {
    const emailBody = revision || (typeof payload.draft_body === 'string' ? payload.draft_body : '');
    const to = typeof payload.to === 'string' ? payload.to : '';
    const subject = typeof payload.subject === 'string' ? payload.subject : '';
    try {
      result = await email_send({
        to,
        subject,
        body: emailBody,
        in_reply_to: approval.original_email_id || undefined,
      });
    } catch (err) {
      // Still mark as executed but record the error
      result = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (approval.type === 'email_skip' && action === 'revise' && revision) {
    // Admin overrides skip — create a new reply approval with the revision as draft
    const newApprovalId = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO approval_queue (id, user_id, type, status, priority, title, summary, payload, original_email_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newApprovalId, uid(), 'email_reply', 'pending', 'normal',
        'Override reply: ' + payload.subject,
        'Admin requested reply to previously skipped email',
        JSON.stringify({ to: payload.from, subject: 'Re: ' + payload.subject, draft_body: revision, original_body: payload.original_body }),
        approval.original_email_id, now, now]
    );
    result = { new_approval_id: newApprovalId, message: 'Reply draft created for approval' };
  }

  if (approval.type === 'db_change') {
    // Execute the proposed DB change
    // Note: We reconstruct the SQL from the structured payload for safety
    try {
      const data = asRecord(payload.data);
      if (payload.action === 'insert' && payload.table && data) {
        const keys = Object.keys(data);
        const vals = Object.values(data);
        const placeholders = keys.map(() => '?').join(', ');
        await ultralight.db.run(
          'INSERT INTO ' + payload.table + ' (id, user_id, ' + keys.join(', ') + ', created_at, updated_at) VALUES (?, ?, ' + placeholders + ', ?, ?)',
          [crypto.randomUUID(), uid(), ...vals, now, now]
        );
        result = { table: payload.table, action: 'inserted', data };
      } else if (payload.action === 'update' && payload.table && data && data.id) {
        const id = data.id;
        const updates = Object.entries(data).filter(([key]) => key !== 'id');
        const setClauses = updates.map(([k]) => k + ' = ?').join(', ');
        const vals = updates.map(([_, v]) => v);
        await ultralight.db.run(
          'UPDATE ' + payload.table + ' SET ' + setClauses + ', updated_at = ? WHERE id = ? AND user_id = ?',
          [...vals, now, id, uid()]
        );
        result = { table: payload.table, action: 'updated', id: id };
      } else {
        result = { message: 'DB change not auto-executable. Please apply manually.', payload: payload };
      }
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const finalStatus = action === 'revise' ? 'revised' : 'executed';
  await ultralight.db.run(
    'UPDATE approval_queue SET status = ?, admin_notes = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [finalStatus, admin_notes || null, now, now, approval_id, uid()]
  );

  return { success: true, approval_id: approval_id, action: finalStatus, result: result };
}

// ============================================
// 10. ADMIN & DB ACCESS
// ============================================

// ── DB BROWSE ──

export async function db_browse(args: {
  sql: string;
  params?: unknown[];
  mode?: string;
}): Promise<unknown> {
  const { sql, params, mode } = args;

  if (!sql) throw new Error('sql is required');

  const queryMode = mode || 'read';
  const trimmed = sql.trim().toUpperCase();

  if (queryMode === 'read') {
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
      throw new Error('Read mode only allows SELECT/WITH queries. Set mode: "write" for mutations.');
    }
  }

  // Auto-inject user_id filtering — the SDK requires it
  let finalSql = sql;
  const queryParams: unknown[] = params ? [...params] : [];

  // If query doesn't already reference user_id, inject it
  if (!sql.toLowerCase().includes('user_id')) {
    // For SELECT queries, inject WHERE user_id = ? (or AND user_id = ?)
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH')) {
      if (sql.toLowerCase().includes('where')) {
        finalSql = sql.replace(/where/i, 'WHERE user_id = ? AND');
      } else {
        // Insert before ORDER BY, LIMIT, GROUP BY, or at end
        const insertPoint = sql.search(/\b(order\s+by|limit|group\s+by)\b/i);
        if (insertPoint > 0) {
          finalSql = sql.slice(0, insertPoint) + ' WHERE user_id = ? ' + sql.slice(insertPoint);
        } else {
          finalSql = sql + ' WHERE user_id = ?';
        }
      }
      queryParams.unshift(uid());
    } else {
      // For write queries, add user_id constraint
      if (sql.toLowerCase().includes('where')) {
        finalSql = sql.replace(/where/i, 'WHERE user_id = ? AND');
      } else {
        finalSql = sql + ' WHERE user_id = ?';
      }
      queryParams.unshift(uid());
    }
  }

  // Enforce LIMIT on read queries to prevent unbounded result sets
  if (queryMode === 'read') {
    if (!/\bLIMIT\b/i.test(finalSql)) {
      finalSql += ' LIMIT 100';
    }

    const rows: Array<Record<string, unknown>> = await ultralight.db.all(finalSql, queryParams);
    return {
      rows: rows,
      meta: {
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        row_count: rows.length,
        limit_applied: !/\bLIMIT\b/i.test(sql), // true if we auto-injected LIMIT
      },
    };
  } else {
    const result = await ultralight.db.run(finalSql, queryParams);
    return { success: true, result: result };
  }
}

// ── DB TABLES ──

export async function db_tables(args: {}): Promise<unknown> {
  // Static schema reflection — we know our own tables
  const tables = [
    'rooms', 'room_reservations', 'ski_equipment', 'ski_rentals', 'ski_rental_items',
    'ski_lessons', 'tee_times', 'tee_time_carts', 'restaurant_reservations',
    'store_products', 'store_transactions', 'guidelines', 'approval_queue', 'email_log',
  ];

  const result: Array<{ name: string; row_count: number; error?: string }> = [];

  for (const table of tables) {
    try {
      const countRow: CountRow | null = await ultralight.db.first(
        'SELECT COUNT(*) as cnt FROM ' + table + ' WHERE user_id = ?',
        [uid()]
      );
      result.push({
        name: table,
        row_count: countRow ? countRow.cnt : 0,
      });
    } catch (e) {
      result.push({ name: table, row_count: 0, error: 'table may not exist yet' });
    }
  }

  return { tables: result, total: result.length };
}
