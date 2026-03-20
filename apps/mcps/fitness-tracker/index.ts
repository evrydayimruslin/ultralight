// Fitness Tracker — Ultralight MCP App
// Log meals, workouts, sleep, and body metrics. AI-powered calorie estimation.
// Storage: Ultralight D1 | Permissions: ai:call

const ultralight = (globalThis as any).ultralight;

function today(): string {
  return new Date().toISOString().split('T')[0];
}

// ── LOG MEAL ──

export async function log_meal(args: {
  description: string;
  meal_type?: string;
  date?: string;
}): Promise<unknown> {
  const { description, meal_type, date } = args;
  const mealDate = date || today();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // AI calorie estimation
  let nutrition = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  try {
    const response = await ultralight.ai({
      model: 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a nutrition estimator. Given a food description, estimate the nutritional content. Respond with ONLY valid JSON, no markdown. Format: {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}',
        },
        {
          role: 'user',
          content: 'Estimate nutrition for: ' + description,
        },
      ],
    });
    const text = response.content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    nutrition = JSON.parse(text);
  } catch (e) {
    // If AI fails, store with zero values — user can update later
  }

  await ultralight.db.run(
    'INSERT INTO meals (id, user_id, description, meal_type, date, calories, protein_g, carbs_g, fat_g, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, description, meal_type || 'meal', mealDate, nutrition.calories, nutrition.protein_g, nutrition.carbs_g, nutrition.fat_g, now, now]
  );

  return {
    success: true,
    meal_id: id,
    description: description,
    calories: nutrition.calories,
    protein_g: nutrition.protein_g,
    carbs_g: nutrition.carbs_g,
    fat_g: nutrition.fat_g,
  };
}

// ── LOG WORKOUT ──

export async function log_workout(args: {
  type: string;
  duration_min: number;
  calories_burned?: number;
  notes?: string;
  date?: string;
}): Promise<unknown> {
  const { type, duration_min, calories_burned, notes, date } = args;
  const workoutDate = date || today();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO workouts (id, user_id, type, duration_min, calories_burned, notes, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, type, duration_min, calories_burned || 0, notes || '', workoutDate, now, now]
  );

  return {
    success: true,
    workout_id: id,
    type: type,
    duration_min: duration_min,
    calories_burned: calories_burned || 0,
  };
}

// ── LOG SLEEP ──

export async function log_sleep(args: {
  hours: number;
  quality?: number;
  notes?: string;
  date?: string;
}): Promise<unknown> {
  const { hours, quality, notes, date } = args;
  const sleepDate = date || today();
  const now = new Date().toISOString();
  const qualityVal = quality !== undefined ? Math.min(5, Math.max(1, quality)) : null;

  // Upsert: replace if already logged for this date
  const existing = await ultralight.db.first(
    'SELECT id FROM sleep_logs WHERE user_id = ? AND date = ?',
    [ultralight.user.id, sleepDate]
  );

  if (existing) {
    await ultralight.db.run(
      'UPDATE sleep_logs SET hours = ?, quality = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [hours, qualityVal, notes || '', now, existing.id, ultralight.user.id]
    );
  } else {
    const id = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO sleep_logs (id, user_id, hours, quality, notes, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, ultralight.user.id, hours, qualityVal, notes || '', sleepDate, now, now]
    );
  }

  return {
    success: true,
    date: sleepDate,
    hours: hours,
    quality: qualityVal,
  };
}

// ── LOG WEIGHT ──

export async function log_weight(args: {
  value: number;
  unit?: string;
  date?: string;
}): Promise<unknown> {
  const { value, unit, date } = args;
  const weightDate = date || today();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await ultralight.db.run(
    'INSERT INTO weight_logs (id, user_id, value, unit, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, value, unit || 'lbs', weightDate, now, now]
  );

  return {
    success: true,
    date: weightDate,
    value: value,
    unit: unit || 'lbs',
  };
}

// ── SUMMARY ──

export async function summary(args: {
  period?: string;
  date?: string;
}): Promise<unknown> {
  const { period, date } = args;
  const targetDate = date || today();

  if (period === 'weekly') {
    // Get the last 7 days
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(targetDate);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    const startDate = days[days.length - 1];
    const endDate = days[0];

    const mealStats = await ultralight.db.first(
      'SELECT COUNT(*) as count, COALESCE(SUM(calories), 0) as total_calories, COALESCE(SUM(protein_g), 0) as protein_g, COALESCE(SUM(carbs_g), 0) as carbs_g, COALESCE(SUM(fat_g), 0) as fat_g FROM meals WHERE user_id = ? AND date >= ? AND date <= ?',
      [ultralight.user.id, startDate, endDate]
    );

    const workoutStats = await ultralight.db.first(
      'SELECT COUNT(*) as count, COALESCE(SUM(duration_min), 0) as total_minutes, COALESCE(SUM(calories_burned), 0) as total_calories_burned FROM workouts WHERE user_id = ? AND date >= ? AND date <= ?',
      [ultralight.user.id, startDate, endDate]
    );

    const sleepStats = await ultralight.db.first(
      'SELECT COUNT(*) as days_logged, COALESCE(AVG(hours), 0) as avg_hours FROM sleep_logs WHERE user_id = ? AND date >= ? AND date <= ?',
      [ultralight.user.id, startDate, endDate]
    );

    return {
      period: 'weekly',
      days: 7,
      meals: {
        count: mealStats?.count || 0,
        total_calories: mealStats?.total_calories || 0,
        avg_daily_calories: Math.round((mealStats?.total_calories || 0) / 7),
        protein_g: mealStats?.protein_g || 0,
        carbs_g: mealStats?.carbs_g || 0,
        fat_g: mealStats?.fat_g || 0,
      },
      workouts: {
        count: workoutStats?.count || 0,
        total_minutes: workoutStats?.total_minutes || 0,
        total_calories_burned: workoutStats?.total_calories_burned || 0,
      },
      sleep: {
        days_logged: sleepStats?.days_logged || 0,
        avg_hours: sleepStats?.days_logged > 0 ? Math.round(sleepStats.avg_hours * 10) / 10 : 0,
      },
    };
  }

  // Default: daily summary
  const meals = await ultralight.db.all(
    'SELECT * FROM meals WHERE user_id = ? AND date = ?',
    [ultralight.user.id, targetDate]
  );

  const workouts = await ultralight.db.all(
    'SELECT * FROM workouts WHERE user_id = ? AND date = ?',
    [ultralight.user.id, targetDate]
  );

  const daySleep = await ultralight.db.first(
    'SELECT * FROM sleep_logs WHERE user_id = ? AND date = ?',
    [ultralight.user.id, targetDate]
  );

  const dayWeight = await ultralight.db.first(
    'SELECT * FROM weight_logs WHERE user_id = ? AND date = ? ORDER BY created_at DESC',
    [ultralight.user.id, targetDate]
  );

  let totalCal = 0;
  let totalProt = 0;
  let totalCarb = 0;
  let totalFatD = 0;
  for (const meal of meals) {
    totalCal += meal.calories || 0;
    totalProt += meal.protein_g || 0;
    totalCarb += meal.carbs_g || 0;
    totalFatD += meal.fat_g || 0;
  }

  let workoutMin = 0;
  let calBurned = 0;
  for (const workout of workouts) {
    workoutMin += workout.duration_min || 0;
    calBurned += workout.calories_burned || 0;
  }

  return {
    period: 'daily',
    date: targetDate,
    meals: { items: meals, total_calories: totalCal, protein_g: totalProt, carbs_g: totalCarb, fat_g: totalFatD },
    workouts: { items: workouts, total_minutes: workoutMin, calories_burned: calBurned },
    sleep: daySleep || null,
    weight: dayWeight || null,
    net_calories: totalCal - calBurned,
  };
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const todayStr = today();

  const mealCount = await ultralight.db.first(
    'SELECT COUNT(*) as count FROM meals WHERE user_id = ? AND date = ?',
    [ultralight.user.id, todayStr]
  );

  const workoutCount = await ultralight.db.first(
    'SELECT COUNT(*) as count FROM workouts WHERE user_id = ? AND date = ?',
    [ultralight.user.id, todayStr]
  );

  const todaySleep = await ultralight.db.first(
    'SELECT id FROM sleep_logs WHERE user_id = ? AND date = ?',
    [ultralight.user.id, todayStr]
  );

  const todayWeight = await ultralight.db.first(
    'SELECT id FROM weight_logs WHERE user_id = ? AND date = ?',
    [ultralight.user.id, todayStr]
  );

  return {
    date: todayStr,
    meals_logged_today: mealCount?.count || 0,
    workouts_logged_today: workoutCount?.count || 0,
    sleep_logged_today: todaySleep ? true : false,
    weight_logged_today: todayWeight ? true : false,
  };
}
