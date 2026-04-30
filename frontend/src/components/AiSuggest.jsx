import { useState, useEffect, useRef } from 'react';
import api from '../api/axios';

const QUESTIONS = [
  {
    id:          'purpose',
    question:    "What will you use this domain for?",
    placeholder: "e.g. tech startup, personal portfolio, online store, restaurant…",
  },
  {
    id:          'background',
    question:    "Tell me about yourself — your nationality, profession, and rough age group.",
    placeholder: "e.g. Indian, software engineer, late 20s…",
  },
  {
    id:          'theme',
    question:    "In 1–3 words, what's the core feel or theme of your brand?",
    placeholder: "e.g. bold innovation, calm wellness, playful kids…",
  },
];

function TypingIndicator() {
  return (
    <div className="chat-message ai">
      <span className="ai-bubble-icon">✦</span>
      <div className="chat-bubble typing">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion, onSearch }) {
  return (
    <div className="ai-suggestion-card" onClick={() => onSearch(suggestion.name)}>
      <div className="ai-suggestion-header">
        <span className="ai-suggestion-name">{suggestion.name}</span>
        <span className="ai-suggestion-search-hint">search →</span>
      </div>
      <p className="ai-suggestion-reason">{suggestion.reason}</p>
    </div>
  );
}

export default function AiSuggest({ originalDomain, onSearch }) {
  const [step,    setStep]    = useState(-1); // -1 = not started
  const [answers, setAnswers] = useState({});
  const [input,   setInput]   = useState('');
  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showTyping,  setShowTyping]  = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showTyping, suggestions]);

  useEffect(() => {
    if (step >= 0 && step < QUESTIONS.length) {
      inputRef.current?.focus();
    }
  }, [step]);

  function addMsg(role, text, extra = {}) {
    setMessages(prev => [...prev, { role, text, id: Date.now() + Math.random(), ...extra }]);
  }

  function start() {
    setStep(0);
    setShowTyping(true);
    setTimeout(() => {
      setShowTyping(false);
      addMsg('ai', QUESTIONS[0].question);
    }, 700);
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;
    const q = QUESTIONS[step];
    const newAnswers = { ...answers, [q.id]: trimmed };

    addMsg('user', trimmed);
    setInput('');
    setAnswers(newAnswers);

    const nextStep = step + 1;

    if (nextStep < QUESTIONS.length) {
      setShowTyping(true);
      setTimeout(() => {
        setShowTyping(false);
        addMsg('ai', QUESTIONS[nextStep].question);
        setStep(nextStep);
      }, 600);
    } else {
      // All answers collected — generate suggestions
      setStep(QUESTIONS.length);
      setLoading(true);
      setShowTyping(true);

      setTimeout(() => {
        setShowTyping(false);
        addMsg('ai', "Perfect. Generating personalized domain names for you…");
      }, 400);

      try {
        const { data } = await api.post('/api/ai/suggest', {
          ...newAnswers,
          originalDomain: originalDomain || '',
        });
        setSuggestions(data.suggestions || []);
        addMsg('ai',
          `Here are ${data.suggestions?.length || 0} domain names tailored to your profile. ` +
          `Click any to search availability across all TLDs.`
        );
      } catch (err) {
        const msg = err.response?.data?.error || "Couldn't generate suggestions. Please try again.";
        addMsg('ai', msg);
      } finally {
        setLoading(false);
      }
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  // ── Not started ──────────────────────────────────────────
  if (step === -1) {
    return (
      <div className="ai-trigger-bar">
        <div className="ai-trigger-left">
          <span className="ai-trigger-icon">✦</span>
          <div>
            <p className="ai-trigger-title">Get AI-powered domain suggestions</p>
            <p className="ai-trigger-sub">
              Answer 3 quick questions and Claude will suggest names personalized to your background and goals.
            </p>
          </div>
        </div>
        <button className="btn btn-primary ai-trigger-btn" onClick={start}>
          Let's go →
        </button>
      </div>
    );
  }

  // ── Chat panel ────────────────────────────────────────────
  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <span className="ai-header-icon">✦</span>
        <span>AI Domain Advisor</span>
        {loading && <span className="ai-thinking-label">thinking…</span>}
      </div>

      <div className="ai-chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            {msg.role === 'ai' && <span className="ai-bubble-icon">✦</span>}
            <div className="chat-bubble">{msg.text}</div>
          </div>
        ))}

        {showTyping && <TypingIndicator />}

        {suggestions.length > 0 && (
          <div className="ai-suggestions-grid">
            {suggestions.map((s, i) => (
              <SuggestionCard key={i} suggestion={s} onSearch={onSearch} />
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {step < QUESTIONS.length && (
        <div className="ai-chat-input-row">
          <input
            ref={inputRef}
            className="ai-chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={QUESTIONS[step]?.placeholder}
            disabled={loading}
          />
          <button
            className="ai-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || loading}
            aria-label="Send"
          >
            ↑
          </button>
        </div>
      )}
    </div>
  );
}
