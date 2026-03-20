// Home Inventory — Ultralight MCP App
// Catalog belongings for insurance, moving, or organization.
// Storage: Ultralight D1 (items)

const ultralight = (globalThis as any).ultralight;

// ── ADD ITEM ──

export async function add(args: {
  name: string;
  location: string;
  value?: number;
  category?: string;
  notes?: string;
  purchase_date?: string;
  warranty_expires?: string;
}): Promise<unknown> {
  const { name, location, value, category, notes, purchase_date, warranty_expires } = args;
  const id = crypto.randomUUID();
  const loc = location.toLowerCase().trim();
  const cat = category ? category.toLowerCase().trim() : 'uncategorized';
  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO items (id, user_id, name, location, category, value, notes, purchase_date, warranty_expires, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, name, loc, cat, value || 0, notes || '', purchase_date || null, warranty_expires || null, now, now]
  );

  return {
    success: true,
    item_id: id,
    name: name,
    location: loc,
    category: cat,
    value: value || 0,
  };
}

// ── LIST ITEMS ──

export async function list(args: {
  location?: string;
  category?: string;
  limit?: number;
}): Promise<unknown> {
  const { location, category, limit } = args;

  let sql = 'SELECT * FROM items WHERE user_id = ?';
  const params: any[] = [ultralight.user.id];

  if (location) {
    sql += ' AND location = ?';
    params.push(location.toLowerCase().trim());
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category.toLowerCase().trim());
  }

  sql += ' ORDER BY name ASC LIMIT ?';
  params.push(limit || 100);

  const items = await ultralight.db.all(sql, params);
  const totalValue = items.reduce((sum: number, item: any) => sum + (item.value || 0), 0);

  return {
    items: items,
    count: items.length,
    total_value: totalValue,
  };
}

// ── SEARCH ITEMS ──

export async function search(args: {
  query: string;
}): Promise<unknown> {
  const { query } = args;
  const q = '%' + query.toLowerCase() + '%';

  const results = await ultralight.db.all(
    'SELECT * FROM items WHERE user_id = ? AND (LOWER(name) LIKE ? OR LOWER(notes) LIKE ? OR LOWER(location) LIKE ? OR LOWER(category) LIKE ?) ORDER BY name ASC',
    [ultralight.user.id, q, q, q, q]
  );

  return {
    query: query,
    results: results,
    count: results.length,
  };
}

// ── VALUE SUMMARY ──

export async function value(args: {
  location?: string;
  category?: string;
}): Promise<unknown> {
  const { location, category } = args;

  let filterSql = 'WHERE user_id = ?';
  const params: any[] = [ultralight.user.id];

  if (location) {
    filterSql += ' AND location = ?';
    params.push(location.toLowerCase().trim());
  }
  if (category) {
    filterSql += ' AND category = ?';
    params.push(category.toLowerCase().trim());
  }

  const groupBy = location ? 'category' : 'location';

  const breakdown = await ultralight.db.all(
    'SELECT ' + groupBy + ' as group_key, COUNT(*) as count, SUM(value) as total_value FROM items ' + filterSql + ' GROUP BY ' + groupBy,
    params
  );

  const grouped: Record<string, { count: number; total_value: number }> = {};
  let grandTotal = 0;
  let itemCount = 0;

  for (const row of breakdown) {
    grouped[row.group_key] = { count: row.count, total_value: row.total_value };
    grandTotal += row.total_value || 0;
    itemCount += row.count;
  }

  return {
    total_value: grandTotal,
    item_count: itemCount,
    grouped_by: groupBy,
    breakdown: grouped,
  };
}

// ── EXPORT FOR INSURANCE ──

export async function export_summary(args: {
  format?: string;
}): Promise<unknown> {
  const items = await ultralight.db.all(
    'SELECT * FROM items WHERE user_id = ? ORDER BY location ASC, name ASC',
    [ultralight.user.id]
  );

  // Group by location
  const byLocation: Record<string, any[]> = {};
  let grandTotal = 0;

  for (const item of items) {
    if (!byLocation[item.location]) {
      byLocation[item.location] = [];
    }
    byLocation[item.location].push({
      name: item.name,
      category: item.category,
      value: item.value,
      purchase_date: item.purchase_date,
      warranty_expires: item.warranty_expires,
      notes: item.notes,
    });
    grandTotal += item.value || 0;
  }

  return {
    title: 'Home Inventory Summary',
    generated_at: new Date().toISOString(),
    total_items: items.length,
    total_value: grandTotal,
    by_location: byLocation,
  };
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const stats = await ultralight.db.first(
    'SELECT COUNT(*) as total_items, COUNT(DISTINCT location) as total_locations, COUNT(DISTINCT category) as total_categories, COALESCE(SUM(value), 0) as total_value FROM items WHERE user_id = ?',
    [ultralight.user.id]
  );

  return {
    total_items: stats?.total_items || 0,
    total_locations: stats?.total_locations || 0,
    total_categories: stats?.total_categories || 0,
    total_value: stats?.total_value || 0,
  };
}
