// renderer/lipsync.js — Web Audio API 口パク制御
// Phase 3: MediaElementAudioSourceNode（VOICEVOX再生時）
// Phase 6: getUserMedia ストリーム（VB-Cableループバック）

// Phase 3用
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

// Phase 6用
let vbcableAnalyser  = null;
let vbcableDataArray = null;

export async function setupVBCableAnalyser(deviceNameHint) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    console.log('[lipsync] 利用可能なオーディオ入力デバイス一覧:');
    audioInputs.forEach(d => console.log(`  - "${d.label}" (id: ${d.deviceId})`));

    const target = audioInputs.find(d =>
      d.label.toLowerCase().includes(deviceNameHint.toLowerCase())
    );
    if (!target) {
      console.error(`[lipsync] VB-Cableデバイスが見つかりません: "${deviceNameHint}"`);
      return;
    }
    console.log(`[lipsync] VB-Cableデバイス検出: "${target.label}"`);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: target.deviceId } },
      video: false,
    });

    // AudioContextを作成してすぐにresumeする
    const ctx = new AudioContext();
    await ctx.resume();
    console.log('[lipsync] VB-Cable AudioContext state:', ctx.state);

    vbcableAnalyser = ctx.createAnalyser();
    vbcableAnalyser.fftSize = 256;
    vbcableAnalyser.smoothingTimeConstant = 0.6;

    // streamSource → analyserのみ（destinationには繋がない＝二重出力防止）
    const source = ctx.createMediaStreamSource(stream);
    source.connect(vbcableAnalyser);

    vbcableDataArray = new Uint8Array(vbcableAnalyser.frequencyBinCount);
    console.log('[lipsync] VB-Cable口パク: セットアップ完了');
  } catch (err) {
    console.error('[lipsync] VB-Cableセットアップ失敗:', err.message);
  }
}

function getRMS(analyser, dataArray) {
  if (!analyser || !dataArray) return 0;
  analyser.getByteFrequencyData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
  return Math.sqrt(sum / dataArray.length) / 255;
}

// Phase3とPhase6の大きい方を採用
export function getLipSyncValue() {
  const v = getRMS(voicevoxAnalyser, voicevoxDataArray);
  const c = getRMS(vbcableAnalyser,  vbcableDataArray);
  return Math.min(1.0, Math.max(v, c) * 3.5);
}
