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

// ── AudioContext（speak/口パクで共用） ────────────────────────
function getAudioCtx() {
  if (!window._audioCtx) {
    window._audioCtx = new AudioContext();
    setAudioContext(window._audioCtx);
  }
  return window._audioCtx;
}

// ── 読み上げキュー（Phase5） ──────────────────────────────────
const speakQueue  = [];
let   isSpeaking  = false;

async function processQueue() {
  if (isSpeaking || speakQueue.length === 0) return;
  isSpeaking = true;

  const text = speakQueue.shift();
  console.log('[queue] 読み上げ開始:', text.slice(0, 40));
  statusEl.textContent = '読み上げ中...';

  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    await speak(text);
  } catch (err) {
    console.error('[queue] speak失敗:', err);
  } finally {
    isSpeaking = false;
    statusEl.textContent = speakQueue.length > 0 ? `キュー残り: ${speakQueue.length}件` : '';
    processQueue(); // 次のキューを処理
  }
}

function enqueue(text) {
  speakQueue.push(text);
  console.log(`[queue] 追加: ${speakQueue.length}件待機中`);
  processQueue();
}

// ── Phase5: メインプロセスからのキュー追加を受け取る ────────────
window.electronAPI.onSpeakQueue((text) => {
  console.log('[Phase5] ショートカット受信:', text.slice(0, 40));
  enqueue(text);
});

// ── VRM初期化 ─────────────────────────────────────────────────
async function main() {
  try {
    await initVRM('vrm-canvas');
    statusEl.textContent = '';
  } catch (err) {
    console.error('VRM初期化失敗:', err);
    statusEl.textContent = `エラー: ${err.message}`;
  }
}

// ── テキスト入力からAI経由で読み上げ（Phase4フロー） ───────────
async function sendText() {
  const userText = inputEl.value.trim();
  if (!userText || inputEl.disabled) return;

  inputEl.value    = '';
  inputEl.disabled = true;
  sendBtn.disabled = true;

  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    statusEl.textContent = '考え中...';
    const aiText = await askAI(userText);

    // AIの返答をキューに追加（他の読み上げと順番を守る）
    enqueue(aiText);
  } catch (err) {
    console.error('エラー:', err);
    statusEl.textContent = `エラー: ${err.message}`;
    await new Promise(r => setTimeout(r, 3000));
    statusEl.textContent = '';
  } finally {
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

window._sendText = sendText;
main();
