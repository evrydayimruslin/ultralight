// Study Coach — Ultralight MCP App
// Personalized learning paths with spaced repetition for any subject.
// Storage: Ultralight KV | Permissions: ai:call

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

  // Ensure subject exists
  let subjectId = null;
  if (subject) {
    const subjectKeys = await ultralight.list('subjects/');
    let found = false;
    if (subjectKeys.length > 0) {
      const subjects = await ultralight.batchLoad(subjectKeys);
      for (const s of subjects) {
        const sub = s.value as any;
        if (sub.name.toLowerCase() === subject.toLowerCase()) {
          subjectId = sub.id;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      subjectId = crypto.randomUUID();
      await ultralight.store('subjects/' + subjectId, {
        id: subjectId,
        name: subject,
        description: '',
        created_at: new Date().toISOString(),
      });
    }
  }

  const concept = {
    id: id,
    name: name,
    parent_id: parent_id || null,
    description: description || '',
    subject_id: subjectId,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('concepts/' + id, concept);

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

  const concept = await ultralight.load('concepts/' + concept_id) as any;
  if (!concept) {
    return { success: false, error: 'Concept not found: ' + concept_id };
  }

  const rating = Math.min(5, Math.max(1, Math.round(understanding)));
  const today = new Date().toISOString().split('T')[0];

  await ultralight.store('ratings/' + concept_id + '/' + today, {
    concept_id: concept_id,
    understanding: rating,
    date: today,
    notes: notes || '',
    created_at: new Date().toISOString(),
  });

  return {
    success: true,
    concept: concept.name,
    understanding: rating,
    date: today,
  };
}

// ── STUDY (SPACED REPETITION) ──

export async function study(args: {
  subject_id?: string;
  limit?: number;
}): Promise<unknown> {
  const { subject_id, limit } = args;
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Load all concepts
  const conceptResults = await ultralight.query('concepts/', {
    filter: (item: any) => {
      if (subject_id && item.subject_id !== subject_id) return false;
      return true;
    },
  });

  const studyItems: Array<{
    concept_id: string;
    name: string;
    description: string;
    last_rating: number | null;
    days_since_review: number | null;
    priority: number;
  }> = [];

  for (const cr of conceptResults) {
    const concept = cr.value as any;

    // Find most recent rating
    const ratingKeys = await ultralight.list('ratings/' + concept.id + '/');
    let lastRating: number | null = null;
    let lastDate: string | null = null;

    if (ratingKeys.length > 0) {
      // Keys are sorted, last one is most recent
      const ratings = await ultralight.batchLoad(ratingKeys);
      const sorted = ratings
        .map((r: any) => r.value)
        .sort((a: any, b: any) => b.date.localeCompare(a.date));
      if (sorted.length > 0) {
        lastRating = sorted[0].understanding;
        lastDate = sorted[0].date;
      }
    }

    // Spaced repetition priority:
    // - Never rated = highest priority (100)
    // - Low understanding + stale = high priority
    // - High understanding + recent = low priority
    let priority = 100;
    let daysSince: number | null = null;

    if (lastRating !== null && lastDate) {
      daysSince = Math.floor((today.getTime() - new Date(lastDate).getTime()) / 86400000);
      // Interval: understanding 1 = review daily, 5 = review after 30 days
      const idealInterval = Math.pow(2, (lastRating - 1)) ; // 1, 2, 4, 8, 16 days
      priority = Math.max(0, (daysSince / idealInterval) * (6 - lastRating) * 10);
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
    total_concepts: conceptResults.length,
    concepts_needing_review: studyItems.filter((s) => s.priority > 20).length,
  };
}

// ── CONCEPT TREE ──

export async function tree(args: {
  subject_id?: string;
}): Promise<unknown> {
  const { subject_id } = args;

  const conceptResults = await ultralight.query('concepts/', {
    filter: (item: any) => {
      if (subject_id && item.subject_id !== subject_id) return false;
      return true;
    },
  });

  const concepts = conceptResults.map((r: any) => r.value);
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
    const keys = concept_ids.map((id) => 'concepts/' + id);
    const loaded = await ultralight.batchLoad(keys);
    concepts = loaded.filter((l: any) => l.value).map((l: any) => l.value);
  } else {
    const results = await ultralight.query('concepts/', {
      filter: (item: any) => {
        if (subject_id && item.subject_id !== subject_id) return false;
        return true;
      },
    });
    concepts = results.map((r: any) => r.value);
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
  const conceptKeys = await ultralight.list('concepts/');
  const subjectKeys = await ultralight.list('subjects/');

  // Get average understanding across most recent ratings
  let totalRating = 0;
  let ratedCount = 0;

  for (const key of conceptKeys.slice(0, 50)) {
    const conceptId = key.replace('concepts/', '');
    const ratingKeys = await ultralight.list('ratings/' + conceptId + '/');
    if (ratingKeys.length > 0) {
      const lastKey = ratingKeys[ratingKeys.length - 1];
      const rating = await ultralight.load(lastKey) as any;
      if (rating) {
        totalRating += rating.understanding;
        ratedCount++;
      }
    }
  }

  return {
    total_subjects: subjectKeys.length,
    total_concepts: conceptKeys.length,
    concepts_rated: ratedCount,
    average_understanding: ratedCount > 0 ? Math.round((totalRating / ratedCount) * 10) / 10 : null,
  };
}
