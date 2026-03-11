// Goal Tracker — Ultralight MCP App
// Set goals, break them into milestones, and track progress over time.
// Storage: Ultralight KV (goals, milestones, progress)

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

  const goal = {
    id: id,
    name: name,
    description: description || '',
    target_date: target_date || null,
    status: 'active',
    created_at: new Date().toISOString(),
  };

  await ultralight.store('goals/' + id, goal);

  // Create milestones if provided
  const createdMilestones: any[] = [];
  if (milestones && milestones.length > 0) {
    const items = milestones.map((m, idx) => {
      const mId = crypto.randomUUID();
      const milestone = {
        id: mId,
        goal_id: id,
        name: m.name,
        target_date: m.target_date || null,
        completed: false,
        completed_at: null,
        order: idx,
        created_at: new Date().toISOString(),
      };
      createdMilestones.push(milestone);
      return { key: 'milestones/' + id + '/' + mId, value: milestone };
    });
    await ultralight.batchStore(items);
  }

  return {
    success: true,
    goal_id: id,
    name: name,
    milestones_created: createdMilestones.length,
  };
}

// ── ADD MILESTONE ──

export async function add_milestone(args: {
  goal_id: string;
  name: string;
  target_date?: string;
}): Promise<unknown> {
  const { goal_id, name, target_date } = args;

  const goal = await ultralight.load('goals/' + goal_id);
  if (!goal) {
    return { success: false, error: 'Goal not found: ' + goal_id };
  }

  // Get existing milestones count for ordering
  const existingKeys = await ultralight.list('milestones/' + goal_id + '/');
  const id = crypto.randomUUID();

  const milestone = {
    id: id,
    goal_id: goal_id,
    name: name,
    target_date: target_date || null,
    completed: false,
    completed_at: null,
    order: existingKeys.length,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('milestones/' + goal_id + '/' + id, milestone);

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
    const milestone = await ultralight.load('milestones/' + goal_id + '/' + milestone_id) as any;
    if (!milestone) {
      return { success: false, error: 'Milestone not found' };
    }
    if (completed !== undefined) {
      milestone.completed = completed;
      milestone.completed_at = completed ? new Date().toISOString() : null;
    }
    await ultralight.store('milestones/' + goal_id + '/' + milestone_id, milestone);
    return { success: true, milestone: milestone };
  }

  // Update a goal
  if (goal_id) {
    const goal = await ultralight.load('goals/' + goal_id) as any;
    if (!goal) {
      return { success: false, error: 'Goal not found' };
    }
    if (status) goal.status = status;
    if (completed) goal.status = 'completed';
    await ultralight.store('goals/' + goal_id, goal);

    // Log progress entry
    if (notes || percent_complete !== undefined) {
      const today = new Date().toISOString().split('T')[0];
      await ultralight.store('progress/' + goal_id + '/' + today, {
        goal_id: goal_id,
        date: today,
        notes: notes || '',
        percent_complete: percent_complete !== undefined ? percent_complete : null,
        created_at: new Date().toISOString(),
      });
    }

    return { success: true, goal: goal };
  }

  return { success: false, error: 'Provide goal_id (and optionally milestone_id) to update' };
}

// ── LIST GOALS ──

export async function list(args: {
  status?: string;
  limit?: number;
}): Promise<unknown> {
  const { status: filterStatus, limit } = args;

  const goalResults = await ultralight.query('goals/', {
    filter: (item: any) => {
      if (filterStatus && filterStatus !== 'all' && item.status !== filterStatus) return false;
      return true;
    },
    sort: { field: 'created_at', order: 'desc' },
    limit: limit || 20,
  });

  const goals = [];
  for (const gr of goalResults) {
    const goal = gr.value as any;
    const milestoneKeys = await ultralight.list('milestones/' + goal.id + '/');
    let milestones: any[] = [];
    if (milestoneKeys.length > 0) {
      const loaded = await ultralight.batchLoad(milestoneKeys);
      milestones = loaded.map((m: any) => m.value).sort((a: any, b: any) => a.order - b.order);
    }
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
  const goalResults = await ultralight.query('goals/', {
    filter: (item: any) => item.status === 'active',
  });

  const today = new Date().toISOString().split('T')[0];
  const overdue: any[] = [];
  const upcoming: any[] = [];
  const summaries: any[] = [];

  for (const gr of goalResults) {
    const goal = gr.value as any;
    const milestoneKeys = await ultralight.list('milestones/' + goal.id + '/');
    let milestones: any[] = [];
    if (milestoneKeys.length > 0) {
      const loaded = await ultralight.batchLoad(milestoneKeys);
      milestones = loaded.map((m: any) => m.value);
    }

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
    for (const m of milestones) {
      if (!m.completed && m.target_date && m.target_date >= today && m.target_date <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]) {
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
  const goalKeys = await ultralight.list('goals/');
  let active = 0;
  let completed = 0;

  if (goalKeys.length > 0) {
    const goals = await ultralight.batchLoad(goalKeys);
    for (const g of goals) {
      const goal = g.value as any;
      if (goal.status === 'active') active++;
      if (goal.status === 'completed') completed++;
    }
  }

  return {
    total_goals: goalKeys.length,
    active: active,
    completed: completed,
  };
}
