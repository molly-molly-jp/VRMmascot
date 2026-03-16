// renderer/index.js — エントリーポイント
import { initVRM } from './vrm.js';
import { speak } from './voicevox.js';

const statusEl = document.getElementById('status');
const inputEl  = document.getElementById('text-input');
const sendBtn  = document.getElementById('send-btn');

// 未処理のPromise拒否でレンダラーがクラッシュするのを防ぐ
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
  e.preventDefault();
});

async function main() {
  try {
    await initVRM('vrm-canvas');
    statusEl.textContent = '';
  } catch (err) {
    console.error('VRM初期化失敗:', err);
    statusEl.textContent = `エラー: ${err.message}`;
  }
}

async function sendText() {
  const text = inputEl.value.trim();
  if (!text || inputEl.disabled) return;

  inputEl.value    = '';
  inputEl.disabled = true;
  sendBtn.disabled = true;
  statusEl.textContent = '読み上げ中...';

  try {
    await speak(text);
  } catch (err) {
    console.error('VOICEVOX失敗:', err);
    statusEl.textContent = `エラー: ${err.message}`;
  } finally {
    statusEl.textContent = '';
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// インラインスクリプトから呼べるようにグローバル登録
window._sendText = sendText;

main();
