// renderer/index.js — エントリーポイント
import { initVRM } from './vrm.js';
import { speak, setAudioContext } from './voicevox.js';
import { askAI } from './ai.js';

const statusEl = document.getElementById('status');
const inputEl  = document.getElementById('text-input');
const sendBtn  = document.getElementById('send-btn');

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
  const userText = inputEl.value.trim();
  if (!userText || inputEl.disabled) return;

  inputEl.value    = '';
  inputEl.disabled = true;
  sendBtn.disabled = true;

  try {
    // AudioContext を初回ユーザー操作後に作成（AutoPlay制限対策）
    if (!window._audioCtx) {
      window._audioCtx = new AudioContext();
      setAudioContext(window._audioCtx);
    }
    if (window._audioCtx.state === 'suspended') {
      await window._audioCtx.resume();
    }

    // Step1: AIに質問
    statusEl.textContent = '考え中...';
    const aiText = await askAI(userText);

    // Step2: AIの返答をVOICEVOXで読み上げ → 口パク
    statusEl.textContent = '読み上げ中...';
    await speak(aiText);

  } catch (err) {
    console.error('エラー:', err);
    statusEl.textContent = `エラー: ${err.message}`;
    await new Promise(r => setTimeout(r, 3000)); // 3秒表示
  } finally {
    statusEl.textContent = '';
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

window._sendText = sendText;
main();
