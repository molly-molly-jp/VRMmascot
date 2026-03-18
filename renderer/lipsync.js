// renderer/lipsync.js — Web Audio API 口パク制御
// Phase 3: MediaElementAudioSourceNode（VOICEVOX再生時）
// Phase 6: getUserMedia ストリーム（VB-Cableループバック）
// Phase 7: グループ切り替え時の入力ソース切り替え対応

// ── Phase 3用: VOICEVOX直接再生の口パク ───────────────────────
let voicevoxAnalyser  = null;
let voicevoxDataArray = null;

export function setupAnalyserFromElement(audioCtx, audioElement) {
  voicevoxAnalyser = audioCtx.createAnalyser();
  voicevoxAnalyser.fftSize = 256;
  voicevoxAnalyser.smoothingTimeConstant = 0.6;
  const source = audioCtx.createMediaElementSource(audioElement);
  source.connect(voicevoxAnalyser);
  voicevoxAnalyser.connect(audioCtx.destination);
  voicevoxDataArray = new Uint8Array(voicevoxAnalyser.frequencyBinCount);
}

export function resetLipSync() {
  voicevoxAnalyser  = null;
  voicevoxDataArray = null;
}

// ── Phase 6用: VB-Cableループバック ───────────────────────────
let vbcableAnalyser  = null;
let vbcableDataArray = null;
let vbcableStream    = null;
let vbcableCtx       = null;

// VB-Cable接続状態を外部から確認できるよう公開
export function isVBCableActive() {
  return vbcableAnalyser !== null;
}

export async function setupVBCableAnalyser(deviceNameHint) {
  // 既存接続をクリーンアップ
  await teardownVBCable();

  try {
    // ─── getUserMedia を先に呼んで許可取得 ───────────────────
    // 許可なしで enumerateDevices() を呼ぶとラベルが全て "" になる
    console.log('[lipsync] マイク許可を要求中...');
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      tmp.getTracks().forEach(t => t.stop());
      console.log('[lipsync] マイク許可: 取得成功');
    } catch (e) {
      console.warn('[lipsync] マイク許可取得失敗（継続試行）:', e.message);
    }

    // 許可取得後にデバイス一覧を取得（ラベルが見える）
    const devices    = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    console.log('[lipsync] 入力デバイス一覧:');
    audioInputs.forEach(d => console.log(`  - "${d.label}" (id: ${d.deviceId})`));

    const target = audioInputs.find(d =>
      d.label.toLowerCase().includes(deviceNameHint.toLowerCase())
    );
    if (!target) {
      console.warn(`[lipsync] ✗ VB-Cableデバイスが見つかりません: "${deviceNameHint}"`);
      console.warn('[lipsync] 上記デバイス名のいずれかを config.json の lipSyncDevice に設定してください');
      return false; // 失敗を返す
    }
    console.log(`[lipsync] ✓ VB-Cableデバイス検出: "${target.label}"`);

    vbcableStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: target.deviceId }, echoCancellation: false, noiseSuppression: false },
      video: false,
    });

    vbcableCtx = new AudioContext();
    await vbcableCtx.resume();

    vbcableAnalyser = vbcableCtx.createAnalyser();
    vbcableAnalyser.fftSize = 256;
    vbcableAnalyser.smoothingTimeConstant = 0.6;

    const src = vbcableCtx.createMediaStreamSource(vbcableStream);
    src.connect(vbcableAnalyser);
    vbcableDataArray = new Uint8Array(vbcableAnalyser.frequencyBinCount);

    console.log('[lipsync] ✓ VB-Cable口パク: セットアップ完了');
    return true; // 成功を返す
  } catch (err) {
    console.error('[lipsync] VB-Cableセットアップ失敗:', err.message);
    // 失敗時は確実にクリア（中途半端な状態を残さない）
    vbcableAnalyser  = null;
    vbcableDataArray = null;
    vbcableStream    = null;
    vbcableCtx       = null;
    return false;
  }
}

export async function teardownVBCable() {
  if (vbcableStream) {
    vbcableStream.getTracks().forEach(t => t.stop());
    vbcableStream = null;
  }
  if (vbcableCtx) {
    await vbcableCtx.close().catch(() => {});
    vbcableCtx = null;
  }
  vbcableAnalyser  = null;
  vbcableDataArray = null;
  console.log('[lipsync] VB-Cable解除');
}

// ── 音量取得 ──────────────────────────────────────────────────
function getRMS(analyser, dataArray) {
  if (!analyser || !dataArray) return 0;
  analyser.getByteFrequencyData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
  return Math.sqrt(sum / dataArray.length) / 255;
}

// Phase3とPhase6の大きい方を採用
// sensitivity : 音量に対する口の反応倍率（デフォルト1.0）
// maxMouthOpen: 口の最大開口量の上限 0.0〜1.0（デフォルト1.0）
export function getLipSyncValue(sensitivity = 1.0, maxMouthOpen = 1.0) {
  const v = getRMS(voicevoxAnalyser, voicevoxDataArray);
  const c = getRMS(vbcableAnalyser,  vbcableDataArray);
  return Math.min(maxMouthOpen, Math.max(v, c) * 3.5 * sensitivity);
}
