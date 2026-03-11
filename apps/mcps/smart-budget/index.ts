// Smart Budget — Ultralight MCP App
// Track spending, manage budgets, and get financial insights.
// Storage: Ultralight KV (transactions, budgets, categories)

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
  const yearMonth = txDate.slice(0, 7); // "2026-03"
  const id = crypto.randomUUID();
  const txType = type || 'expense';

  const transaction = {
    id: id,
    amount: amount,
    category: category.toLowerCase().trim(),
    description: description || '',
    date: txDate,
    type: txType,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('transactions/' + yearMonth + '/' + id, transaction);

  // Auto-add category if new
  const catData = await ultralight.load('categories');
  const categories: string[] = (catData && (catData as any).list) ? (catData as any).list : [];
  if (!categories.includes(transaction.category)) {
    categories.push(transaction.category);
    await ultralight.store('categories', { list: categories });
  }

  return {
    success: true,
    transaction_id: id,
    amount: amount,
    category: transaction.category,
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
  const prefix = 'transactions/' + targetMonth + '/';

  const results = await ultralight.query(prefix, {
    filter: (item: any) => {
      if (category && item.category !== category.toLowerCase().trim()) return false;
      if (type && item.type !== type) return false;
      return true;
    },
    sort: { field: 'date', order: 'desc' },
    limit: limit || 50,
  });

  const transactions = results.map((r: any) => r.value);
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
  const prefix = 'transactions/' + targetMonth + '/';

  const results = await ultralight.query(prefix, {});
  const transactions = results.map((r: any) => r.value);

  const byCategory: Record<string, { spent: number; income: number; count: number }> = {};
  let totalSpent = 0;
  let totalIncome = 0;

  for (const tx of transactions) {
    const cat = tx.category;
    if (!byCategory[cat]) {
      byCategory[cat] = { spent: 0, income: 0, count: 0 };
    }
    byCategory[cat].count += 1;
    if (tx.type === 'income') {
      byCategory[cat].income += tx.amount;
      totalIncome += tx.amount;
    } else {
      byCategory[cat].spent += tx.amount;
      totalSpent += tx.amount;
    }
  }

  // Check budgets for warnings
  const budgetWarnings: Array<{ category: string; limit: number; spent: number }> = [];
  for (const cat of Object.keys(byCategory)) {
    const budgetData = await ultralight.load('budgets/' + cat);
    if (budgetData && (budgetData as any).limit_amount) {
      const limit = (budgetData as any).limit_amount;
      if (byCategory[cat].spent > limit * 0.8) {
        budgetWarnings.push({
          category: cat,
          limit: limit,
          spent: byCategory[cat].spent,
        });
      }
    }
  }

  return {
    month: targetMonth,
    total_spent: totalSpent,
    total_income: totalIncome,
    net: totalIncome - totalSpent,
    transaction_count: transactions.length,
    by_category: byCategory,
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
    const budgetData = {
      category: category.toLowerCase().trim(),
      limit_amount: limit_amount || 0,
      period: period || 'monthly',
      updated_at: new Date().toISOString(),
    };
    await ultralight.store('budgets/' + budgetData.category, budgetData);
    return { success: true, budget: budgetData };
  }

  // Otherwise, view budgets
  const keys = await ultralight.list('budgets/');
  if (keys.length === 0) {
    return { budgets: [], message: 'No budgets set yet. Use budget with category and limit_amount to set one.' };
  }

  const budgets = await ultralight.batchLoad(keys);
  return {
    budgets: budgets.map((b: any) => b.value),
  };
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const prefix = 'transactions/' + currentMonth + '/';
  const results = await ultralight.query(prefix, {});
  const transactions = results.map((r: any) => r.value);

  let totalSpent = 0;
  let totalIncome = 0;
  const categories = new Set<string>();

  for (const tx of transactions) {
    categories.add(tx.category);
    if (tx.type === 'income') {
      totalIncome += tx.amount;
    } else {
      totalSpent += tx.amount;
    }
  }

  const budgetKeys = await ultralight.list('budgets/');

  return {
    current_month: currentMonth,
    transaction_count: transactions.length,
    total_spent: totalSpent,
    total_income: totalIncome,
    net: totalIncome - totalSpent,
    categories_used: categories.size,
    budgets_set: budgetKeys.length,
  };
}
