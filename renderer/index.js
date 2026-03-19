// renderer/index.js — VRMウィンドウ専用エントリーポイント
import { initVRM, switchVRM, playMotion, getAlphaAtPixel } from './vrm.js';
import { speak, stopCurrentSpeech, setSpeakerId } from './voicevox.js';
import { askAI } from './ai.js';
import { setupVBCableAnalyser, teardownVBCable } from './lipsync.js';

const api = window.electronAPI;

// ヒットテスト関数をグローバルに公開（index.htmlのinlineスクリプトから使う）
window._getAlphaAtPixel = getAlphaAtPixel;

window.addEventListener('unhandledrejection', (e) => {
  console.error('[vrm-win] unhandledrejection:', e.reason);
  e.preventDefault();
});

// ─── ステータス通知 ────────────────────────────────────────────
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

// ─── 口パク＆話者設定 ─────────────────────────────────────────
let configCache = null;

// グローバル gaze をベースに、モデル個別 gaze で上書きしてマージ
function mergeGaze(modelGaze) {
  return { ...(configCache.gaze ?? {}), ...(modelGaze ?? {}) };
}

// idleMotion はグローバル設定をそのまま使う（モデル個別設定は現時点では無し）
function getIdleMotionConfig() {
  return configCache.idleMotion ?? {};
}

function getRestPoseConfig(modelConf) {
  // モデル個別設定があればそちらを優先、なければグローバルにフォールバック
  return modelConf?.restPose ?? configCache.restPose ?? {};
}

async function applyGroupSettings(group) {
  const id = group.speakerId ?? 0;
  setSpeakerId(id);
  console.log('[vrm-win] 話者ID:', id);
  if (group.lipSyncSource === 'vbcable') {
    const deviceName = configCache?.lipSyncDevice || 'ステレオ ミキサー (Realtek(R) Audio)';
    const ok = await setupVBCableAnalyser(deviceName);
    console.log('[vrm-win] VB-Cable:', ok ? '✓成功' : '✗失敗');
  } else {
    await teardownVBCable();
    console.log('[vrm-win] Clipboardモード');
  }
}

// ─── IPC受信 ──────────────────────────────────────────────────
api.onSwitchGroup(async (groupId) => {
  const group = configCache?.groups?.find(g => g.id === groupId);
  if (!group) return console.error('[vrm-win] グループ未発見:', groupId);
  clearQueueAndStop();
  setStatus('モデル切り替え中...');
  await applyGroupSettings(group);
  const model = group.models[group.currentModel ?? 0];
  try { await switchVRM(model.path, model.lipsync ?? {}, configCache.blink ?? {}, mergeGaze(model.gaze), getIdleMotionConfig(), getRestPoseConfig(model)); setStatus(''); }
  catch (e) { setStatus(`エラー: ${e.message}`); }
});

api.onSwitchModel(async ({ path: modelPath, modelConf }) => {
  clearQueueAndStop();
  setStatus('モデル切り替え中...');
  try {
    await switchVRM(
      modelPath,
      modelConf?.lipsync   ?? {},
      configCache.blink    ?? {},
      mergeGaze(modelConf?.gaze),
      getIdleMotionConfig(),
      getRestPoseConfig(modelConf)
    );
    setStatus('');
  } catch (e) { setStatus(`エラー: ${e.message}`); }
});

api.onSendText(async (userText) => {
  setStatus('考え中...');
  try {
    const aiText = await askAI(userText);
    enqueue(aiText);
    setStatus('');
  } catch (err) {
    setStatus(`エラー: ${err.message}`);
    setTimeout(() => setStatus(''), 3000);
  }
});

api.onClearQueue(() => clearQueueAndStop());
api.onSpeakQueue((text) => enqueue(text));

// ── Phase 10: VRMAモーション再生 ─────────────────────────────
api.onPlayMotion(async (motionPath) => {
  console.log('[vrm-win] VRMA再生要求:', motionPath);
  try {
    await playMotion(motionPath);
  } catch (err) {
    console.error('[vrm-win] VRMA再生失敗:', err);
  }
});

// ─── 起動 ─────────────────────────────────────────────────────
async function main() {
  configCache = await api.getConfig();
  const firstGroup = configCache.groups?.[0];
  const firstModel = firstGroup?.models?.[0];
  const initialPath = firstModel?.path || 'assets/model.vrm';

  if (firstGroup) await applyGroupSettings(firstGroup).catch(console.error);

  setStatus('モデルを読み込んでいます...');
  try {
    await initVRM('vrm-canvas', initialPath, firstModel?.lipsync ?? {}, configCache.blink ?? {}, mergeGaze(firstModel?.gaze), getIdleMotionConfig(), getRestPoseConfig(firstModel));
    setStatus('');
  } catch (err) {
    console.error('[vrm-win] VRM初期化失敗:', err);
    setStatus(`エラー: ${err.message}`);
  }
}

main();
