// renderer/vrm.js  — Three.js + @pixiv/three-vrm によるVRM表示
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { getLipSyncValue } from './lipsync.js';

export let currentVRM = null;
let lipSyncExpressionName = null;

// Phase 12-2: 表情レイヤー
// VRM0 と VRM1 で表情名が異なるため、両方の候補名を持つ。
// 例: joy(VRM0) → happy(VRM1)、sorrow(VRM0) → sad(VRM1)、fun(VRM0) → relaxed(VRM1)
// 各エントリーは [ 論理名, ...候補名の優先順 ] の形式。
// setValue は候補名を順に試し、最初に存在するものを使う。
const EXPRESSION_ALIAS_MAP = [
  { key: 'neutral',   aliases: ['neutral'] },
  { key: 'fun',       aliases: ['fun', 'relaxed'] },
  { key: 'joy',       aliases: ['joy', 'happy'] },
  { key: 'sorrow',    aliases: ['sorrow', 'sad'] },
  { key: 'surprised', aliases: ['surprised'] },
  { key: 'angry',     aliases: ['angry'] },
];

let currentExpressionKey = null; // 論理名 ('fun' / 'joy' / ... / null)

/**
 * 表情を切り替える。IPC経由で index.js から呼ばれる。
 * 'neutral' または null を渡すと全表情オフ（リセット）。
 */
export function setExpression(name) {
  currentExpressionKey = (name === 'neutral' || name == null) ? null : name;
  console.log('[VRM] 表情切り替え:', name ?? 'null', '→ currentExpressionKey:', currentExpressionKey);
}

/**
 * expressionManager に指定した値をセットする。
 * aliases を順に試し、存在する名前だけに適用する。
 */
function _setExpressionValue(em, aliases, value) {
  for (const alias of aliases) {
    try {
      em.setValue(alias, value);
    } catch (_) {
      // 存在しない表情名は無視
    }
  }
}

/**
 * アニメループ内で毎フレーム呼ぶ。
 * 表情プリセットの値を確定させる（瞬き・口パク・視線とは独立したレイヤー）。
 */
function applyExpressionLayer(vrm) {
  if (!vrm?.expressionManager) return;
  const em = vrm.expressionManager;
  for (const { key, aliases } of EXPRESSION_ALIAS_MAP) {
    const val = key === currentExpressionKey ? 1.0 : 0.0;
    _setExpressionValue(em, aliases, val);
  }
}

// タスク9-1: モデル個別の口パク設定（config.json の lipsync オブジェクト）
let lipSyncSensitivity  = 1.0;
let lipSyncMaxMouthOpen = 1.0;

let renderer, scene, camera;
let ambientLight, dirLight;  // Phase 12-1: ライティング参照
let currentLightingCfg = {}; // Phase 12-1: MToon調整で参照するために保持

// Phase 12-1: MToon毎フレーム上書き用（vrm.update()による巻き戻しを防ぐ）
let mtoonOverrideMaterials = []; // 対象マテリアルのキャッシュ
let mtoonShadingShiftOverride = null; // null = 上書きしない
let mtoonShadeDarken = null; // シェード色の暗さ係数（0.0〜1.0、小さいほど暗い）

// VRMローダー（VRMモデル用）
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

// VRMAローダー（VRMAモーション用）
const vrmaLoader = new GLTFLoader();
vrmaLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

// ── タスク10-1: VRMAモーション再生 ──────────────────────────────
let currentMixer    = null;   // THREE.AnimationMixer
let currentClipAction = null; // AnimationAction（停止用）
let isPlayingVRMA   = false;  // VRMA再生中フラグ

/**
 * VRMAモーションを再生する。
 * 再生中は pauseIdleMotion() を呼び、待機モーションを一時停止する。
 * 再生終了後に resumeIdleMotion() を自動呼出し。
 * @param {string} vrmaPath  assets/motions/xxx.vrma のような相対パス
 */
export async function playMotion(vrmaPath) {
  if (!currentVRM) {
    console.warn('[VRM] playMotion: VRMがロードされていません');
    return;
  }

  // 既再生中なら停止してリセット
  if (currentMixer && currentClipAction) {
    currentClipAction.stop();
    currentMixer.stopAllAction();
    currentMixer = null;
    currentClipAction = null;
    isPlayingVRMA = false;
    resumeIdleMotion();
  }

  const vrmaUrl = getBaseUrl() + '/' + vrmaPath;
  console.log('[VRM] VRMA読み込み:', vrmaUrl);

  let gltf;
  try {
    gltf = await vrmaLoader.loadAsync(vrmaUrl);
  } catch (e) {
    console.error('[VRM] VRMA読み込み失敗:', e.message);
    return;
  }

  const vrmAnimation = gltf.userData.vrmAnimations?.[0];
  if (!vrmAnimation) {
    console.error('[VRM] vrmAnimations が見つかりません');
    return;
  }

  const clip = createVRMAnimationClip(vrmAnimation, currentVRM);
  currentMixer = new THREE.AnimationMixer(currentVRM.scene);
  currentClipAction = currentMixer.clipAction(clip);
  currentClipAction.setLoop(THREE.LoopOnce, 1);
  currentClipAction.clampWhenFinished = true;
  currentClipAction.play();

  isPlayingVRMA = true;
  pauseIdleMotion();  // 待機モーションを止める
  console.log('[VRM] VRMA再生開始:', vrmaPath);

  // 再生終了イベント → なめらか復帰フェーズへ移行
  currentMixer.addEventListener('finished', () => {
    console.log('[VRM] VRMA再生終了 → 復帰フェーズ開始 (', returnToRestDuration, '秒)');
    isPlayingVRMA = false;
    // clampWhenFinished=true によるボーン固定を解除
    currentClipAction.stop();
    currentMixer.stopAllAction();
    currentMixer     = null;
    currentClipAction = null;

    // 復帰フェーズ: VRMA終了時のボーン姿勢をスナップショットとして保存
    returnToRestSnapshot.clear();
    for (const [boneName, state] of idleMotionBoneState) {
      returnToRestSnapshot.set(boneName, {
        x: state.node.rotation.x,
        y: state.node.rotation.y,
        z: state.node.rotation.z,
      });
    }

    if (idleMotionBoneState.size > 0 && returnToRestDuration > 0) {
      // 管理下のボーンがある場合はなめらか補間
      returnToRestProgress = 0.0;
      isReturningToRest    = true;
      // idleMotionPaused は true のまま → updateIdleMotion の復帰フェーズが管理
    } else {
      // 待機モーション未設定のときは即時再開
      resumeIdleMotion();
    }
  });
}

function getBaseUrl() {
  return window.location.href.replace(/\/renderer\/[^/]+$/, '');
}

// ── Phase 12-1: MToonマテリアル調整 ──────────────────────────
/**
 * VRMのMToonマテリアルパラメータを config.json の lighting.mtoon 設定で上書きする。
 * shadeShift (VRM0) / shadingShiftFactor (VRM1) を下げると影エリアが広くなる。
 * 範囲: -1.0（影が多い）〜 1.0（影なし）。デフォルト値はモデル依存で通常 0〜1 付近。
 */
function applyMtoonSettings(vrm, mtoonCfg) {
  if (!mtoonCfg || Object.keys(mtoonCfg).length === 0) return;

  const shadeShift         = mtoonCfg.shadeShift;
  const shadingShiftFactor = mtoonCfg.shadingShiftFactor;

  // 毎フレーム上書き用にマテリアルをキャッシュ
  mtoonOverrideMaterials = [];
  mtoonShadingShiftOverride = shadingShiftFactor ?? null;
  mtoonShadeDarken = mtoonCfg.shadeDarken ?? null;

  let count = 0;
  vrm.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!mat) continue;
      const type = mat.type || '';
      // VRM0
      if (type.includes('MToon') && shadeShift !== undefined && mat.shadeShift !== undefined) {
        mat.shadeShift = shadeShift;
        mat.needsUpdate = true;
        count++;
      }
      // VRM1: uniforms.shadingShiftFactor があればキャッシュに追加
      if (shadingShiftFactor !== undefined && mat.uniforms?.shadingShiftFactor !== undefined) {
        // 元のシェード色を保存しておく
        const origShade = mat.uniforms.shadeColorFactor?.value;
        mtoonOverrideMaterials.push({ mat, origShade });
        count++;
      }
    }
  });
  console.log(`[VRM] MToon設定: ${count}マテリアルをキャッシュ (毎フレーム上書きON)`, mtoonCfg);
}

function resolveLipSyncExpression(vrm) {
  if (!vrm.expressionManager) return null;
  const em = vrm.expressionManager;
  const names = em.expressionMap instanceof Map
    ? [...em.expressionMap.keys()]
    : Object.keys(em.expressionMap ?? {});
  console.log('[VRM] Expression一覧:', names);
  for (const candidate of ['aa', 'A', 'a']) {
    if (names.includes(candidate)) return candidate;
  }
  return null;
}

// ── タスク9-2: 自動瞬き ───────────────────────────────────────
// Expression名の解決（VRM0/VRM1両対応）
// 戻り値: { type: 'single', name } | { type: 'dual', left, right } | null
function resolveBlinkExpression(vrm) {
  if (!vrm.expressionManager) return null;
  const em = vrm.expressionManager;
  const names = em.expressionMap instanceof Map
    ? [...em.expressionMap.keys()]
    : Object.keys(em.expressionMap ?? {});

  // 両目まとめて動かせる単一Expression（優先）
  for (const n of ['blink', 'Blink']) {
    if (names.includes(n)) {
      console.log('[VRM] 瞬きExpression (single):', n);
      return { type: 'single', name: n };
    }
  }
  // 左右別Expression
  const left  = names.find(n => ['blinkLeft',  'Blink_L'].includes(n));
  const right = names.find(n => ['blinkRight', 'Blink_R'].includes(n));
  if (left && right) {
    console.log('[VRM] 瞬きExpression (dual):', left, right);
    return { type: 'dual', left, right };
  }
  console.warn('[VRM] 瞬きExpressionが見つかりません');
  return null;
}

// 瞬きステートマシン用変数
let blinkExpr       = null;   // resolveBlinkExpression の戻り値
let blinkEnabled    = true;
let blinkIntervalMin = 2.0;
let blinkIntervalMax = 6.0;
let blinkSpeed       = 0.15;  // 目を閉じる／開くのにかかる秒数

let blinkTimer  = 3.0;        // 次の瞬きまでの残り時間（秒）
let blinkPhase  = 'idle';     // 'idle' | 'closing' | 'opening'
let blinkValue  = 0.0;        // 現在の閉じ具合 0(開)〜1(閉)

function setBlinkConfig(cfg) {
  blinkEnabled     = cfg?.enabled     ?? true;
  blinkIntervalMin = cfg?.intervalMin ?? 2.0;
  blinkIntervalMax = cfg?.intervalMax ?? 6.0;
  blinkSpeed       = cfg?.blinkSpeed  ?? 0.15;
  // モデル切り替え時はステートをリセット
  blinkTimer = blinkIntervalMin + Math.random() * (blinkIntervalMax - blinkIntervalMin);
  blinkPhase = 'idle';
  blinkValue = 0.0;
  console.log('[VRM] 瞬き設定:', { blinkEnabled, blinkIntervalMin, blinkIntervalMax, blinkSpeed });
}

function setBlinkValue(vrm, value) {
  if (!vrm?.expressionManager || !blinkExpr) return;
  if (blinkExpr.type === 'single') {
    vrm.expressionManager.setValue(blinkExpr.name, value);
  } else {
    vrm.expressionManager.setValue(blinkExpr.left,  value);
    vrm.expressionManager.setValue(blinkExpr.right, value);
  }
}

function updateBlink(vrm, delta) {
  if (!blinkEnabled || !blinkExpr) return;

  if (blinkPhase === 'idle') {
    blinkTimer -= delta;
    if (blinkTimer <= 0) {
      blinkPhase = 'closing';
    }
  } else if (blinkPhase === 'closing') {
    blinkValue += delta / blinkSpeed;
    if (blinkValue >= 1.0) {
      blinkValue = 1.0;
      blinkPhase = 'opening';
    }
    setBlinkValue(vrm, blinkValue);
  } else if (blinkPhase === 'opening') {
    blinkValue -= delta / blinkSpeed;
    if (blinkValue <= 0.0) {
      blinkValue = 0.0;
      blinkPhase = 'idle';
      blinkTimer = blinkIntervalMin + Math.random() * (blinkIntervalMax - blinkIntervalMin);
    }
    setBlinkValue(vrm, blinkValue);
  }
}

// ── タスク9-3: 視線ランダム移動 ──────────────────────────────
// vrm.lookAt.target の位置を毎フレーム動かして視線を制御する。
// angleX: 垂直方向の最大角度（ラジアン）
// angleY: 水平方向の最大角度（ラジアン）
// returnSpeed: 現在角度を目標角度に近づける速さ（lerp係数 /秒）

let gazeEnabled     = true;
let gazeIntervalMin = 2.0;
let gazeIntervalMax = 6.0;
let gazeAngleX      = 0.08;  // 垂直
let gazeAngleY      = 0.05;  // 水平
let gazeReturnSpeed = 0.8;

let gazeTimer    = 3.0;   // 次の目標切り替えまでの残り時間
let gazeTargetX  = 0.0;   // 目標角度（垂直）
let gazeTargetY  = 0.0;   // 目標角度（水平）
let gazeCurrentX = 0.0;   // 現在の補間済み角度（垂直）
let gazeCurrentY = 0.0;   // 現在の補間済み角度（水平）

// lookAt target を配置するための作業用Object3D（scene追加不要）
const _gazeLookAtTarget = new THREE.Object3D();

function setGazeConfig(cfg) {
  gazeEnabled     = cfg?.enabled     ?? true;
  gazeIntervalMin = cfg?.intervalMin ?? 2.0;
  gazeIntervalMax = cfg?.intervalMax ?? 6.0;
  gazeAngleX      = cfg?.angleX      ?? 0.08;
  gazeAngleY      = cfg?.angleY      ?? 0.05;
  gazeReturnSpeed = cfg?.returnSpeed ?? 0.8;
  // モデル切り替え時はリセット
  gazeTimer    = gazeIntervalMin + Math.random() * (gazeIntervalMax - gazeIntervalMin);
  gazeTargetX  = 0.0;
  gazeTargetY  = 0.0;
  gazeCurrentX = 0.0;
  gazeCurrentY = 0.0;
  console.log('[VRM] 視線設定:', { gazeEnabled, gazeIntervalMin, gazeIntervalMax, gazeAngleX, gazeAngleY, gazeReturnSpeed });
}

// ── レストポーズ（Tポーズ→腕下げ等の初期姿勢補正） ────────────
// VRMロード直後に一度だけ呼ぶ。idleMotion は上腕ボーンを触らないので競合しない。
// config.jsonの restPose.bones で各ボーンの x/y/z オフセット（ラジアン）を指定する。
function applyRestPose(vrm, cfg) {
  if (!cfg?.enabled) return;
  if (!vrm?.humanoid) return;

  const boneCfgs = cfg?.bones ?? [];
  for (const bc of boneCfgs) {
    const node = vrm.humanoid.getNormalizedBoneNode(bc.name);
    if (!node) {
      console.warn('[VRM] restPose: ボーンが見つかりません:', bc.name);
      continue;
    }
    if (bc.x != null) node.rotation.x = bc.x;
    if (bc.y != null) node.rotation.y = bc.y;
    if (bc.z != null) node.rotation.z = bc.z;
    console.log('[VRM] restPose 適用:', bc.name,
      'x:', node.rotation.x.toFixed(3),
      'y:', node.rotation.y.toFixed(3),
      'z:', node.rotation.z.toFixed(3));
  }
}

// ── タスク9-4: 待機モーション（sin波ボーン揺れ） ────────────────
//
// 設計:
//   各モーションエントリーが sin(2π × elapsedTime / period + phase) × amplitude を
//   指定ボーン・指定軸に加算する。周期を素数秒（5・7・11等）にすることで
//   重なりにくく自然な動きになる。
//
//   restPose適用後の基準回転を baseRotation として保存し、
//   毎フレーム「基準 + sinデルタ合計」を書き込む（restPoseを壊さない）。
//
//   pauseIdleMotion()  : VRMA再生開始時に呼ぶ → elapsedTimeを凍結
//   resumeIdleMotion() : VRMA再生終了後に呼ぶ → elapsedTimeを再加算開始
//   ※ 一時停止中はボーン値を触らない（VRMAが制御するため）

let idleMotionEnabled = true;
let idleMotionPaused  = false;
let idleElapsed       = 0.0;  // 累積秒数（pause中は止まる）

// VRMA終了後のなめらか復帰フェーズ
let isReturningToRest    = false;
let returnToRestProgress = 0.0;   // 0.0 → 1.0
let returnToRestDuration = 0.8;   // 秒（config.json の idleMotion.returnDuration で上書き）
// boneName → { x, y, z }  VRMA終了直後のボーン姿勢スナップショット
const returnToRestSnapshot = new Map();

// ランタイム: ボーンごとの状態（基準回転）
// Map<boneName, { node, baseX, baseY, baseZ }>
let idleMotionBoneState = new Map();

// ランタイム: モーションエントリーリスト
// [{ boneName, axis, period, amplitude, phase }, ...]
let idleMotionEntries = [];

export function pauseIdleMotion()  { idleMotionPaused = true;  }
export function resumeIdleMotion() {
  idleMotionPaused    = false;
  isReturningToRest   = false;   // 外から強制再開する場合もリセット
  returnToRestProgress = 0.0;
}

/**
 * VRMロード後（applyRestPose呼び出し後）に呼ぶ。
 * 各ボーンの現在回転を baseRotation として記録してからエントリーを構築する。
 */
function setIdleMotionConfig(vrm, cfg) {
  idleMotionBoneState.clear();
  idleMotionEntries   = [];
  idleMotionEnabled   = cfg?.enabled ?? true;
  idleMotionPaused    = false;
  idleElapsed         = 0.0;
  returnToRestDuration = cfg?.returnDuration ?? 0.8;
  isReturningToRest    = false;
  returnToRestProgress = 0.0;
  returnToRestSnapshot.clear();

  if (!idleMotionEnabled || !vrm?.humanoid) {
    if (idleMotionEnabled && !vrm?.humanoid)
      console.warn('[VRM] 待機モーション: humanoidが見つかりません');
    return;
  }

  for (const m of cfg?.motions ?? []) {
    const node = vrm.humanoid.getNormalizedBoneNode(m.bone);
    if (!node) {
      console.warn('[VRM] 待機モーション: ボーン未発見:', m.bone);
      continue;
    }
    // 初回登場ボーン → 現在回転（restPose適用済み）を基準として保存
    if (!idleMotionBoneState.has(m.bone)) {
      idleMotionBoneState.set(m.bone, {
        node,
        baseX: node.rotation.x,
        baseY: node.rotation.y,
        baseZ: node.rotation.z,
      });
    }
    idleMotionEntries.push({
      boneName:  m.bone,
      axis:      m.axis      ?? 'x',
      period:    m.period    ?? 7.0,
      amplitude: m.amplitude ?? 0.02,
      phase:     m.phase     ?? 0.0,
    });
  }

  console.log('[VRM] 待機モーション(sin波)初期化:',
    idleMotionEntries.length, 'エントリー /',
    idleMotionBoneState.size, 'ボーン');
}

/**
 * アニメーションループから毎フレーム呼ぶ。
 * pauseIdleMotion() 中は elapsedTime を止め、ボーンも触らない。
 */
function updateIdleMotion(delta) {
  if (!idleMotionEnabled || idleMotionBoneState.size === 0) return;

  // ── VRMA終了後の復帰フェーズ ────────────────────────────────
  // VRMA終了ポーズ → baseRotation へ returnToRestDuration 秒でイーズイン/アウト補間
  if (isReturningToRest) {
    returnToRestProgress += delta / returnToRestDuration;
    const t    = Math.min(returnToRestProgress, 1.0);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOut
    for (const [boneName, state] of idleMotionBoneState) {
      const snap = returnToRestSnapshot.get(boneName);
      if (!snap) continue;
      state.node.rotation.x = snap.x + (state.baseX - snap.x) * ease;
      state.node.rotation.y = snap.y + (state.baseY - snap.y) * ease;
      state.node.rotation.z = snap.z + (state.baseZ - snap.z) * ease;
    }
    if (returnToRestProgress >= 1.0) {
      // 補間完了 → 待機モーション再開
      isReturningToRest = false;
      idleMotionPaused  = false;
      idleElapsed       = 0.0;   // elapsedをリセットして自然な頭出しから再開
      console.log('[VRM] 復帰完了 → 待機モーション再開');
    }
    return; // 復帰フェーズ中は通常の待機モーションを動かさない
  }

  if (idleMotionPaused) return;

  idleElapsed += delta;

  // ── 各ボーンのsinデルタを集計 ──────────────────────────────
  // Map<boneName, { dx, dy, dz }>
  const deltas = new Map();
  for (const e of idleMotionEntries) {
    if (!deltas.has(e.boneName)) deltas.set(e.boneName, { dx: 0, dy: 0, dz: 0 });
    const d   = deltas.get(e.boneName);
    const val = Math.sin(2 * Math.PI * idleElapsed / e.period + e.phase) * e.amplitude;
    if      (e.axis === 'x') d.dx += val;
    else if (e.axis === 'y') d.dy += val;
    else if (e.axis === 'z') d.dz += val;
  }

  // ── 基準回転 + sinデルタをボーンに書き込む ─────────────────
  for (const [boneName, state] of idleMotionBoneState) {
    const d = deltas.get(boneName) ?? { dx: 0, dy: 0, dz: 0 };
    state.node.rotation.x = state.baseX + d.dx;
    state.node.rotation.y = state.baseY + d.dy;
    state.node.rotation.z = state.baseZ + d.dz;
  }
}

function updateGaze(vrm, delta) {
  if (!gazeEnabled || !vrm.lookAt) return;

  // タイマーで目標角度を更新
  gazeTimer -= delta;
  if (gazeTimer <= 0) {
    // 半分の確率で正面に戻す（自然な動きのため）
    if (Math.random() < 0.3) {
      gazeTargetX = 0.0;
      gazeTargetY = 0.0;
    } else {
      gazeTargetX = (Math.random() * 2 - 1) * gazeAngleX;
      gazeTargetY = (Math.random() * 2 - 1) * gazeAngleY;
    }
    gazeTimer = gazeIntervalMin + Math.random() * (gazeIntervalMax - gazeIntervalMin);
  }

  // 現在角度を目標に向けてスムーズに補間
  const t = Math.min(1.0, gazeReturnSpeed * delta * 60);
  gazeCurrentX += (gazeTargetX - gazeCurrentX) * t;
  gazeCurrentY += (gazeTargetY - gazeCurrentY) * t;

  // 頭ボーンのワールド位置を取得してlookAt targetを配置
  const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
  if (!headNode) return;

  const headPos = new THREE.Vector3();
  headNode.getWorldPosition(headPos);

  // 2m前方を基点に上下左右オフセット
  const dist = 2.0;
  _gazeLookAtTarget.position.set(
    headPos.x + Math.sin(gazeCurrentY) * dist,
    headPos.y - Math.sin(gazeCurrentX) * dist,
    headPos.z - Math.cos(gazeCurrentY) * dist
  );

  vrm.lookAt.target = _gazeLookAtTarget;
}

// ── Phase 11: オービットカメラ ────────────────────────────────
// カメラはキャラクター中心を注視点に球面上を回るオービット方式で管理する。
// cameraEnabled フラグはユーザー入力の受け付けのみ制御する。
// orbit params → camera.position への変換は常に有効。

let cameraEnabled  = false;
let orbitTargetX   = 0.0;   // 注視点 X 座標（左右パン）
let orbitTargetY   = 1.3;   // 注視点 Y 座標（上下パン）
let orbitDistance  = 3.0;   // カメラ距離
let orbitRotX      = 0.0;   // 垂直回転（rad）上がプラス
let orbitRotY      = 0.0;   // 水平回転（rad）右がプラス

/** orbit params を camera.position / lookAt に反映する */
function applyOrbitCamera() {
  if (!camera) return;
  const cosX = Math.cos(orbitRotX);
  const sinX = Math.sin(orbitRotX);
  const sinY = Math.sin(orbitRotY);
  const cosY = Math.cos(orbitRotY);
  camera.position.set(
    orbitTargetX + orbitDistance * sinY * cosX,
    orbitTargetY + orbitDistance * sinX,
    orbitDistance * cosY * cosX,
  );
  camera.lookAt(orbitTargetX, orbitTargetY, 0);
}

/** カメラ操作の有効/無効を切り替える */
export function setCameraEnabled(v) {
  cameraEnabled = !!v;
  console.log('[VRM] カメラ操作:', cameraEnabled ? 'ON' : 'OFF');
}

/** 現在の orbit 状態を返す（プリセット保存用） */
export function getCameraOrbit() {
  return { targetX: orbitTargetX, targetY: orbitTargetY, distance: orbitDistance, rotX: orbitRotX, rotY: orbitRotY };
}

/**
 * orbit params をまとめてセットする（プリセット呼び出し用）。
 * @param {{ targetX?, targetY?, distance?, rotX?, rotY? }} params
 */
export function setCameraOrbit(params) {
  if (params.targetX  != null) orbitTargetX  = params.targetX;
  if (params.targetY  != null) orbitTargetY  = params.targetY;
  if (params.distance != null) orbitDistance = params.distance;
  if (params.rotX     != null) orbitRotX     = params.rotX;
  if (params.rotY     != null) orbitRotY     = params.rotY;
  applyOrbitCamera();
}

/**
 * マウスドラッグ量（ラジアン）からカメラ回転を更新する。
 * cameraEnabled が false のとき何もしない。
 */
export function updateCameraOrbit(dRotX, dRotY) {
  if (!cameraEnabled) return;
  const HALF_PI = Math.PI / 2;
  orbitRotX = Math.max(-HALF_PI + 0.01, Math.min(HALF_PI - 0.01, orbitRotX + dRotX));
  orbitRotY += dRotY;
  applyOrbitCamera();
}

/**
 * Shift+ホイール量からカメラズームを更新する。
 * delta > 0 で引く（遠ざかる）、delta < 0 で寄る。
 */
export function updateCameraZoom(delta) {
  if (!cameraEnabled) return;
  orbitDistance = Math.max(0.3, Math.min(20, orbitDistance + delta));
  applyOrbitCamera();
}

/**
 * 中クリックドラッグ量（px）から注視点を上下左右にパンする。
 * dy > 0（下ドラッグ）→ targetY を下げる / dx > 0（右ドラッグ）→ targetX を右に移動
 */
export function updateCameraTarget(dx, dy) {
  if (!cameraEnabled) return;
  const PAN_SENSITIVITY = 0.004;
  orbitTargetX = Math.max(-3, Math.min(3, orbitTargetX - dx * PAN_SENSITIVITY));
  orbitTargetY = Math.max(-2, Math.min(5, orbitTargetY + dy * PAN_SENSITIVITY));
  applyOrbitCamera();
}

function initScene(canvas, lightingCfg = {}) {
  currentLightingCfg = lightingCfg; // モデルロード時にMToon調整で参照する
  const W = window.innerWidth  || 400;
  const H = window.innerHeight || 600;
  const dpr = window.devicePixelRatio || 1;

  // バッファサイズ（実ピクセル）
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);

  // ── CSSサイズは固定px ──────────────────────────────────────
  // width:100% にするとドラッグ中の setPosition() IPC で
  // Chromium がレイアウト再計算して一瞬膨張するバグが起きる。
  // UIなしウィンドウなので固定pxで問題ない。
  canvas.style.cssText =
    `position:absolute; top:0; left:0; width:${W}px; height:${H}px; z-index:0;`;

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true, // readPixels でアルファ値を読むために必要
  });
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();

  // Phase 12-1: ライティング設定（config.json の lighting セクション）
  // lightingCfg が未指定の場合はデフォルト値にフォールバック
  const ambientIntensity = lightingCfg?.ambient?.intensity  ?? 0.6;
  const mainIntensity    = lightingCfg?.main?.intensity     ?? 1.2;
  const mainX            = lightingCfg?.main?.x             ?? 1.0;
  const mainY            = lightingCfg?.main?.y             ?? 2.0;
  const mainZ            = lightingCfg?.main?.z             ?? 1.0;
  const shadowEnabled    = lightingCfg?.shadow?.enabled     ?? false;
  const shadowBias       = lightingCfg?.shadow?.bias        ?? -0.001;

  ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity);
  scene.add(ambientLight);

  dirLight = new THREE.DirectionalLight(0xffffff, mainIntensity);
  dirLight.position.set(mainX, mainY, mainZ);
  if (shadowEnabled) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    dirLight.castShadow        = true;
    dirLight.shadow.bias       = shadowBias;
    dirLight.shadow.mapSize.set(1024, 1024);
  } else {
    renderer.shadowMap.enabled = false;
    dirLight.castShadow        = false;
  }
  scene.add(dirLight);
  console.log('[VRM] ライティング設定:', { ambientIntensity, mainIntensity, mainX, mainY, mainZ, shadowEnabled });

  camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 20);
  camera.position.set(0, 1.3, 3.0);
  camera.lookAt(0, 1.3, 0);
}

async function loadVRM(vrmPath) {
  const vrmUrl = getBaseUrl() + '/' + vrmPath;
  console.log('[VRM] Loading:', vrmUrl);
  let gltf;
  try { gltf = await loader.loadAsync(vrmUrl); }
  catch (e) { throw new Error(`VRM読み込み失敗: ${e.message}`); }
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('gltf.userData.vrm が undefined');
  if (vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm);
  return vrm;
}

function adjustCamera(vrm) {
  const box    = new THREE.Box3().setFromObject(vrm.scene);
  const size   = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // orbit 初期値をモデルのバウンディングボックスから計算して設定
  orbitTargetX  = center.x;
  orbitTargetY  = center.y + size.y * 0.1;
  orbitDistance = size.y * 1.8;
  orbitRotX     = 0.0;
  orbitRotY     = 0.0;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyOrbitCamera();
}

let animLoopStarted = false;
const clock = new THREE.Clock();

function startAnimLoop() {
  if (animLoopStarted) return;
  animLoopStarted = true;
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (currentVRM) {
      if (lipSyncExpressionName && currentVRM.expressionManager) {
        currentVRM.expressionManager.setValue(
          lipSyncExpressionName,
          getLipSyncValue(lipSyncSensitivity, lipSyncMaxMouthOpen)
        );
      }
      applyExpressionLayer(currentVRM); // Phase 12-2: 表情レイヤー（vrm.update前に確定）
      updateBlink(currentVRM, delta);
      updateGaze(currentVRM, delta);
      updateIdleMotion(delta);
      if (currentMixer) currentMixer.update(delta);  // VRMA進行
      currentVRM.update(delta);
      // Phase 12-1: vrm.update()がuniformを巻き戻すので直後に強制上書き
      if (mtoonShadingShiftOverride !== null && mtoonOverrideMaterials.length > 0) {
        for (const { mat, origShade } of mtoonOverrideMaterials) {
          mat.uniforms.shadingShiftFactor.value = mtoonShadingShiftOverride;
          // シェード色を暗くする（shadeDarken: 0.3 なら元の色を30%に）
          if (mtoonShadeDarken !== null && origShade && mat.uniforms.shadeColorFactor) {
            const c = mat.uniforms.shadeColorFactor.value;
            c.r = origShade.r * mtoonShadeDarken;
            c.g = origShade.g * mtoonShadeDarken;
            c.b = origShade.b * mtoonShadeDarken;
          }
        }
      }
    }
    renderer.render(scene, camera);
  }
  animate();
}

// ── ヒットテスト: 指定CSS座標のアルファ値をWebGLから読む ─────────
// canvas.getContext('2d') はWebGLキャンバスに使えないため
// WebGL の readPixels を使う（preserveDrawingBuffer:true が必須）
export function getAlphaAtPixel(clientX, clientY) {
  if (!renderer) return 0;
  const gl  = renderer.getContext();
  const dpr = window.devicePixelRatio || 1;
  const px  = Math.floor(clientX * dpr);
  const py  = Math.floor(renderer.domElement.height - clientY * dpr); // Y軸フリップ
  if (px < 0 || py < 0 ||
      px >= renderer.domElement.width ||
      py >= renderer.domElement.height) return 0;
  const buf = new Uint8Array(4);
  gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf[3]; // 0=透明 〜 255=不透明
}

// ── 公開API ───────────────────────────────────────────────────

/**
 * シーン・レンダラー・カメラの初期化のみ行う。VRMモデルはロードしない。
 * 起動時の「空の画面」状態を作るために使う。
 */
export function initSceneOnly(canvasId, lightingCfg = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) throw new Error(`canvas#${canvasId} が見つかりません`);
  initScene(canvas, lightingCfg);
  startAnimLoop();   // currentVRM が null のまま空の透過背景をレンダリング開始
  console.log('[VRM] シーン初期化完了（モデルなし）');
}

export async function initVRM(canvasId, vrmPath, lipsyncConfig = {}, blinkConfig = {}, gazeConfig = {}, idleMotionConfig = {}, restPoseConfig = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) throw new Error(`canvas#${canvasId} が見つかりません`);
  initScene(canvas);
  const vrm = await loadVRM(vrmPath || 'assets/model.vrm');
  scene.add(vrm.scene);
  currentVRM = vrm;
  applyMtoonSettings(vrm, currentLightingCfg?.mtoon ?? {});
  lipSyncExpressionName = resolveLipSyncExpression(vrm);
  lipSyncSensitivity    = lipsyncConfig.sensitivity  ?? 1.0;
  lipSyncMaxMouthOpen   = lipsyncConfig.maxMouthOpen ?? 1.0;
  blinkExpr = resolveBlinkExpression(vrm);
  setBlinkConfig(blinkConfig);
  setGazeConfig(gazeConfig);
  applyRestPose(vrm, restPoseConfig);
  setIdleMotionConfig(vrm, idleMotionConfig);
  console.log('[VRM] 口パクExpression:', lipSyncExpressionName,
    '| sensitivity:', lipSyncSensitivity, '| maxMouthOpen:', lipSyncMaxMouthOpen);
  adjustCamera(vrm);
  startAnimLoop();
}

/**
 * Phase 13-4: 口パク設定をリアルタイムで更新する。
 * switchVRM を呼ばずに即時反映させたいとき（UI調整中など）に使う。
 */
export function setLipsync(sensitivity, maxMouthOpen) {
  lipSyncSensitivity  = sensitivity;
  lipSyncMaxMouthOpen = maxMouthOpen;
  console.log('[VRM] setLipsync → sensitivity:', sensitivity, '| maxMouthOpen:', maxMouthOpen);
}

/**
 * Phase 13-5: ライティングをリアルタイムで更新する。
 * { mainX, mainIntensity, ambientIntensity, shadingShiftFactor } を受け取り即時反映。
 */
export function setLighting({ mainX, mainIntensity, ambientIntensity, shadingShiftFactor }) {
  if (ambientLight && ambientIntensity != null) {
    ambientLight.intensity = ambientIntensity;
  }
  if (dirLight) {
    if (mainIntensity != null) dirLight.intensity = mainIntensity;
    if (mainX        != null) dirLight.position.setX(mainX);
  }
  if (shadingShiftFactor != null) {
    mtoonShadingShiftOverride = shadingShiftFactor;
  }
  console.log('[VRM] setLighting →', { mainX, mainIntensity, ambientIntensity, shadingShiftFactor });
}

export async function switchVRM(vrmPath, lipsyncConfig = {}, blinkConfig = {}, gazeConfig = {}, idleMotionConfig = {}, restPoseConfig = {}) {
  console.log('[VRM] モデル切り替え:', vrmPath);
  // VRMA再生中なら停止
  if (currentMixer) {
    currentMixer.stopAllAction();
    currentMixer = null;
    currentClipAction = null;
    isPlayingVRMA = false;
  }
  if (currentVRM) {
    scene.remove(currentVRM.scene);
    VRMUtils.deepDispose(currentVRM.scene);
    currentVRM = null;
    lipSyncExpressionName = null;
    blinkExpr = null;
    // Phase 12-1: マテリアルキャッシュをクリア
    mtoonOverrideMaterials = [];
    mtoonShadingShiftOverride = null;
    // Phase 12-2: 表情レイヤーをリセット
    currentExpressionKey = null;
  }
  const vrm = await loadVRM(vrmPath);
  scene.add(vrm.scene);
  currentVRM = vrm;
  applyMtoonSettings(vrm, currentLightingCfg?.mtoon ?? {});
  lipSyncExpressionName = resolveLipSyncExpression(vrm);
  lipSyncSensitivity    = lipsyncConfig.sensitivity  ?? 1.0;
  lipSyncMaxMouthOpen   = lipsyncConfig.maxMouthOpen ?? 1.0;
  blinkExpr = resolveBlinkExpression(vrm);
  setBlinkConfig(blinkConfig);
  setGazeConfig(gazeConfig);
  applyRestPose(vrm, restPoseConfig);
  setIdleMotionConfig(vrm, idleMotionConfig);
  console.log('[VRM] 切り替え完了 口パクExpression:', lipSyncExpressionName,
    '| sensitivity:', lipSyncSensitivity, '| maxMouthOpen:', lipSyncMaxMouthOpen);
  adjustCamera(vrm);
}
