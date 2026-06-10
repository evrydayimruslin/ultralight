// Ultralight App Template — D1 SQL
// Replace "items" with your domain (e.g., "tasks", "recipes", "notes").
// Every query uses ultralight.user.id for data isolation.

const ultralight = (globalThis as any).ultralight;

// ── CREATE ──

export async function add(args: {
  name: string;
  category?: string;
  value?: number;
}): Promise<unknown> {
  const { name, category, value } = args;
  const id = crypto.randomUUID();

  await ultralight.db.run(
    `INSERT INTO items (id, user_id, name, category, value)
     VALUES (?, ?, ?, ?, ?)`,
    [id, ultralight.user.id, name, category || 'uncategorized', value || 0]
  );

  return { success: true, id, name };
}

// ── READ (LIST) ──

export async function list(args: {
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<unknown> {
  const { category, limit, offset } = args;

  let sql = 'SELECT * FROM items WHERE user_id = ?';
  const params: unknown[] = [ultralight.user.id];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit || 50, offset || 0);

  const items = await ultralight.db.all(sql, params);
  return { items, count: items.length };
}

// ── READ (SINGLE) ──

export async function get(args: { id: string }): Promise<unknown> {
  const item = await ultralight.db.first(
    'SELECT * FROM items WHERE user_id = ? AND id = ?',
    [ultralight.user.id, args.id]
  );

  if (!item) return { error: 'Not found' };
  return item;
}

// ── UPDATE ──

export async function update(args: {
  id: string;
  name?: string;
  category?: string;
  value?: number;
}): Promise<unknown> {
  const { id, name, category, value } = args;

  const existing = await ultralight.db.first(
    'SELECT * FROM items WHERE user_id = ? AND id = ?',
    [ultralight.user.id, id]
  );

  if (!existing) return { error: 'Not found' };

  await ultralight.db.run(
    `UPDATE items SET name = ?, category = ?, value = ?, updated_at = datetime('now')
     WHERE user_id = ? AND id = ?`,
    [
      name ?? (existing as any).name,
      category ?? (existing as any).category,
      value ?? (existing as any).value,
      ultralight.user.id,
      id,
    ]
  );

  return { success: true, id };
}

// ── DELETE ──

export async function remove(args: { id: string }): Promise<unknown> {
  const result = await ultralight.db.run(
    'DELETE FROM items WHERE user_id = ? AND id = ?',
    [ultralight.user.id, args.id]
  );

  return { success: true, deleted: result.meta.changes };
}

// ── SUMMARY ──

export async function summary(args?: {}): Promise<unknown> {
  const stats = await ultralight.db.all(
    `SELECT category, COUNT(*) as count, SUM(value) as total_value
     FROM items WHERE user_id = ? GROUP BY category ORDER BY total_value DESC`,
    [ultralight.user.id]
  );

  const total = await ultralight.db.first(
    'SELECT COUNT(*) as count, SUM(value) as total_value FROM items WHERE user_id = ?',
    [ultralight.user.id]
  );

  return { categories: stats, total };
}
