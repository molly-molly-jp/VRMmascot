// renderer/index.js — エントリーポイント
import { initVRM } from './vrm.js';
import { speak } from './voicevox.js';
import { askAI } from './ai.js';
import { setupVBCableAnalyser } from './lipsync.js';

const statusEl = document.getElementById('status');
const inputEl  = document.getElementById('text-input');
const sendBtn  = document.getElementById('send-btn');

window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
  e.preventDefault();
});

// AudioContext: 確実にrunning状態にしてから返す
let audioCtx = null;
async function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    console.log('[index] AudioContext作成 state:', audioCtx.state);
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
    console.log('[index] AudioContext resume完了');
  }
  return audioCtx;
}

// 読み上げキュー
const speakQueue = [];
let   isSpeaking = false;

async function processQueue() {
  if (isSpeaking || speakQueue.length === 0) return;
  isSpeaking = true;
  const text = speakQueue.shift();
  statusEl.textContent = '読み上げ中...';
  try {
    const ctx = await getAudioCtx();
    await speak(text, ctx);
  } catch (err) {
    console.error('[queue] speak失敗:', err);
  } finally {
    isSpeaking = false;
    statusEl.textContent = speakQueue.length > 0 ? `キュー残り: ${speakQueue.length}件` : '';
    processQueue();
  }
}

function enqueue(text) {
  speakQueue.push(text);
  console.log(`[queue] 追加 残り${speakQueue.length}件`);
  processQueue();
}

// Phase 5: ショートカット
window.electronAPI.onSpeakQueue((text) => enqueue(text));

// 起動処理
async function main() {
  try {
    await initVRM('vrm-canvas');
    statusEl.textContent = '';
  } catch (err) {
    console.error('VRM初期化失敗:', err);
    statusEl.textContent = `エラー: ${err.message}`;
  }

  // Phase 6: VB-Cable初期化
  try {
    const config = await window.electronAPI.getConfig();
    if (config.lipSyncDevice) {
      await setupVBCableAnalyser(config.lipSyncDevice);
    }
  } catch (err) {
    console.error('[Phase6] VB-Cable初期化エラー:', err.message);
  }
}

// AI → 読み上げ
async function sendText() {
  const userText = inputEl.value.trim();
  if (!userText || inputEl.disabled) return;

  inputEl.value    = '';
  inputEl.disabled = true;
  sendBtn.disabled = true;

  try {
    statusEl.textContent = '考え中...';
    const aiText = await askAI(userText);
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
