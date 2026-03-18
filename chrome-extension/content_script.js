// content_script.js — Grok DOM監視
// 対象: https://grok.com/ および https://x.com/i/grok
//
// ■ 検知ロジック
//   MutationObserver でページ全体を監視し、
//   最後のアシスタント返答テキストが 1.5 秒間変化しなければ
//   「ストリーミング完了」とみなして background.js に送信する。
//
// ■ セレクタが壊れた場合
//   コンソールにエラーを出すだけ。自動フォールバックなし。
//   ChromeのDevToolsで返答要素を検証し、SELECTORS を更新してください。

(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────
  // セレクタ候補（優先度順）
  // grok.com と x.com/i/grok の両方をカバーする
  // ────────────────────────────────────────────────────────────
  const SELECTORS = [
    // grok.com 用（2025年時点）
    '[class*="message-bubble"]',
    '[class*="MessageBubble"]',
    '[data-message-author-role="assistant"]',
    '[class*="assistant-message"]',
    // x.com/i/grok 用
    '[data-testid="grok-message-content"]',
    '[data-testid="messageContent"]',
    '.grok-message-content',
  ];

  // ストリーミング停止判定の待ち時間 (ms)
  const DEBOUNCE_MS = 1500;
  // 最小文字数（短すぎるものは無視）
  const MIN_LENGTH = 10;

  let debounceTimer = null;
  let lastSentText  = '';

  // ────────────────────────────────────────────────────────────
  // 最後のアシスタントメッセージのテキストを取得する
  // ────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────
  // 送信
  // ────────────────────────────────────────────────────────────
  function maybeSend() {
    const text = getLatestResponseText();
    if (!text) return;
    if (text === lastSentText) return;

    lastSentText = text;
    console.log('[VRM-Bridge] 送信:', text.slice(0, 80), '...');

    chrome.runtime.sendMessage({ type: 'GROK_RESPONSE', text }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[VRM-Bridge] sendMessage失敗:', chrome.runtime.lastError.message);
        return;
      }
      if (response && !response.ok) {
        console.warn('[VRM-Bridge] サーバー応答NG:', response.reason);
      }
    });
  }

  // ────────────────────────────────────────────────────────────
  // MutationObserver
  // ────────────────────────────────────────────────────────────
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

  console.log('[VRM-Bridge] Grok DOM監視を開始しました URL:', location.href, 'debounce:', DEBOUNCE_MS + 'ms');
})();
