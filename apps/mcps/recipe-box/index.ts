// Recipe Box — Ultralight MCP App
// Save recipes, plan meals, generate grocery lists, and get AI recipe suggestions.
// Storage: Ultralight KV | Permissions: ai:call

const ultralight = (globalThis as any).ultralight;

// ── ADD RECIPE ──

export async function add_recipe(args: {
  name: string;
  ingredients: string[];
  steps: string[];
  prep_time?: number;
  cook_time?: number;
  servings?: number;
  tags?: string[];
  source?: string;
}): Promise<unknown> {
  const { name, ingredients, steps, prep_time, cook_time, servings, tags, source } = args;
  const id = crypto.randomUUID();

  const recipe = {
    id: id,
    name: name,
    ingredients: ingredients,
    steps: steps,
    prep_time: prep_time || null,
    cook_time: cook_time || null,
    servings: servings || null,
    tags: tags || [],
    source: source || null,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('recipes/' + id, recipe);

  return {
    success: true,
    recipe_id: id,
    name: name,
    ingredients_count: ingredients.length,
    steps_count: steps.length,
  };
}

// ── GROCERY LIST ──

export async function grocery_list(args: {
  recipe_ids?: string[];
  items?: string[];
  name?: string;
}): Promise<unknown> {
  const { recipe_ids, items, name } = args;
  const id = crypto.randomUUID();
  const allItems: string[] = items ? [...items] : [];

  // Aggregate ingredients from recipes
  if (recipe_ids && recipe_ids.length > 0) {
    for (const recipeId of recipe_ids) {
      const recipe = await ultralight.load('recipes/' + recipeId) as any;
      if (recipe && recipe.ingredients) {
        for (const ing of recipe.ingredients) {
          if (!allItems.includes(ing)) {
            allItems.push(ing);
          }
        }
      }
    }
  }

  const groceryList = {
    id: id,
    name: name || 'Grocery List ' + new Date().toISOString().split('T')[0],
    items: allItems,
    checked_items: [],
    recipe_ids: recipe_ids || [],
    created_at: new Date().toISOString(),
  };

  await ultralight.store('grocery_lists/' + id, groceryList);

  return {
    success: true,
    list_id: id,
    name: groceryList.name,
    items: allItems,
    item_count: allItems.length,
  };
}

// ── MEAL PLAN ──

export async function meal_plan(args: {
  week_start?: string;
  day: string;
  meal_type: string;
  recipe_id?: string;
  description?: string;
}): Promise<unknown> {
  const { week_start, day, meal_type, recipe_id, description } = args;

  // Determine week key
  const weekKey = week_start || getWeekStart();
  const planKey = 'meal_plans/' + weekKey;

  // Load existing plan or create new
  let plan = await ultralight.load(planKey) as any;
  if (!plan) {
    plan = {
      week_start: weekKey,
      days: {},
      created_at: new Date().toISOString(),
    };
  }

  const dayLower = day.toLowerCase();
  if (!plan.days[dayLower]) {
    plan.days[dayLower] = { meals: [] };
  }

  // Get recipe name if recipe_id provided
  let recipeName = description || '';
  if (recipe_id) {
    const recipe = await ultralight.load('recipes/' + recipe_id) as any;
    if (recipe) {
      recipeName = recipe.name;
    }
  }

  plan.days[dayLower].meals.push({
    meal_type: meal_type,
    recipe_id: recipe_id || null,
    description: recipeName || description || '',
  });

  await ultralight.store(planKey, plan);

  return {
    success: true,
    week_start: weekKey,
    day: dayLower,
    meal_type: meal_type,
    description: recipeName || description,
  };
}

function getWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  return monday.toISOString().split('T')[0];
}

// ── SUGGEST RECIPES (AI) ──

export async function suggest(args: {
  ingredients: string[];
  cuisine?: string;
  dietary?: string;
  count?: number;
}): Promise<unknown> {
  const { ingredients, cuisine, dietary, count } = args;

  let prompt = 'Suggest ' + (count || 3) + ' recipes using these ingredients: ' + ingredients.join(', ') + '.';
  if (cuisine) prompt += ' Cuisine preference: ' + cuisine + '.';
  if (dietary) prompt += ' Dietary restriction: ' + dietary + '.';
  prompt += ' For each recipe, provide: name, full ingredients list (including ones not in my list), and step-by-step instructions. Respond with ONLY valid JSON array, no markdown. Format: [{"name": "...", "ingredients": ["..."], "steps": ["..."]}]';

  try {
    const response = await ultralight.ai({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a creative chef. Suggest recipes based on available ingredients. Respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
    });

    const text = response.content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const suggestions = JSON.parse(text);

    return {
      suggestions: suggestions,
      count: suggestions.length,
      based_on: ingredients,
    };
  } catch (e) {
    return { success: false, error: 'Could not generate recipe suggestions. Try again.' };
  }
}

// ── RECIPE WALKTHROUGH (AI) ──

export async function walkthrough(args: {
  recipe_id: string;
  step_number?: number;
}): Promise<unknown> {
  const { recipe_id, step_number } = args;

  const recipe = await ultralight.load('recipes/' + recipe_id) as any;
  if (!recipe) {
    return { success: false, error: 'Recipe not found: ' + recipe_id };
  }

  let prompt = '';
  if (step_number !== undefined && step_number >= 0 && step_number < recipe.steps.length) {
    prompt = 'Recipe: ' + recipe.name + '\nCurrent step (' + (step_number + 1) + ' of ' + recipe.steps.length + '): ' + recipe.steps[step_number] + '\n\nProvide detailed guidance for this step: timing tips, technique details, common mistakes to avoid, and how to know when it\'s done right.';
  } else {
    prompt = 'Recipe: ' + recipe.name + '\nIngredients: ' + recipe.ingredients.join(', ') + '\nSteps:\n' + recipe.steps.map((s: string, i: number) => (i + 1) + '. ' + s).join('\n') + '\n\nProvide a complete walkthrough with timing tips, technique details, and helpful hints for each step.';
  }

  try {
    const response = await ultralight.ai({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a friendly cooking instructor. Guide the user through the recipe with clear, helpful instructions.' },
        { role: 'user', content: prompt },
      ],
    });

    return {
      recipe_name: recipe.name,
      step_number: step_number !== undefined ? step_number + 1 : null,
      total_steps: recipe.steps.length,
      guidance: response.content,
    };
  } catch (e) {
    return { success: false, error: 'Could not generate walkthrough.' };
  }
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const recipeKeys = await ultralight.list('recipes/');
  const groceryKeys = await ultralight.list('grocery_lists/');
  const planKeys = await ultralight.list('meal_plans/');

  // Check this week's meal plan
  const weekKey = getWeekStart();
  const currentPlan = await ultralight.load('meal_plans/' + weekKey) as any;
  const mealsThisWeek = currentPlan
    ? Object.values(currentPlan.days || {}).reduce((sum: number, day: any) => sum + (day.meals?.length || 0), 0)
    : 0;

  return {
    total_recipes: recipeKeys.length,
    grocery_lists: groceryKeys.length,
    meal_plans: planKeys.length,
    meals_planned_this_week: mealsThisWeek,
  };
}
