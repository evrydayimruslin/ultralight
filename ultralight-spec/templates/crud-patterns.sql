-- Standard CRUD patterns for Ultralight D1 apps.
-- Copy-paste these into your app code. Always use parameterized queries.

-- INSERT
-- ultralight.db.run(sql, [crypto.randomUUID(), ultralight.user.id, name, value])
INSERT INTO items (id, user_id, name, value, category)
VALUES (?, ?, ?, ?, ?);

-- SELECT ALL (with pagination)
-- ultralight.db.all(sql, [ultralight.user.id, limit, offset])
SELECT * FROM items
WHERE user_id = ?
ORDER BY created_at DESC
LIMIT ? OFFSET ?;

-- SELECT ONE
-- ultralight.db.first(sql, [ultralight.user.id, id])
SELECT * FROM items
WHERE user_id = ? AND id = ?;

-- UPDATE
-- ultralight.db.run(sql, [newName, newValue, ultralight.user.id, id])
UPDATE items
SET name = ?, value = ?, updated_at = datetime('now')
WHERE user_id = ? AND id = ?;

-- DELETE
-- ultralight.db.run(sql, [ultralight.user.id, id])
DELETE FROM items
WHERE user_id = ? AND id = ?;

-- COUNT
-- ultralight.db.first(sql, [ultralight.user.id])
SELECT COUNT(*) as total FROM items WHERE user_id = ?;

-- AGGREGATE (GROUP BY)
-- ultralight.db.all(sql, [ultralight.user.id])
SELECT category, COUNT(*) as count, SUM(value) as total_value
FROM items
WHERE user_id = ?
GROUP BY category
ORDER BY total_value DESC;

-- SEARCH (LIKE)
-- ultralight.db.all(sql, [ultralight.user.id, '%' + query + '%'])
SELECT * FROM items
WHERE user_id = ? AND name LIKE ?
ORDER BY name ASC;

-- UPSERT (INSERT OR UPDATE)
-- ultralight.db.run(sql, [id, ultralight.user.id, name, value, name, value])
INSERT INTO items (id, user_id, name, value)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = ?, value = ?, updated_at = datetime('now');
