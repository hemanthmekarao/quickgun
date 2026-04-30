const express  = require('express');
const authMw   = require('../middleware/auth');
const { getHistory, deleteHistoryItem } = require('../services/historyService');

const router = express.Router();

router.get('/', authMw, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page  || '1'));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20')));
  try {
    const data = await getHistory(req.user.id, page, limit);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', authMw, async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  try {
    const deleted = await deleteHistoryItem(req.user.id, id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
