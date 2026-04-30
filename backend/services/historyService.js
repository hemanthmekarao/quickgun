const pool = require('../config/db');

async function saveHistory(userId, query, category, results) {
  const [row] = await pool.execute(
    `INSERT INTO search_history (user_id, query, category, results)
     VALUES (?, ?, ?, ?)`,
    [userId, query, category, JSON.stringify(results)]
  );
  return row.insertId;
}

async function getHistory(userId, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const [items] = await pool.execute(
    `SELECT id, query, category, results, searched_at
     FROM search_history
     WHERE user_id = ?
     ORDER BY searched_at DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  const [[{ total }]] = await pool.execute(
    'SELECT COUNT(*) AS total FROM search_history WHERE user_id = ?',
    [userId]
  );
  return { total, page, limit, items };
}

async function deleteHistoryItem(userId, id) {
  const [res] = await pool.execute(
    'DELETE FROM search_history WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return res.affectedRows > 0;
}

module.exports = { saveHistory, getHistory, deleteHistoryItem };
