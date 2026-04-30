const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const rateLimit  = require('express-rate-limit');

const router = express.Router();

const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.post('/suggest', aiLimiter, async (req, res) => {
  const { purpose, background, theme, originalDomain } = req.body;

  if (!purpose?.trim() || !background?.trim() || !theme?.trim()) {
    return res.status(400).json({ error: 'All three answers are required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI suggestions not configured — add ANTHROPIC_API_KEY to .env' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const message = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role:    'user',
        content: `You are a creative domain name consultant. Generate 10 domain base names based on this profile:

Original search: "${originalDomain || 'not provided'}"
Purpose: ${purpose}
Personal background (nationality/profession/age): ${background}
Core brand theme: ${theme}

Rules:
- 3–14 characters, no hyphens or numbers
- Easy to spell, type, and remember
- Mix styles: portmanteaus, invented words, compound words, abbreviations
- Include culturally relevant options based on the user's nationality/background
- Avoid generic names; be creative and specific to their profile

Return ONLY a raw JSON array — no markdown, no explanation:
[{"name":"example","reason":"Why this fits their profile in one sentence"}]`,
      }],
    });

    let text = message.content[0].text.trim()
      .replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();

    const suggestions = JSON.parse(text);
    if (!Array.isArray(suggestions)) throw new Error('Unexpected response format');

    res.json({ suggestions: suggestions.slice(0, 12) });
  } catch (err) {
    console.error('[AI] suggest error:', err.message);
    res.status(500).json({ error: 'Failed to generate suggestions. Try again.' });
  }
});

module.exports = router;
