// renderer/index.js — VRMウィンドウ専用エントリーポイント
// UI は control.html / control.js に移管
// このファイルは VRM表示・音声再生・口パクのみ担当
import { initVRM, switchVRM } from './vrm.js';
import { speak, stopCurrentSpeech } from './voicevox.js';
import { askAI } from './ai.js';
import { setupVBCableAnalyser, teardownVBCable } from './lipsync.js';

const api = window.electronAPI;

window.addEventListener('unhandledrejection', (e) => {
  console.error('[vrm-win] unhandledrejection:', e.reason);
  e.preventDefault();
});

// ─── ステータス通知（コントロールウィンドウに送る） ─────────────
function setStatus(text) {
  console.log('[vrm-win] status:', text);
  api.sendStatus(text);
}

// ─── AudioContext ──────────────────────────────────────────────
let audioCtx = null;
async function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  return audioCtx;
}

// ─── 読み上げキュー ────────────────────────────────────────────
const speakQueue = [];
let   isSpeaking = false;

function clearQueueAndStop() {
  speakQueue.length = 0;
  isSpeaking = false;
  stopCurrentSpeech();
  setStatus('');
}

async function processQueue() {
  if (isSpeaking || speakQueue.length === 0) return;
  isSpeaking = true;
  const text = speakQueue.shift();
  setStatus('読み上げ中...');
  try {
    const ctx = await getAudioCtx();
    await speak(text, ctx);
  } catch (err) {
    console.error('[vrm-win] speak失敗:', err);
  } finally {
    isSpeaking = false;
    setStatus(speakQueue.length > 0 ? `キュー残り: ${speakQueue.length}件` : '');
    processQueue();
  }
}

function enqueue(text) {
  speakQueue.push(text);
  processQueue();
}

// ─── 口パクソース管理 ─────────────────────────────────────────
let configCache = null;

async function applyLipSyncSource(source) {
  if (source === 'vbcable') {
    const deviceName = configCache?.lipSyncDevice || 'ステレオ ミキサー (Realtek(R) Audio)';
    const ok = await setupVBCableAnalyser(deviceName);
    console.log('[vrm-win] VB-Cable:', ok ? '✓成功' : '✗失敗');
  } else {
    await teardownVBCable();
    console.log('[vrm-win] Clipboardモード（VB-Cable解除）');
  }
}

// ─── IPC受信: コントロールウィンドウからのコマンド ──────────────

// グループ切り替え（groupIdを受け取る）
api.onSwitchGroup(async (groupId) => {
  const group = configCache?.groups?.find(g => g.id === groupId);
  if (!group) return console.error('[vrm-win] グループ未発見:', groupId);
  console.log('[vrm-win] グループ切り替え:', groupId);
  clearQueueAndStop();
  setStatus('モデル切り替え中...');
  await applyLipSyncSource(group.lipSyncSource);
  const model = group.models[group.currentModel ?? 0];
  try {
    await switchVRM(model.path);
    setStatus('');
  } catch (e) {
    setStatus(`エラー: ${e.message}`);
  }
});

// モデル切り替え（modelPathを受け取る）
api.onSwitchModel(async (modelPath) => {
  console.log('[vrm-win] モデル切り替え:', modelPath);
  clearQueueAndStop();
  setStatus('モデル切り替え中...');
  try {
    await switchVRM(modelPath);
    setStatus('');
  } catch (e) {
    setStatus(`エラー: ${e.message}`);
  }
});

// テキスト送信 → AI → 読み上げ
api.onSendText(async (userText) => {
  console.log('[vrm-win] テキスト受信:', userText);
  setStatus('考え中...');
  try {
    const aiText = await askAI(userText);
    enqueue(aiText);
    setStatus('');
  } catch (err) {
    console.error('[vrm-win] AI失敗:', err);
    setStatus(`エラー: ${err.message}`);
    setTimeout(() => setStatus(''), 3000);
  }
});

// キュークリア
api.onClearQueue(() => {
  clearQueueAndStop();
});

// Phase 5: ショートカット（クリップボード読み上げ）
api.onSpeakQueue((text) => enqueue(text));

// ─── 起動 ─────────────────────────────────────────────────────
async function main() {
  configCache = await api.getConfig();
  const firstGroup = configCache.groups?.[0];
  const firstModel = firstGroup?.models?.[0];
  const initialPath = firstModel?.path || 'assets/model.vrm';

  setStatus('モデルを読み込んでいます...');
  try {
    await initVRM('vrm-canvas', initialPath);
    setStatus('');
  } catch (err) {
    console.error('[vrm-win] VRM初期化失敗:', err);
    setStatus(`エラー: ${err.message}`);
  }

  if (firstGroup?.lipSyncSource) {
    await applyLipSyncSource(firstGroup.lipSyncSource).catch(console.error);
  }
}

main();
