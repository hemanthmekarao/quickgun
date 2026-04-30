const express = require('express');
const { getTldsForCategory, getCategoryMeta } = require('../services/tldService');

const router = express.Router();

router.get('/', (req, res) => {
  const { category } = req.query;
  if (category) {
    res.json({ category, tlds: getTldsForCategory(category) });
  } else {
    res.json(getCategoryMeta());
  }
});

module.exports = router;
