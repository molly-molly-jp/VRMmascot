// content_script.js — Grok / Gemini DOM監視
// 対象:
//   https://grok.com/
//   https://x.com/i/grok
//   https://gemini.google.com/

(function () {
  'use strict';

  // ── サービス判定 ──────────────────────────────────────────
  const hostname = location.hostname;
  let SERVICE;
  if (hostname.includes('gemini.google.com')) {
    SERVICE = 'gemini';
  } else if (hostname.includes('grok.com') || hostname.includes('x.com')) {
    SERVICE = 'grok';
  } else {
    SERVICE = 'unknown';
  }

  // ── サービス別セレクタ候補（優先度順） ───────────────────
  const SELECTORS_GROK = [
    '[class*="message-bubble"]',
    '[class*="MessageBubble"]',
    '[data-message-author-role="assistant"]',
    '[class*="assistant-message"]',
    '[data-testid="grok-message-content"]',
    '[data-testid="messageContent"]',
    '.grok-message-content',
  ];

  const SELECTORS_GEMINI = [
    'model-response',
    '[data-message-author-role="model"]',
    '.response-content',
    'message-content',
    '.model-run-chunk',
    '[class*="response-text"]',
  ];

  const SELECTORS  = SERVICE === 'gemini' ? SELECTORS_GEMINI : SELECTORS_GROK;
  const DEBOUNCE_MS = SERVICE === 'gemini' ? 2000 : 1500;
  const MIN_LENGTH  = 10;

  let debounceTimer = null;
  let lastSentText  = '';

  // ── テキストクリーニング ──────────────────────────────────
  // DOMに混入する枕言葉・ラベルを除去して本文だけにする
  const STRIP_PREFIXES = [
    // Gemini 系（日本語）
    /^gemini\s*の?\s*解答[\s:：]*/i,
    /^gemini\s*の?\s*回答[\s:：]*/i,
    /^geminiの返答[\s:：]*/i,
    /^AIの解答[\s:：]*/i,
    /^AIの回答[\s:：]*/i,
    /^AIの返答[\s:：]*/i,
    /^モデルの回答[\s:：]*/i,
    // Grok 系（日本語）
    /^grok\s*の?\s*解答[\s:：]*/i,
    /^grok\s*の?\s*回答[\s:：]*/i,
    /^grokの返答[\s:：]*/i,
    // 英語ラベル（例: "Gemini: " "assistant - "）
    /^(gemini|grok|assistant|model)\s*[:\-]\s*/i,
  ];

  function cleanText(raw) {
    let t = raw;
    // 先頭ラベルを繰り返し除去（複数重なっている場合も対処）
    let prev = '';
    while (t !== prev) {
      prev = t;
      for (const re of STRIP_PREFIXES) {
        t = t.replace(re, '');
      }
      t = t.trimStart();
    }
    return t.trim();
  }


  // ── 最後のアシスタントメッセージのテキストを取得 ─────────
  function getLatestResponseText() {
    for (const sel of SELECTORS) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      if (nodes.length === 0) continue;
      const last = nodes[nodes.length - 1];
      const text = (last.innerText || last.textContent || '').trim();
      if (text.length >= MIN_LENGTH) {
        console.log('[VRM-Bridge] セレクタヒット:', sel, '文字数:', text.length);
        return text;
      }
    }
    return '';
  }

  // ── 送信 ─────────────────────────────────────────────────
  function maybeSend() {
    const raw  = getLatestResponseText();
    if (!raw) return;

    const text = cleanText(raw);
    if (!text || text.length < MIN_LENGTH) return;
    if (text === lastSentText) return;

    lastSentText = text;
    console.log('[VRM-Bridge] 送信 service=' + SERVICE + ':', text.slice(0, 80), '...');

    chrome.runtime.sendMessage(
      { type: 'AI_RESPONSE', service: SERVICE, text },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[VRM-Bridge] sendMessage失敗:', chrome.runtime.lastError.message);
          return;
        }
        if (response && !response.ok) {
          console.warn('[VRM-Bridge] サーバー応答NG:', response.reason);
        }
      }
    );
  }


  // ── MutationObserver ──────────────────────────────────────
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        maybeSend();
      } catch (err) {
        console.error('[VRM-Bridge] DOM解析エラー:', err);
      }
    }, DEBOUNCE_MS);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log(
    '[VRM-Bridge] DOM監視開始 service=' + SERVICE,
    'URL:', location.href,
    'debounce:', DEBOUNCE_MS + 'ms'
  );
})();
