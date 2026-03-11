// Fitness Tracker — Ultralight MCP App
// Log meals, workouts, sleep, and body metrics. AI-powered calorie estimation.
// Storage: Ultralight KV | Permissions: ai:call

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

  const meal = {
    id: id,
    description: description,
    meal_type: meal_type || 'meal',
    date: mealDate,
    calories: nutrition.calories,
    protein_g: nutrition.protein_g,
    carbs_g: nutrition.carbs_g,
    fat_g: nutrition.fat_g,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('meals/' + mealDate + '/' + id, meal);

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

  const workout = {
    id: id,
    type: type,
    duration_min: duration_min,
    calories_burned: calories_burned || 0,
    notes: notes || '',
    date: workoutDate,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('workouts/' + workoutDate + '/' + id, workout);

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

  const entry = {
    hours: hours,
    quality: quality !== undefined ? Math.min(5, Math.max(1, quality)) : null,
    notes: notes || '',
    date: sleepDate,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('sleep/' + sleepDate, entry);

  return {
    success: true,
    date: sleepDate,
    hours: hours,
    quality: entry.quality,
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

  const entry = {
    value: value,
    unit: unit || 'lbs',
    date: weightDate,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('weight/' + weightDate, entry);

  return {
    success: true,
    date: weightDate,
    value: value,
    unit: entry.unit,
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

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let mealCount = 0;
    let workoutCount = 0;
    let totalWorkoutMin = 0;
    let totalCaloriesBurned = 0;
    let sleepTotal = 0;
    let sleepDays = 0;

    for (const day of days) {
      const meals = await ultralight.query('meals/' + day + '/', {});
      for (const m of meals) {
        const meal = m.value as any;
        totalCalories += meal.calories || 0;
        totalProtein += meal.protein_g || 0;
        totalCarbs += meal.carbs_g || 0;
        totalFat += meal.fat_g || 0;
        mealCount++;
      }

      const workouts = await ultralight.query('workouts/' + day + '/', {});
      for (const w of workouts) {
        const workout = w.value as any;
        workoutCount++;
        totalWorkoutMin += workout.duration_min || 0;
        totalCaloriesBurned += workout.calories_burned || 0;
      }

      const sleep = await ultralight.load('sleep/' + day) as any;
      if (sleep) {
        sleepTotal += sleep.hours;
        sleepDays++;
      }
    }

    return {
      period: 'weekly',
      days: 7,
      meals: { count: mealCount, total_calories: totalCalories, avg_daily_calories: Math.round(totalCalories / 7), protein_g: totalProtein, carbs_g: totalCarbs, fat_g: totalFat },
      workouts: { count: workoutCount, total_minutes: totalWorkoutMin, total_calories_burned: totalCaloriesBurned },
      sleep: { days_logged: sleepDays, avg_hours: sleepDays > 0 ? Math.round((sleepTotal / sleepDays) * 10) / 10 : 0 },
    };
  }

  // Default: daily summary
  const dayMeals = await ultralight.query('meals/' + targetDate + '/', {});
  const dayWorkouts = await ultralight.query('workouts/' + targetDate + '/', {});
  const daySleep = await ultralight.load('sleep/' + targetDate) as any;
  const dayWeight = await ultralight.load('weight/' + targetDate) as any;

  let totalCal = 0;
  let totalProt = 0;
  let totalCarb = 0;
  let totalFatD = 0;
  const meals = dayMeals.map((m: any) => {
    const meal = m.value;
    totalCal += meal.calories || 0;
    totalProt += meal.protein_g || 0;
    totalCarb += meal.carbs_g || 0;
    totalFatD += meal.fat_g || 0;
    return meal;
  });

  let workoutMin = 0;
  let calBurned = 0;
  const workouts = dayWorkouts.map((w: any) => {
    const workout = w.value;
    workoutMin += workout.duration_min || 0;
    calBurned += workout.calories_burned || 0;
    return workout;
  });

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
  const todayMeals = await ultralight.list('meals/' + todayStr + '/');
  const todayWorkouts = await ultralight.list('workouts/' + todayStr + '/');
  const todaySleep = await ultralight.load('sleep/' + todayStr);
  const todayWeight = await ultralight.load('weight/' + todayStr);

  return {
    date: todayStr,
    meals_logged_today: todayMeals.length,
    workouts_logged_today: todayWorkouts.length,
    sleep_logged_today: todaySleep ? true : false,
    weight_logged_today: todayWeight ? true : false,
  };
}
