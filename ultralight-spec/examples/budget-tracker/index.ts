// Smart Budget — Ultralight MCP App (D1 SQL)
// Track spending, manage budgets, and get financial insights.
// Storage: Cloudflare D1 via ultralight.db

const ultralight = (globalThis as any).ultralight;

// ── ADD TRANSACTION ──

export async function add(args: {
  amount: number;
  category: string;
  description?: string;
  date?: string;
  type?: string;
}): Promise<unknown> {
  const { amount, category, description, date, type } = args;
  const txDate = date || new Date().toISOString().split('T')[0];
  const txType = type || 'expense';
  const id = crypto.randomUUID();

  await ultralight.db.run(
    `INSERT INTO transactions (id, user_id, amount, category, description, type, date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, ultralight.user.id, amount, category.toLowerCase().trim(), description || '', txType, txDate]
  );

  return {
    success: true,
    transaction_id: id,
    amount,
    category: category.toLowerCase().trim(),
    type: txType,
    date: txDate,
  };
}

// ── LIST TRANSACTIONS ──

export async function list(args: {
  category?: string;
  month?: string;
  type?: string;
  limit?: number;
}): Promise<unknown> {
  const { category, month, type, limit } = args;
  const targetMonth = month || new Date().toISOString().slice(0, 7);

  let sql = 'SELECT * FROM transactions WHERE user_id = ? AND date LIKE ?';
  const params: unknown[] = [ultralight.user.id, `${targetMonth}%`];

  if (category) {
    sql += ' AND category = ?';
    params.push(category.toLowerCase().trim());
  }
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  sql += ' ORDER BY date DESC LIMIT ?';
  params.push(limit || 50);

  const transactions = await ultralight.db.all(sql, params);

  const total = transactions.reduce((sum: number, t: any) => {
    return t.type === 'income' ? sum + t.amount : sum - t.amount;
  }, 0);

  return {
    month: targetMonth,
    count: transactions.length,
    transactions,
    net_total: total,
  };
}

// ── MONTHLY SUMMARY (single indexed query with GROUP BY) ──

export async function summary(args: {
  month?: string;
}): Promise<unknown> {
  const targetMonth = args.month || new Date().toISOString().slice(0, 7);

  const byCategory = await ultralight.db.all(
    `SELECT category, type, COUNT(*) as count, SUM(amount) as total
     FROM transactions
     WHERE user_id = ? AND date LIKE ?
     GROUP BY category, type`,
    [ultralight.user.id, `${targetMonth}%`]
  );

  let totalSpent = 0;
  let totalIncome = 0;
  const categories: Record<string, { spent: number; income: number; count: number }> = {};

  for (const row of byCategory as any[]) {
    if (!categories[row.category]) {
      categories[row.category] = { spent: 0, income: 0, count: 0 };
    }
    categories[row.category].count += row.count;
    if (row.type === 'income') {
      categories[row.category].income += row.total;
      totalIncome += row.total;
    } else {
      categories[row.category].spent += row.total;
      totalSpent += row.total;
    }
  }

  // Check budgets for warnings
  const budgets = await ultralight.db.all(
    'SELECT category, limit_amount FROM budgets WHERE user_id = ?',
    [ultralight.user.id]
  );

  const budgetWarnings: Array<{ category: string; limit: number; spent: number }> = [];
  for (const b of budgets as any[]) {
    const catData = categories[b.category];
    if (catData && catData.spent > b.limit_amount * 0.8) {
      budgetWarnings.push({ category: b.category, limit: b.limit_amount, spent: catData.spent });
    }
  }

  return {
    month: targetMonth,
    total_spent: totalSpent,
    total_income: totalIncome,
    net: totalIncome - totalSpent,
    transaction_count: (byCategory as any[]).reduce((sum: number, r: any) => sum + r.count, 0),
    by_category: categories,
    budget_warnings: budgetWarnings,
  };
}

// ── BUDGET MANAGEMENT ──

export async function budget(args: {
  action?: string;
  category?: string;
  limit_amount?: number;
  period?: string;
}): Promise<unknown> {
  const { action, category, limit_amount, period } = args;

  if (limit_amount !== undefined || action === 'set') {
    if (!category) {
      return { success: false, error: 'category is required when setting a budget' };
    }

    const id = crypto.randomUUID();
    const cat = category.toLowerCase().trim();

    await ultralight.db.run(
      `INSERT INTO budgets (id, user_id, category, limit_amount, period)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, category) DO UPDATE SET
         limit_amount = ?, period = ?, updated_at = datetime('now')`,
      [id, ultralight.user.id, cat, limit_amount || 0, period || 'monthly', limit_amount || 0, period || 'monthly']
    );

    return { success: true, category: cat, limit_amount: limit_amount || 0, period: period || 'monthly' };
  }

  const budgets = await ultralight.db.all(
    'SELECT * FROM budgets WHERE user_id = ? ORDER BY category',
    [ultralight.user.id]
  );

  if ((budgets as any[]).length === 0) {
    return { budgets: [], message: 'No budgets set yet. Use budget with category and limit_amount to set one.' };
  }

  return { budgets };
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const currentMonth = new Date().toISOString().slice(0, 7);

  const stats = await ultralight.db.first(
    `SELECT
       COUNT(*) as transaction_count,
       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_spent,
       COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
       COUNT(DISTINCT category) as categories_used
     FROM transactions
     WHERE user_id = ? AND date LIKE ?`,
    [ultralight.user.id, `${currentMonth}%`]
  ) as any;

  const budgetCount = await ultralight.db.first(
    'SELECT COUNT(*) as count FROM budgets WHERE user_id = ?',
    [ultralight.user.id]
  ) as any;

  return {
    current_month: currentMonth,
    transaction_count: stats?.transaction_count || 0,
    total_spent: stats?.total_spent || 0,
    total_income: stats?.total_income || 0,
    net: (stats?.total_income || 0) - (stats?.total_spent || 0),
    categories_used: stats?.categories_used || 0,
    budgets_set: budgetCount?.count || 0,
  };
}
