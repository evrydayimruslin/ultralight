// Smart Budget — Ultralight MCP App
// Track spending, manage budgets, and get financial insights.
// Storage: Ultralight D1 (transactions, budgets)

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
  const id = crypto.randomUUID();
  const txType = type || 'expense';
  const now = new Date().toISOString();
  const cat = category.toLowerCase().trim();

  await ultralight.db.run(
    'INSERT INTO transactions (id, user_id, amount, category, description, date, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, amount, cat, description || '', txDate, txType, now, now]
  );

  return {
    success: true,
    transaction_id: id,
    amount: amount,
    category: cat,
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
  const monthStart = targetMonth + '-01';
  const monthEnd = targetMonth + '-31';

  let sql = 'SELECT * FROM transactions WHERE user_id = ? AND date >= ? AND date <= ?';
  const params: any[] = [ultralight.user.id, monthStart, monthEnd];

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
    transactions: transactions,
    net_total: total,
  };
}

// ── MONTHLY SUMMARY ──

export async function summary(args: {
  month?: string;
}): Promise<unknown> {
  const { month } = args;
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const monthStart = targetMonth + '-01';
  const monthEnd = targetMonth + '-31';

  const byCategory = await ultralight.db.all(
    'SELECT category, type, COUNT(*) as count, SUM(amount) as total FROM transactions WHERE user_id = ? AND date >= ? AND date <= ? GROUP BY category, type',
    [ultralight.user.id, monthStart, monthEnd]
  );

  const categoryMap: Record<string, { spent: number; income: number; count: number }> = {};
  let totalSpent = 0;
  let totalIncome = 0;
  let transactionCount = 0;

  for (const row of byCategory) {
    if (!categoryMap[row.category]) {
      categoryMap[row.category] = { spent: 0, income: 0, count: 0 };
    }
    categoryMap[row.category].count += row.count;
    transactionCount += row.count;
    if (row.type === 'income') {
      categoryMap[row.category].income += row.total;
      totalIncome += row.total;
    } else {
      categoryMap[row.category].spent += row.total;
      totalSpent += row.total;
    }
  }

  // Check budgets for warnings
  const budgetWarnings: Array<{ category: string; limit: number; spent: number }> = [];
  for (const cat of Object.keys(categoryMap)) {
    const budgetData = await ultralight.db.first(
      'SELECT * FROM budgets WHERE user_id = ? AND category = ?',
      [ultralight.user.id, cat]
    );
    if (budgetData && budgetData.limit_amount) {
      if (categoryMap[cat].spent > budgetData.limit_amount * 0.8) {
        budgetWarnings.push({
          category: cat,
          limit: budgetData.limit_amount,
          spent: categoryMap[cat].spent,
        });
      }
    }
  }

  return {
    month: targetMonth,
    total_spent: totalSpent,
    total_income: totalIncome,
    net: totalIncome - totalSpent,
    transaction_count: transactionCount,
    by_category: categoryMap,
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

  // If limit_amount provided or action is "set", set the budget
  if (limit_amount !== undefined || action === 'set') {
    if (!category) {
      return { success: false, error: 'category is required when setting a budget' };
    }
    const cat = category.toLowerCase().trim();
    const now = new Date().toISOString();
    const per = period || 'monthly';

    const existing = await ultralight.db.first(
      'SELECT id FROM budgets WHERE user_id = ? AND category = ?',
      [ultralight.user.id, cat]
    );

    if (existing) {
      await ultralight.db.run(
        'UPDATE budgets SET limit_amount = ?, period = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [limit_amount || 0, per, now, existing.id, ultralight.user.id]
      );
    } else {
      const id = crypto.randomUUID();
      await ultralight.db.run(
        'INSERT INTO budgets (id, user_id, category, limit_amount, period, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, ultralight.user.id, cat, limit_amount || 0, per, now, now]
      );
    }

    return { success: true, budget: { category: cat, limit_amount: limit_amount || 0, period: per, updated_at: now } };
  }

  // Otherwise, view budgets
  const budgets = await ultralight.db.all(
    'SELECT * FROM budgets WHERE user_id = ?',
    [ultralight.user.id]
  );

  if (budgets.length === 0) {
    return { budgets: [], message: 'No budgets set yet. Use budget with category and limit_amount to set one.' };
  }

  return {
    budgets: budgets,
  };
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthStart = currentMonth + '-01';
  const monthEnd = currentMonth + '-31';

  const txSummary = await ultralight.db.first(
    'SELECT COUNT(*) as count, COALESCE(SUM(CASE WHEN type = \'expense\' THEN amount ELSE 0 END), 0) as total_spent, COALESCE(SUM(CASE WHEN type = \'income\' THEN amount ELSE 0 END), 0) as total_income, COUNT(DISTINCT category) as categories_used FROM transactions WHERE user_id = ? AND date >= ? AND date <= ?',
    [ultralight.user.id, monthStart, monthEnd]
  );

  const budgetCount = await ultralight.db.first(
    'SELECT COUNT(*) as count FROM budgets WHERE user_id = ?',
    [ultralight.user.id]
  );

  return {
    current_month: currentMonth,
    transaction_count: txSummary?.count || 0,
    total_spent: txSummary?.total_spent || 0,
    total_income: txSummary?.total_income || 0,
    net: (txSummary?.total_income || 0) - (txSummary?.total_spent || 0),
    categories_used: txSummary?.categories_used || 0,
    budgets_set: budgetCount?.count || 0,
  };
}
