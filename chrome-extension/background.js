// background.js — Service Worker
// content_script.js から受け取ったテキストを Electron の
// ローカルサーバー (http://localhost:3000/speak) に POST する

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'GROK_RESPONSE') return;

  const text = (message.text || '').trim();
  if (!text) {
    sendResponse({ ok: false, reason: 'empty text' });
    return;
  }

  fetch('http://localhost:3000/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      console.log('[VRM-Bridge] 送信成功:', data);
      sendResponse({ ok: true });
    })
    .catch((err) => {
      // Electronが起動していない or グループAのときは正常に失敗する
      console.warn('[VRM-Bridge] 送信失敗:', err.message);
      sendResponse({ ok: false, reason: err.message });
    });

  // sendResponse を非同期で呼ぶので true を返す
  return true;
});
