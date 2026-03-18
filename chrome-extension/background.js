// background.js — Service Worker
// content_script.js から受け取ったテキストを Electron の
// ローカルサーバー (http://localhost:3000/speak) に POST する
//
// 対応メッセージタイプ:
//   AI_RESPONSE   : 新形式 (Grok・Gemini共通)
//   GROK_RESPONSE : 旧形式 (後方互換のため残す)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // AI_RESPONSE（新形式）または GROK_RESPONSE（後方互換）を受け付ける
  const isNew  = message.type === 'AI_RESPONSE';
  const isLega = message.type === 'GROK_RESPONSE';
  if (!isNew && !isLega) return;

  const text    = (message.text || '').trim();
  const service = message.service || 'grok'; // 旧形式はgrokとみなす

  if (!text) {
    sendResponse({ ok: false, reason: 'empty text' });
    return;
  }

  fetch('http://localhost:3000/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, service }),
  })
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then((data) => {
      console.log('[VRM-Bridge] 送信成功 service=' + service + ':', data);
      sendResponse({ ok: true });
    })
    .catch((err) => {
      // Electronが起動していない or グループAのときは正常に失敗する
      console.warn('[VRM-Bridge] 送信失敗 service=' + service + ':', err.message);
      sendResponse({ ok: false, reason: err.message });
    });

  // sendResponse を非同期で呼ぶので true を返す
  return true;
});
