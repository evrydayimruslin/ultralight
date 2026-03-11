// Home Inventory — Ultralight MCP App
// Catalog belongings for insurance, moving, or organization.
// Storage: Ultralight KV (items, locations, categories)

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

  const item = {
    id: id,
    name: name,
    location: loc,
    value: value || 0,
    category: cat,
    notes: notes || '',
    purchase_date: purchase_date || null,
    warranty_expires: warranty_expires || null,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('items/' + id, item);

  // Update location index
  const locData = await ultralight.load('locations/' + loc) as any;
  if (locData) {
    locData.item_count = (locData.item_count || 0) + 1;
    await ultralight.store('locations/' + loc, locData);
  } else {
    await ultralight.store('locations/' + loc, { name: loc, description: '', item_count: 1 });
  }

  // Update category index
  const catData = await ultralight.load('categories/' + cat) as any;
  if (catData) {
    catData.item_count = (catData.item_count || 0) + 1;
    await ultralight.store('categories/' + cat, catData);
  } else {
    await ultralight.store('categories/' + cat, { name: cat, item_count: 1 });
  }

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

  const results = await ultralight.query('items/', {
    filter: (item: any) => {
      if (location && item.location !== location.toLowerCase().trim()) return false;
      if (category && item.category !== category.toLowerCase().trim()) return false;
      return true;
    },
    sort: { field: 'name', order: 'asc' },
    limit: limit || 100,
  });

  const items = results.map((r: any) => r.value);
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
  const q = query.toLowerCase();

  const results = await ultralight.query('items/', {
    filter: (item: any) => {
      return (
        item.name.toLowerCase().includes(q) ||
        (item.notes && item.notes.toLowerCase().includes(q)) ||
        item.location.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    },
    sort: { field: 'name', order: 'asc' },
  });

  return {
    query: query,
    results: results.map((r: any) => r.value),
    count: results.length,
  };
}

// ── VALUE SUMMARY ──

export async function value(args: {
  location?: string;
  category?: string;
}): Promise<unknown> {
  const { location, category } = args;

  const results = await ultralight.query('items/', {
    filter: (item: any) => {
      if (location && item.location !== location.toLowerCase().trim()) return false;
      if (category && item.category !== category.toLowerCase().trim()) return false;
      return true;
    },
  });

  const items = results.map((r: any) => r.value);

  // Group by the requested dimension
  const groupBy = location ? 'category' : 'location';
  const grouped: Record<string, { count: number; total_value: number }> = {};

  for (const item of items) {
    const key = item[groupBy];
    if (!grouped[key]) {
      grouped[key] = { count: 0, total_value: 0 };
    }
    grouped[key].count += 1;
    grouped[key].total_value += item.value || 0;
  }

  const grandTotal = items.reduce((sum: number, item: any) => sum + (item.value || 0), 0);

  return {
    total_value: grandTotal,
    item_count: items.length,
    grouped_by: groupBy,
    breakdown: grouped,
  };
}

// ── EXPORT FOR INSURANCE ──

export async function export_summary(args: {
  format?: string;
}): Promise<unknown> {
  const results = await ultralight.query('items/', {
    sort: { field: 'location', order: 'asc' },
  });

  const items = results.map((r: any) => r.value);

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
  const itemKeys = await ultralight.list('items/');
  const locationKeys = await ultralight.list('locations/');
  const categoryKeys = await ultralight.list('categories/');

  let totalValue = 0;
  if (itemKeys.length > 0) {
    const items = await ultralight.batchLoad(itemKeys);
    for (const i of items) {
      totalValue += ((i.value as any)?.value) || 0;
    }
  }

  return {
    total_items: itemKeys.length,
    total_locations: locationKeys.length,
    total_categories: categoryKeys.length,
    total_value: totalValue,
  };
}
