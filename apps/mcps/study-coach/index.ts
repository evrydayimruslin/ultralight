// Private Tutor — Ultralight MCP App
// Your personal AI tutor with quizzes, custom lessons, and progress tracking.
// Storage: Ultralight D1 | Permissions: ai:call

const ultralight = (globalThis as any).ultralight;

// ── ADD CONCEPT ──

export async function add_concept(args: {
  name: string;
  parent_id?: string;
  description?: string;
  subject?: string;
}): Promise<unknown> {
  const { name, parent_id, description, subject } = args;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Ensure subject exists
  let subjectId = null;
  if (subject) {
    const existing = await ultralight.db.first(
      'SELECT id FROM subjects WHERE user_id = ? AND LOWER(name) = ?',
      [ultralight.user.id, subject.toLowerCase()]
    );
    if (existing) {
      subjectId = existing.id;
    } else {
      subjectId = crypto.randomUUID();
      await ultralight.db.run(
        'INSERT INTO subjects (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [subjectId, ultralight.user.id, subject, '', now, now]
      );
    }
  }

  await ultralight.db.run(
    'INSERT INTO concepts (id, user_id, name, parent_id, description, subject_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, name, parent_id || null, description || '', subjectId, now, now]
  );

  return {
    success: true,
    concept_id: id,
    name: name,
    subject_id: subjectId,
    parent_id: parent_id || null,
  };
}

// ── RATE UNDERSTANDING ──

export async function rate(args: {
  concept_id: string;
  understanding: number;
  notes?: string;
}): Promise<unknown> {
  const { concept_id, understanding, notes } = args;

  const concept = await ultralight.db.first(
    'SELECT * FROM concepts WHERE id = ? AND user_id = ?',
    [concept_id, ultralight.user.id]
  );
  if (!concept) {
    return { success: false, error: 'Concept not found: ' + concept_id };
  }

  const rating = Math.min(5, Math.max(1, Math.round(understanding)));
  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  const ratingId = crypto.randomUUID();

  await ultralight.db.run(
    'INSERT INTO ratings (id, user_id, concept_id, understanding, date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [ratingId, ultralight.user.id, concept_id, rating, todayStr, notes || '', now, now]
  );

  return {
    success: true,
    concept: concept.name,
    understanding: rating,
    date: todayStr,
  };
}

// ── STUDY (SPACED REPETITION) ──

export async function study(args: {
  subject_id?: string;
  limit?: number;
}): Promise<unknown> {
  const { subject_id, limit } = args;
  const todayDate = new Date();
  const todayStr = todayDate.toISOString().split('T')[0];

  // Load all concepts
  let sql = 'SELECT * FROM concepts WHERE user_id = ?';
  const params: any[] = [ultralight.user.id];
  if (subject_id) {
    sql += ' AND subject_id = ?';
    params.push(subject_id);
  }
  const concepts = await ultralight.db.all(sql, params);

  const studyItems: Array<{
    concept_id: string;
    name: string;
    description: string;
    last_rating: number | null;
    days_since_review: number | null;
    priority: number;
  }> = [];

  for (const concept of concepts) {
    // Find most recent rating
    const lastRatingRow = await ultralight.db.first(
      'SELECT understanding, date FROM ratings WHERE user_id = ? AND concept_id = ? ORDER BY date DESC LIMIT 1',
      [ultralight.user.id, concept.id]
    );

    let lastRating: number | null = null;
    let daysSince: number | null = null;
    let priority = 100;

    if (lastRatingRow) {
      lastRating = lastRatingRow.understanding;
      daysSince = Math.floor((todayDate.getTime() - new Date(lastRatingRow.date).getTime()) / 86400000);
      const idealInterval = Math.pow(2, (lastRating! - 1)); // 1, 2, 4, 8, 16 days
      priority = Math.max(0, (daysSince / idealInterval) * (6 - lastRating!) * 10);
    }

    studyItems.push({
      concept_id: concept.id,
      name: concept.name,
      description: concept.description,
      last_rating: lastRating,
      days_since_review: daysSince,
      priority: Math.round(priority),
    });
  }

  // Sort by priority descending
  studyItems.sort((a, b) => b.priority - a.priority);
  const toStudy = studyItems.slice(0, limit || 10);

  return {
    to_study: toStudy,
    total_concepts: concepts.length,
    concepts_needing_review: studyItems.filter((s) => s.priority > 20).length,
  };
}

// ── CONCEPT TREE ──

export async function tree(args: {
  subject_id?: string;
}): Promise<unknown> {
  const { subject_id } = args;

  let sql = 'SELECT * FROM concepts WHERE user_id = ?';
  const params: any[] = [ultralight.user.id];
  if (subject_id) {
    sql += ' AND subject_id = ?';
    params.push(subject_id);
  }

  const concepts = await ultralight.db.all(sql, params);

  const byId: Record<string, any> = {};
  for (const c of concepts) {
    byId[c.id] = { ...c, children: [] };
  }

  const roots: any[] = [];
  for (const c of concepts) {
    if (c.parent_id && byId[c.parent_id]) {
      byId[c.parent_id].children.push(byId[c.id]);
    } else {
      roots.push(byId[c.id]);
    }
  }

  return {
    tree: roots,
    total_concepts: concepts.length,
    root_concepts: roots.length,
  };
}

// ── QUIZ (AI) ──

export async function quiz(args: {
  subject_id?: string;
  concept_ids?: string[];
  count?: number;
}): Promise<unknown> {
  const { subject_id, concept_ids, count } = args;

  // Gather concepts to quiz on
  let concepts: any[] = [];
  if (concept_ids && concept_ids.length > 0) {
    const placeholders = concept_ids.map(() => '?').join(',');
    concepts = await ultralight.db.all(
      'SELECT * FROM concepts WHERE user_id = ? AND id IN (' + placeholders + ')',
      [ultralight.user.id, ...concept_ids]
    );
  } else {
    let sql = 'SELECT * FROM concepts WHERE user_id = ?';
    const params: any[] = [ultralight.user.id];
    if (subject_id) {
      sql += ' AND subject_id = ?';
      params.push(subject_id);
    }
    concepts = await ultralight.db.all(sql, params);
  }

  if (concepts.length === 0) {
    return { success: false, error: 'No concepts found to quiz on.' };
  }

  // Focus on weaker concepts
  const conceptNames = concepts.slice(0, 10).map((c: any) => c.name + (c.description ? ' — ' + c.description : ''));

  const prompt = 'Generate ' + (count || 5) + ' quiz questions about these concepts:\n' +
    conceptNames.join('\n') +
    '\n\nFor each question provide: the question, 4 multiple-choice options, the correct answer, and a brief explanation. Respond with ONLY valid JSON, no markdown. Format: [{"question": "...", "options": ["A", "B", "C", "D"], "correct": "A", "explanation": "..."}]';

  try {
    const response = await ultralight.ai({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an educational quiz generator. Create clear, accurate quiz questions. Respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
    });

    const text = response.content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const questions = JSON.parse(text);

    return {
      questions: questions,
      count: questions.length,
      concepts_tested: concepts.slice(0, 10).map((c: any) => c.name),
    };
  } catch (e) {
    return { success: false, error: 'Could not generate quiz. Try again.' };
  }
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const conceptCount = await ultralight.db.first(
    'SELECT COUNT(*) as count FROM concepts WHERE user_id = ?',
    [ultralight.user.id]
  );

  const subjectCount = await ultralight.db.first(
    'SELECT COUNT(*) as count FROM subjects WHERE user_id = ?',
    [ultralight.user.id]
  );

  // Get average understanding across most recent ratings per concept
  const avgRating = await ultralight.db.first(
    'SELECT COUNT(*) as rated_count, AVG(understanding) as avg_understanding FROM (SELECT concept_id, understanding FROM ratings WHERE user_id = ? GROUP BY concept_id HAVING date = MAX(date))',
    [ultralight.user.id]
  );

  return {
    total_subjects: subjectCount?.count || 0,
    total_concepts: conceptCount?.count || 0,
    concepts_rated: avgRating?.rated_count || 0,
    average_understanding: avgRating?.rated_count > 0 ? Math.round((avgRating.avg_understanding) * 10) / 10 : null,
  };
}
