// content_script.js — Grok / Gemini / ChatGPT DOM監視
// Phase 14: ストリーミング逐次読み上げ対応
// 対象:
//   https://grok.com/
//   https://x.com/i/grok
//   https://gemini.google.com/
//   https://chatgpt.com/

(function () {
  'use strict';

  // ── サービス判定 ──────────────────────────────────────────
  const hostname = location.hostname;
  let SERVICE;
  if (hostname.includes('gemini.google.com')) {
    SERVICE = 'gemini';
  } else if (hostname.includes('chatgpt.com')) {
    SERVICE = 'chatgpt';
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

  const SELECTORS_CHATGPT = [
    '[data-message-author-role="assistant"]',
    '.markdown.prose',
    '[class*="agent-turn"]',
    '[data-testid*="conversation-turn"]',
  ];

  const SELECTORS = SERVICE === 'gemini'  ? SELECTORS_GEMINI
                  : SERVICE === 'chatgpt' ? SELECTORS_CHATGPT
                  :                         SELECTORS_GROK;

  const DEBOUNCE_MS   = SERVICE === 'gemini' ? 2000 : 1500;
  const FLUSH_WAIT_MS = 600;   // ストリーム停止と判断するまでの待機時間（ms）
  const MIN_LENGTH    = 10;
  const MIN_SEND_LEN  = 3;     // 逐次送信の最小文字数


  // ── streamingTTSモード ─────────────────────────────────────
  // サーバーから取得。デフォルトはtrue（逐次モード）
  let streamingTTS = true;

  async function fetchStreamingMode() {
    try {
      const res = await fetch('http://127.0.0.1:3000/streaming-tts');
      if (!res.ok) return;
      const data = await res.json();
      streamingTTS = !!data.enabled;
      console.log('[VRM-Bridge] streamingTTS mode:', streamingTTS);
    } catch (_) {
      // サーバー未起動またはオフ → デフォルト値を維持
    }
  }
  fetchStreamingMode();

  // ── テキストクリーニング ──────────────────────────────────
  const STRIP_PREFIXES = [
    /^gemini\s*の?\s*解答[\s:：]*/i,
    /^gemini\s*の?\s*回答[\s:：]*/i,
    /^geminiの返答[\s:：]*/i,
    /^AIの解答[\s:：]*/i,
    /^AIの回答[\s:：]*/i,
    /^AIの返答[\s:：]*/i,
    /^モデルの回答[\s:：]*/i,
    /^grok\s*の?\s*解答[\s:：]*/i,
    /^grok\s*の?\s*回答[\s:：]*/i,
    /^grokの返答[\s:：]*/i,
    /^chatgpt\s*の?\s*解答[\s:：]*/i,
    /^chatgpt\s*の?\s*回答[\s:：]*/i,
    /^chatgptの返答[\s:：]*/i,
    /^(gemini|grok|chatgpt|assistant|model)\s*[:\-]\s*/i,
  ];

  function cleanText(raw) {
    let t = raw;
    let prev = '';
    while (t !== prev) {
      prev = t;
      for (const re of STRIP_PREFIXES) t = t.replace(re, '');
      t = t.trimStart();
    }
    return t.trim();
  }

  // ── 最後のアシスタントメッセージのテキストを取得 ─────────
  function getLatestResponseText() {
    for (const sel of SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
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


  // ── 文区切り検出（Phase 14） ──────────────────────────────
  // 句点・疑問符・感嘆符で完結した文と、途中の断片に分ける。
  // 誤検知しやすいパターン（数字+ピリオド、URL内ドット）は除外。
  function splitSentences(text) {
    const complete = [];
    let buf = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      buf += ch;
      if ('。！？!?'.includes(ch)) {
        if (buf.trim().length > 0) { complete.push(buf); buf = ''; }
      } else if (ch === '.') {
        const prev = i > 0 ? text[i - 1] : '';
        const next = i < text.length - 1 ? text[i + 1] : '';
        // 誤検知: 数字+ピリオド（箇条書き番号）や URL・英単略語
        const isFalse = /\d/.test(prev) ||
          (/[a-zA-Z]/.test(prev) && /[a-zA-Z\/\d]/.test(next));
        if (!isFalse && buf.trim().length > 0) { complete.push(buf); buf = ''; }
      }
      i++;
    }
    return { complete, remainder: buf };
  }

  // ── メッセージ送信共通 ────────────────────────────────────
  function dispatchText(text) {
    const cleaned = cleanText(text);
    if (!cleaned || cleaned.length < MIN_SEND_LEN) return;
    console.log('[VRM-Bridge] 送信 service=' + SERVICE + ':', cleaned.slice(0, 80));
    chrome.runtime.sendMessage(
      { type: 'AI_RESPONSE', service: SERVICE, text: cleaned },
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

  // ── ストリーミングモード状態 ──────────────────────────────
  let cursor    = 0;  // 送信済み文字数（レスポンステキスト先頭からの位置）
  let seenText  = ''; // 最後に確認したレスポンステキスト全体
  let flushTimer = null;

  // ストリーミングモード: DOM変化のたびに呼ばれる
  function processStreaming() {
    const rawText = getLatestResponseText();
    if (!rawText) return;

    // 新しいAI回答の開始を検出（テキストがカーソルより短い = 新レスポンス）
    if (rawText.length < cursor) {
      cursor = 0;
      seenText = '';
      fetchStreamingMode(); // モード設定を再取得（次回から反映）
    }
    seenText = rawText;

    // カーソル以降の差分テキストを処理
    const delta = rawText.slice(cursor);
    if (!delta) return;

    const { complete } = splitSentences(delta);
    for (const sentence of complete) {
      dispatchText(sentence);
    }
    if (complete.length > 0) {
      cursor += complete.reduce((sum, s) => sum + s.length, 0);
    }

    // ストリーム終了タイマーをリセット（停止後にフラッシュ）
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      const remaining = seenText.slice(cursor).trim();
      if (remaining.length >= MIN_SEND_LEN) {
        console.log('[VRM-Bridge] フラッシュ(末尾断片):', remaining.slice(0, 60));
        dispatchText(remaining);
        cursor = seenText.length;
      }
    }, FLUSH_WAIT_MS);
  }


  // ── 全文受信モード状態 ────────────────────────────────────
  let debounceTimer = null;
  let lastSentText  = '';

  // 全文受信モード: デバウンス後に全文を一括送信
  function processFull() {
    const raw  = getLatestResponseText();
    if (!raw) return;
    const text = cleanText(raw);
    if (!text || text.length < MIN_LENGTH) return;
    if (text === lastSentText) return;
    lastSentText = text;
    dispatchText(text);
  }

  // ── MutationObserver ──────────────────────────────────────
  const observer = new MutationObserver(() => {
    if (streamingTTS) {
      // ストリーミングモード: 即時処理
      try { processStreaming(); }
      catch (err) { console.error('[VRM-Bridge] DOM解析エラー(streaming):', err); }
    } else {
      // 全文受信モード: デバウンス
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try { processFull(); }
        catch (err) { console.error('[VRM-Bridge] DOM解析エラー(full):', err); }
      }, DEBOUNCE_MS);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log(
    '[VRM-Bridge] DOM監視開始 service=' + SERVICE,
    'URL:', location.href,
    'streamingTTS:', streamingTTS,
    '(サーバー確認中...)'
  );
})();
