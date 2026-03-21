// renderer/index.js — VRMウィンドウ専用エントリーポイント
import { initSceneOnly, initVRM, switchVRM, playMotion, getAlphaAtPixel,
         setCameraEnabled, getCameraOrbit, setCameraOrbit,
         updateCameraOrbit, updateCameraZoom, updateCameraTarget,
         setExpression } from './vrm.js';
import { speak, stopCurrentSpeech, setSpeakerId } from './voicevox.js';
import { askAI } from './ai.js';
import { setupVBCableAnalyser, teardownVBCable } from './lipsync.js';

const api = window.electronAPI;

// ヒットテスト関数をグローバルに公開（index.htmlのinlineスクリプトから使う）
window._getAlphaAtPixel   = getAlphaAtPixel;

// Phase 11: カメラ操作関数をグローバルに公開（index.htmlのinlineスクリプトから使う）
window._updateCameraOrbit  = updateCameraOrbit;
window._updateCameraZoom   = updateCameraZoom;
window._updateCameraTarget = updateCameraTarget;
// Phase 11-2: プリセット保存用にmain.jsからexecuteJavaScriptで呼べるよう公開
window._getCameraOrbit     = getCameraOrbit;

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
  // グループ切り替え時はモデルをロードしない（口パクソース・話者IDの切り替えのみ）
  await applyGroupSettings(group);
  console.log('[vrm-win] グループ切り替え完了:', groupId, '（モデルロードなし）');
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

// ── Phase 12-2: 表情切り替え ──────────────────────────────────
api.onSetExpression((expressionName) => {
  console.log('[vrm-win] 表情切り替え要求:', expressionName);
  setExpression(expressionName);
});

// ── Phase 10: VRMAモーション再生 ─────────────────────────────
api.onPlayMotion(async (motionPath) => {
  console.log('[vrm-win] VRMA再生要求:', motionPath);
  try {
    await playMotion(motionPath);
  } catch (err) {
    console.error('[vrm-win] VRMA再生失敗:', err);
  }
});

// ── Phase 10-3: 登場演出A ────────────────────────────────────
// 音声再生ヘルパー（new Audio() 使用。fetch は file:// で不安定なため使わない）
function _playEntranceSound(soundPath) {
  if (!soundPath) return;
  try {
    const base     = window.location.href.replace(/\/renderer\/[^/]+$/, '');
    const soundUrl = base + '/' + soundPath;
    console.log('[vrm-win] 登場演出: 音声再生:', soundUrl);
    const audio = new Audio(soundUrl);
    audio.play().catch(e => console.warn('[vrm-win] 登場演出: 音声再生失敗:', e.message));
  } catch (e) {
    console.warn('[vrm-win] 登場演出: 音声初期化失敗:', e.message);
  }
}

/** 登場演出の共通ロジック。patternKey = 'patternA' | 'patternB' */
async function _runEntrance(modelPath, modelConf, patternKey, label) {
  console.log(`[vrm-win] 登場演出${label} 開始:`, modelPath);
  clearQueueAndStop();
  setStatus(`登場演出${label} 読み込み中...`);

  // ① モデルロード
  try {
    await switchVRM(
      modelPath,
      modelConf?.lipsync  ?? {},
      configCache.blink   ?? {},
      mergeGaze(modelConf?.gaze),
      getIdleMotionConfig(),
      getRestPoseConfig(modelConf)
    );
  } catch (e) {
    console.error(`[vrm-win] 登場演出${label}: switchVRM失敗:`, e);
    setStatus(`エラー: ${e.message}`);
    return;
  }

  const pattern = modelConf?.entrance?.[patternKey];
  if (!pattern?.motion) {
    console.warn(`[vrm-win] 登場演出${label}: ${patternKey}.motion が未設定。モデルロードのみ実行。`);
    setStatus('');
    return;
  }

  const { motion, sound, soundDelayMs = 0 } = pattern;
  setStatus(`登場演出${label} 再生中...`);

  // ② soundDelayMs に応じて VRMA と音声の開始タイミングをずらす
  try {
    if (soundDelayMs < 0) {
      _playEntranceSound(sound);
      await new Promise(r => setTimeout(r, -soundDelayMs));
      await playMotion(motion);
    } else {
      await playMotion(motion);
      if (soundDelayMs === 0) {
        _playEntranceSound(sound);
      } else {
        setTimeout(() => _playEntranceSound(sound), soundDelayMs);
      }
    }
  } catch (e) {
    console.error(`[vrm-win] 登場演出${label}: VRMA再生失敗:`, e);
  }

  setStatus('');
}

api.onEntranceA(({ path: modelPath, modelConf }) => _runEntrance(modelPath, modelConf, 'patternA', 'A'));
api.onEntranceB(({ path: modelPath, modelConf }) => _runEntrance(modelPath, modelConf, 'patternB', 'B'));

// ── Phase 10-3: 登場演出C（ランダム抽選） ────────────────────
api.onEntranceC(({ path: modelPath, modelConf, randomMotion, randomSound }) => {
  console.log('[vrm-win] 登場演出C 開始:', modelPath, '| motion:', randomMotion, '| sound:', randomSound);
  (async () => {
    clearQueueAndStop();
    setStatus('登場演出C 読み込み中...');

    // ① モデルロード
    try {
      await switchVRM(
        modelPath,
        modelConf?.lipsync  ?? {},
        configCache.blink   ?? {},
        mergeGaze(modelConf?.gaze),
        getIdleMotionConfig(),
        getRestPoseConfig(modelConf)
      );
    } catch (e) {
      console.error('[vrm-win] 登場演出C: switchVRM失敗:', e);
      setStatus(`エラー: ${e.message}`);
      return;
    }

    if (!randomMotion) {
      console.warn('[vrm-win] 登場演出C: VRMAが見つかりませんでした。モデルロードのみ実行。');
      setStatus('');
      return;
    }

    // soundDelayMs は patternC.soundDelayMs → なければ 0
    const soundDelayMs = modelConf?.entrance?.patternC?.soundDelayMs ?? 0;
    setStatus('登場演出C 再生中...');

    // ② soundDelayMs に応じて VRMA と音声の開始タイミングをずらす
    try {
      if (soundDelayMs < 0) {
        _playEntranceSound(randomSound);
        await new Promise(r => setTimeout(r, -soundDelayMs));
        await playMotion(randomMotion);
      } else {
        await playMotion(randomMotion);
        if (soundDelayMs === 0) {
          _playEntranceSound(randomSound);
        } else {
          setTimeout(() => _playEntranceSound(randomSound), soundDelayMs);
        }
      }
    } catch (e) {
      console.error('[vrm-win] 登場演出C: VRMA再生失敗:', e);
    }

    setStatus('');
  })();
});

// ── Phase 11: カメラON/OFF ────────────────────────────────────
api.onCameraToggle((enabled) => {
  setCameraEnabled(enabled);
  console.log('[vrm-win] カメラ操作:', enabled ? 'ON' : 'OFF');
});

// ── Phase 11-2: プリセット呼び出し・リセット ─────────────────
api.onSetCameraOrbit((data) => {
  setCameraOrbit(data);
  console.log('[vrm-win] カメラ位置セット:', data);
});

// ─── 起動 ─────────────────────────────────────────────────────
async function main() {
  configCache = await api.getConfig();
  const firstGroup = configCache.groups?.[0];

  if (firstGroup) await applyGroupSettings(firstGroup).catch(console.error);

  // シーンのみ初期化。モデルはロードしない（起動時は空の透過背景）
  try {
    initSceneOnly('vrm-canvas', configCache.lighting ?? {});
  } catch (err) {
    console.error('[vrm-win] シーン初期化失敗:', err);
    setStatus(`エラー: ${err.message}`);
  }
}

main();
