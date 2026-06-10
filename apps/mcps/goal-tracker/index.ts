// Goal Tracker — Ultralight MCP App
// Set goals, break them into milestones, and track progress over time.
// Storage: Ultralight D1 (goals, milestones, progress_logs)

const ultralight = (globalThis as any).ultralight;

// ── ADD GOAL ──

export async function add_goal(args: {
  name: string;
  description?: string;
  target_date?: string;
  milestones?: Array<{ name: string; target_date?: string }>;
}): Promise<unknown> {
  const { name, description, target_date, milestones } = args;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO goals (id, user_id, name, description, target_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, name, description || '', target_date || null, 'active', now, now]
  );

  // Create milestones if provided
  let milestonesCreated = 0;
  if (milestones && milestones.length > 0) {
    for (let idx = 0; idx < milestones.length; idx++) {
      const m = milestones[idx];
      const mId = crypto.randomUUID();
      await ultralight.db.run(
        'INSERT INTO milestones (id, user_id, goal_id, name, target_date, completed, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [mId, ultralight.user.id, id, m.name, m.target_date || null, 0, idx, now, now]
      );
      milestonesCreated++;
    }
  }

  return {
    success: true,
    goal_id: id,
    name: name,
    milestones_created: milestonesCreated,
  };
}

// ── ADD MILESTONE ──

export async function add_milestone(args: {
  goal_id: string;
  name: string;
  target_date?: string;
}): Promise<unknown> {
  const { goal_id, name, target_date } = args;

  const goal = await ultralight.db.first(
    'SELECT * FROM goals WHERE id = ? AND user_id = ?',
    [goal_id, ultralight.user.id]
  );
  if (!goal) {
    return { success: false, error: 'Goal not found: ' + goal_id };
  }

  // Get existing milestones count for ordering
  const countRow = await ultralight.db.first(
    'SELECT COUNT(*) as count FROM milestones WHERE user_id = ? AND goal_id = ?',
    [ultralight.user.id, goal_id]
  );

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO milestones (id, user_id, goal_id, name, target_date, completed, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, goal_id, name, target_date || null, 0, countRow?.count || 0, now, now]
  );

  return {
    success: true,
    milestone_id: id,
    goal_id: goal_id,
    name: name,
  };
}

// ── UPDATE PROGRESS ──

export async function update(args: {
  goal_id?: string;
  milestone_id?: string;
  completed?: boolean;
  notes?: string;
  percent_complete?: number;
  status?: string;
}): Promise<unknown> {
  const { goal_id, milestone_id, completed, notes, percent_complete, status } = args;

  // Update a milestone
  if (milestone_id && goal_id) {
    const milestone = await ultralight.db.first(
      'SELECT * FROM milestones WHERE id = ? AND user_id = ? AND goal_id = ?',
      [milestone_id, ultralight.user.id, goal_id]
    );
    if (!milestone) {
      return { success: false, error: 'Milestone not found' };
    }

    const now = new Date().toISOString();
    const newCompleted = completed !== undefined ? (completed ? 1 : 0) : milestone.completed;
    const newCompletedAt = completed ? now : (completed === false ? null : milestone.completed_at);

    await ultralight.db.run(
      'UPDATE milestones SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [newCompleted, newCompletedAt, now, milestone_id, ultralight.user.id]
    );

    return { success: true, milestone: { ...milestone, completed: newCompleted, completed_at: newCompletedAt } };
  }

  // Update a goal
  if (goal_id) {
    const goal = await ultralight.db.first(
      'SELECT * FROM goals WHERE id = ? AND user_id = ?',
      [goal_id, ultralight.user.id]
    );
    if (!goal) {
      return { success: false, error: 'Goal not found' };
    }

    const now = new Date().toISOString();
    let newStatus = goal.status;
    if (status) newStatus = status;
    if (completed) newStatus = 'completed';

    await ultralight.db.run(
      'UPDATE goals SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [newStatus, now, goal_id, ultralight.user.id]
    );

    // Log progress entry
    if (notes || percent_complete !== undefined) {
      const today = new Date().toISOString().split('T')[0];
      const progressId = crypto.randomUUID();
      await ultralight.db.run(
        'INSERT INTO progress_logs (id, user_id, goal_id, date, notes, percent_complete, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [progressId, ultralight.user.id, goal_id, today, notes || '', percent_complete !== undefined ? percent_complete : null, now, now]
      );
    }

    return { success: true, goal: { ...goal, status: newStatus } };
  }

  return { success: false, error: 'Provide goal_id (and optionally milestone_id) to update' };
}

// ── LIST GOALS ──

export async function list(args: {
  status?: string;
  limit?: number;
}): Promise<unknown> {
  const { status: filterStatus, limit } = args;

  let sql = 'SELECT * FROM goals WHERE user_id = ?';
  const params: any[] = [ultralight.user.id];

  if (filterStatus && filterStatus !== 'all') {
    sql += ' AND status = ?';
    params.push(filterStatus);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit || 20);

  const goalRows = await ultralight.db.all(sql, params);

  const goals = [];
  for (const goal of goalRows) {
    const milestones = await ultralight.db.all(
      'SELECT * FROM milestones WHERE user_id = ? AND goal_id = ? ORDER BY sort_order ASC',
      [ultralight.user.id, goal.id]
    );

    const completedCount = milestones.filter((m: any) => m.completed).length;
    const progress = milestones.length > 0
      ? Math.round((completedCount / milestones.length) * 100)
      : 0;

    goals.push({
      id: goal.id,
      name: goal.name,
      description: goal.description,
      status: goal.status,
      target_date: goal.target_date,
      milestones: milestones,
      progress_percent: progress,
      milestones_completed: completedCount,
      milestones_total: milestones.length,
    });
  }

  return { goals: goals, count: goals.length };
}

// ── REVIEW ──

export async function review(args?: {}): Promise<unknown> {
  const goalRows = await ultralight.db.all(
    'SELECT * FROM goals WHERE user_id = ? AND status = ?',
    [ultralight.user.id, 'active']
  );

  const today = new Date().toISOString().split('T')[0];
  const overdue: any[] = [];
  const upcoming: any[] = [];
  const summaries: any[] = [];

  for (const goal of goalRows) {
    const milestones = await ultralight.db.all(
      'SELECT * FROM milestones WHERE user_id = ? AND goal_id = ?',
      [ultralight.user.id, goal.id]
    );

    const completedCount = milestones.filter((m: any) => m.completed).length;
    const progress = milestones.length > 0
      ? Math.round((completedCount / milestones.length) * 100)
      : 0;

    summaries.push({
      name: goal.name,
      progress_percent: progress,
      target_date: goal.target_date,
    });

    if (goal.target_date && goal.target_date < today) {
      overdue.push({ name: goal.name, target_date: goal.target_date });
    }

    // Check upcoming milestones (within 7 days)
    const sevenDaysLater = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    for (const m of milestones) {
      if (!m.completed && m.target_date && m.target_date >= today && m.target_date <= sevenDaysLater) {
        upcoming.push({ goal: goal.name, milestone: m.name, target_date: m.target_date });
      }
    }
  }

  return {
    active_goals: summaries.length,
    summaries: summaries,
    overdue: overdue,
    upcoming_milestones: upcoming,
  };
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const stats = await ultralight.db.first(
    'SELECT COUNT(*) as total, SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN status = \'completed\' THEN 1 ELSE 0 END) as completed FROM goals WHERE user_id = ?',
    [ultralight.user.id]
  );

  return {
    total_goals: stats?.total || 0,
    active: stats?.active || 0,
    completed: stats?.completed || 0,
  };
}
