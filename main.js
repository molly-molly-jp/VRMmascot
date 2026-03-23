const { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');

// AudioContext をユーザージェスチャーなしで再開できるようにする
// Ctrl+Q のようなグローバルショートカット経由では UI 操作がないため必要
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let vrmWin;
let ctrlWin;

// Phase 8: 状態管理
let currentGroupId     = null;   // 現在選択中グループID（ctrl-switch-group で更新）
let domReceiveEnabled  = true;   // DOM受信の有効/無効フラグ
let localServer        = null;   // port:3000 HTTPサーバー
// Phase 14: ストリーミングTTSモード（config.jsonから初期化、UIから変更可能）
let streamingTTSEnabled = true;  // デフォルトtrue。chrome拡張がGET /streaming-tts で取得

function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log('[main] config読み込み成功 groups:', config.groups?.length);
    return config;
  } catch (e) {
    console.error('[main] config.json読み込み失敗:', e.message);
    return { shortcutKey: 'Ctrl+Shift+R', groups: [] };
  }
}

function saveConfig(config) {
  try {
    const configPath = path.join(__dirname, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[main] config.json 保存完了');
    return true;
  } catch (e) {
    console.error('[main] config.json 保存失敗:', e.message);
    return false;
  }
}

/**
 * modelPath に対応するモデル設定を config から探して返す。
 * 未登録の場合はデフォルト設定を生成して config.json に追記し、そのオブジェクトを返す。
 * @returns {object} モデル設定オブジェクト
 */
function ensureModelInConfig(config, modelPath) {
  // 全グループからモデルを探す
  for (const group of config.groups ?? []) {
    const found = (group.models ?? []).find(m => m.path === modelPath);
    if (found) return found; // 既登録
  }

  // 未登録: パスから groupId を推定 (assets/groupA/... → A)
  const groupMatch = modelPath.match(/assets\/group([^/]+)\//i);
  const groupId    = groupMatch ? groupMatch[1].toUpperCase() : null;
  const group      = config.groups?.find(g => g.id === groupId);
  if (!group) {
    console.warn('[main] ensureModelInConfig: グループ未発見 path:', modelPath);
    return {}; // デフォルト空オブジェクト
  }

  const label = path.basename(modelPath, '.vrm');
  const defaultEntry = {
    label,
    path: modelPath,
    lipsync:  { sensitivity: 1.0, maxMouthOpen: 1.0 },
    gaze:     { angleX: 0.08, angleY: 0.05 },
    restPose: {
      enabled: true,
      bones: [
        { name: 'leftUpperArm',  z:  1.3 },
        { name: 'rightUpperArm', z: -1.3 }
      ]
    },
    entrance: {
      patternA: {
        motion: '',
        sound:  '',
        soundDelayMs: 0
      },
      patternB: {
        motion: '',
        sound:  '',
        soundDelayMs: 0
      }
    }
  };

  group.models = group.models ?? [];
  group.models.push(defaultEntry);
  saveConfig(config);
  console.log(`[main] 新モデルをconfig.jsonに追記: ${modelPath}`);
  console.log('[main] ※ lipsync・gaze・restPoseはデフォルト値です。config.jsonを編集して調整してください。');
  return defaultEntry;
}

function createVRMWindow() {
  vrmWin = new BrowserWindow({
    width: 400,
    height: 600,
    resizable: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  vrmWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Phase 12-1 デバッグ用: 起動時にDevToolsを自動で開く（確認後は削除してOK）
  vrmWin.webContents.once('did-finish-load', () => {
    vrmWin.webContents.openDevTools({ mode: 'detach' });
  });
  vrmWin.webContents.on('will-navigate', (e) => e.preventDefault());
  vrmWin.webContents.on('will-redirect',  (e) => e.preventDefault());

  let dragStart    = null;
  let lastMoveTime = 0;
  ipcMain.on('drag-start', () => {
    dragStart = { cursor: screen.getCursorScreenPoint(), win: vrmWin.getPosition() };
  });
  ipcMain.on('drag-move', () => {
    if (!dragStart) return;
    const now = Date.now();
    if (now - lastMoveTime < 16) return;
    lastMoveTime = now;
    const cur = screen.getCursorScreenPoint();
    vrmWin.setPosition(
      dragStart.win[0] + (cur.x - dragStart.cursor.x),
      dragStart.win[1] + (cur.y - dragStart.cursor.y)
    );
  });
  ipcMain.on('drag-end',     () => { dragStart = null; });
  ipcMain.on('window-close', () => vrmWin.close());

  ipcMain.on('set-ignore-mouse-events', (_, ignore) => {
    if (!vrmWin || vrmWin.isDestroyed()) return;
    vrmWin.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.on('vrm-status', (_, text) => {
    if (ctrlWin && !ctrlWin.isDestroyed())
      ctrlWin.webContents.send('status-update', text);
  });
}

function createControlWindow() {
  const displays = screen.getAllDisplays();
  const target   = displays.length > 1 ? displays[1] : displays[0];

  ctrlWin = new BrowserWindow({
    width:  560,
    height: 520,
    x: target.bounds.x + 20,
    y: target.bounds.y + 20,
    resizable: true,
    alwaysOnTop: false,
    title: 'VRM Mascot — コントロール',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  ctrlWin.loadFile(path.join(__dirname, 'renderer', 'control.html'));
  ctrlWin.on('close', (e) => { e.preventDefault(); ctrlWin.hide(); });
}

function setupIPC(config) {
  if (!ipcMain.listenerCount('get-config-handled')) {
    ipcMain.handle('get-config', () => {
      console.log('[main] get-config 呼ばれた groups:', config.groups?.length);
      return config;
    });
  }

  ipcMain.on('ctrl-switch-group', (_, id) => {
    currentGroupId = id;
    console.log('[main] グループ切り替え:', id);
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('do-switch-group', id);
  });
  ipcMain.on('ctrl-switch-model', (_, p) => {
    const modelConf = ensureModelInConfig(config, p);
    if (vrmWin && !vrmWin.isDestroyed())
      vrmWin.webContents.send('do-switch-model', { path: p, modelConf });
  });
  ipcMain.on('ctrl-send-text', (_, t) => {
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('do-send-text', t);
  });
  ipcMain.on('ctrl-clear-queue', () => {
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('do-clear-queue');
  });

  ipcMain.handle('ctrl-toggle-always-on-top', () => {
    if (!ctrlWin || ctrlWin.isDestroyed()) return false;
    const next = !ctrlWin.isAlwaysOnTop();
    ctrlWin.setAlwaysOnTop(next);
    return next;
  });

  // ── Phase 8: DOM受信トグル ─────────────────────────────────
  ipcMain.handle('ctrl-toggle-dom-receive', () => {
    domReceiveEnabled = !domReceiveEnabled;
    console.log('[main] DOM受信:', domReceiveEnabled ? '有効' : '無効');
    return domReceiveEnabled;
  });

  ipcMain.handle('get-dom-receive-state', () => domReceiveEnabled);

  // ── Phase 10: フォルダスキャン ────────────────────────────────
  ipcMain.handle('scan-vrm-files', (_, groupId) => {
    const folderName = 'group' + groupId;
    const folderPath = path.join(__dirname, 'assets', folderName);
    if (!fs.existsSync(folderPath)) return [];
    return fs.readdirSync(folderPath)
      .filter(f => f.toLowerCase().endsWith('.vrm'))
      .sort()
      .map(f => ({
        label: f.replace(/\.vrm$/i, ''),
        path:  `assets/${folderName}/${f}`
      }));
  });

  ipcMain.handle('scan-vrma-files', () => {
    const folderPath = path.join(__dirname, 'assets', 'motions');
    if (!fs.existsSync(folderPath)) return [];
    return fs.readdirSync(folderPath)
      .filter(f => f.toLowerCase().endsWith('.vrma'))
      .sort()
      .map(f => ({
        label: f.replace(/\.vrma$/i, ''),
        path:  `assets/motions/${f}`
      }));
  });

  // モーション再生コマンドをVRMウィンドウへ中継
  ipcMain.on('ctrl-play-motion', (_, motionPath) => {
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('do-play-motion', motionPath);
  });

  // ── Phase 11: カメラ操作ON/OFFトグル ─────────────────────────
  let cameraOn = false;
  ipcMain.handle('ctrl-toggle-camera', () => {
    cameraOn = !cameraOn;
    console.log('[main] カメラ操作:', cameraOn ? 'ON' : 'OFF');
    if (vrmWin && !vrmWin.isDestroyed())
      vrmWin.webContents.send('do-camera-toggle', cameraOn);
    return cameraOn;
  });

  // ── Phase 11-2: プリセット保存 ───────────────────────────────
  // VRMウィンドウの window._getCameraOrbit() を executeJavaScript で取得して保存
  ipcMain.handle('ctrl-save-preset', async (_, index) => {
    if (!vrmWin || vrmWin.isDestroyed()) return { ok: false };
    let orbit;
    try {
      orbit = await vrmWin.webContents.executeJavaScript('window._getCameraOrbit()');
    } catch (e) {
      console.error('[main] getCameraOrbit失敗:', e.message);
      return { ok: false };
    }
    const preset = config.camera.presets[index];
    if (!preset) return { ok: false };
    preset.targetX  = orbit.targetX;
    preset.targetY  = orbit.targetY;
    preset.distance = orbit.distance;
    preset.rotX     = orbit.rotX;
    preset.rotY     = orbit.rotY;
    // ── Phase 13-3: VRMウィンドウのスクリーン座標も保存 ────────
    const [winX, winY] = vrmWin.getPosition();
    preset.windowX = winX;
    preset.windowY = winY;
    saveConfig(config);
    console.log(`[main] プリセット${index + 1} 保存:`, orbit, `window:(${winX},${winY})`);
    return { ok: true, orbit };
  });

  // ── Phase 11-2 / 13-3: プリセット呼び出し ───────────────────
  ipcMain.on('ctrl-load-preset', (_, index) => {
    const preset = config.camera?.presets?.[index];
    if (!preset) return console.warn('[main] プリセット未設定:', index);
    // カメラパラメータをVRMウィンドウへ送信
    if (vrmWin && !vrmWin.isDestroyed())
      vrmWin.webContents.send('do-set-camera-orbit', preset);
    // ── Phase 13-3: windowX/Y があればウィンドウ位置を復元 ────
    if (preset.windowX != null && preset.windowY != null) {
      vrmWin.setPosition(preset.windowX, preset.windowY);
      console.log(`[main] プリセット${index + 1} 呼び出し: camera+window(${preset.windowX},${preset.windowY})`);
    } else {
      console.log(`[main] プリセット${index + 1} 呼び出し: cameraのみ（windowX/Y未設定）`);
    }
  });

  // ── Phase 11-2: カメラリセット ──────────────────────────────
  ipcMain.on('ctrl-reset-camera', () => {
    const def = config.camera?.default;
    if (!def) return console.warn('[main] camera.defaultが未設定');
    console.log('[main] カメラリセット:', def);
    if (vrmWin && !vrmWin.isDestroyed())
      vrmWin.webContents.send('do-set-camera-orbit', def);
  });

  // ── Phase 10-3: 登場演出A ────────────────────────────────────
  // modelPath を受け取り、modelConf（entrance.patternA含む）を付けてVRMウィンドウへ転送
  ipcMain.on('ctrl-entrance-a', (_, modelPath) => {
    const modelConf = ensureModelInConfig(config, modelPath);
    if (vrmWin && !vrmWin.isDestroyed())
      vrmWin.webContents.send('do-entrance-a', { path: modelPath, modelConf });
  });

  // ── Phase 10-3: 登場演出B ────────────────────────────────────
  ipcMain.on('ctrl-entrance-b', (_, modelPath) => {
    const modelConf = ensureModelInConfig(config, modelPath);
    if (vrmWin && !vrmWin.isDestroyed())
      vrmWin.webContents.send('do-entrance-b', { path: modelPath, modelConf });
  });

  // ── Phase 10-3: 登場演出C（ペアフォルダ方式） ─────────────────
  // entrance_c/ フォルダ内の .vrma と同名の音声ファイルをペアとして扱いランダム抽選
  ipcMain.on('ctrl-entrance-c', (_, modelPath) => {
    const modelConf = ensureModelInConfig(config, modelPath);

    const entranceCDir = path.join(__dirname, 'assets', 'motions', 'entrance_c');
    const soundExts    = ['.wav', '.mp3'];

    if (!fs.existsSync(entranceCDir)) {
      console.warn('[main] 登場演出C: フォルダが存在しません:', entranceCDir);
      return;
    }

    // .vrma ファイルを全件取得してペアリスト構築
    const vrmaFiles = fs.readdirSync(entranceCDir)
      .filter(f => f.toLowerCase().endsWith('.vrma'));

    if (vrmaFiles.length === 0) {
      console.warn('[main] 登場演出C: VRMAファイルが見つかりません:', entranceCDir);
      return;
    }

    // ペアリスト: { motion, sound|null }
    const pairs = vrmaFiles.map(vrmaFile => {
      const baseName = vrmaFile.replace(/\.vrma$/i, '');
      const foundSound = soundExts
        .map(ext => baseName + ext)
        .find(sf => fs.existsSync(path.join(entranceCDir, sf)));
      return {
        motion: `assets/motions/entrance_c/${vrmaFile}`,
        sound:  foundSound ? `assets/motions/entrance_c/${foundSound}` : null,
      };
    });

    // ランダム抽選
    const chosen = pairs[Math.floor(Math.random() * pairs.length)];
    console.log(`[main] 登場演出C: motion=${chosen.motion} sound=${chosen.sound ?? 'なし'}`);

    if (vrmWin && !vrmWin.isDestroyed())
      vrmWin.webContents.send('do-entrance-c', {
        path: modelPath,
        modelConf,
        randomMotion: chosen.motion,
        randomSound:  chosen.sound,
      });
  });

  // ── Phase 13-6: 未使用モデル設定クリーンアップ ──────────────
  // ファイルが存在しないモデルの一覧を返す
  ipcMain.handle('ctrl-check-unused-models', () => {
    const unused = [];
    for (const group of config.groups ?? []) {
      for (const model of group.models ?? []) {
        const absPath = path.join(__dirname, model.path);
        if (!fs.existsSync(absPath)) {
          unused.push({ groupId: group.id, label: model.label, path: model.path });
        }
      }
    }
    console.log('[main] 未使用モデル検出:', unused.length, '件');
    return unused;
  });

  // 指定パスのモデル設定を config.json から削除する
  ipcMain.handle('ctrl-delete-unused-models', (_, paths) => {
    let deleted = 0;
    for (const group of config.groups ?? []) {
      const before = (group.models ?? []).length;
      group.models  = (group.models ?? []).filter(m => !paths.includes(m.path));
      deleted      += before - group.models.length;
    }
    saveConfig(config);
    console.log('[main] 未使用モデル削除完了:', deleted, '件');
    return { ok: true, deleted };
  });

  // ── Phase 13-5: ライティング 即時更新（VRMウィンドウへ転送）─
  ipcMain.handle('ctrl-update-lighting', (_, modelPath, params) => {
    if (vrmWin && !vrmWin.isDestroyed())
      vrmWin.webContents.send('do-set-lighting', params);
    console.log('[main] lighting更新(メモリ):', params);
    return { ok: true };
  });

  // ── Phase 13-5: ライティング 保存（config.json書き込み）─────
  ipcMain.handle('ctrl-save-lighting', (_, modelPath, params) => {
    const modelConf = ensureModelInConfig(config, modelPath);
    // ensureModelInConfig がモデルを見つけられなかった場合は空オブジェクトが返る
    if (!modelConf || !modelConf.path) {
      console.error('[main] ctrl-save-lighting: モデルが config に見つかりません:', modelPath);
      return { ok: false, reason: 'model_not_found' };
    }
    if (!modelConf.lighting)         modelConf.lighting         = {};
    if (!modelConf.lighting.ambient) modelConf.lighting.ambient  = {};
    if (!modelConf.lighting.main)    modelConf.lighting.main     = {};
    if (!modelConf.lighting.mtoon)   modelConf.lighting.mtoon    = {};
    if (params.ambientIntensity  != null) modelConf.lighting.ambient.intensity      = params.ambientIntensity;
    if (params.mainIntensity     != null) modelConf.lighting.main.intensity         = params.mainIntensity;
    if (params.mainX             != null) modelConf.lighting.main.x                 = params.mainX;
    if (params.shadingShiftFactor != null) modelConf.lighting.mtoon.shadingShiftFactor = params.shadingShiftFactor;
    console.log('[main] lighting保存対象モデル:', modelConf.path, '| lighting:', JSON.stringify(modelConf.lighting));
    const saved = saveConfig(config);
    return { ok: saved };
  });

  // ── Phase 13-5: モデルの有効ライティング設定を返す ──────────
  // モデル個別設定があればそちらを優先、なければグローバルをフォールバック
  ipcMain.handle('ctrl-get-lighting', (_, modelPath) => {
    const globalL = config.lighting ?? {};
    const modelConf = (config.groups ?? [])
      .flatMap(g => g.models ?? [])
      .find(m => m.path === modelPath);
    const modelL = modelConf?.lighting ?? {};
    return {
      ambientIntensity:   modelL.ambient?.intensity   ?? globalL.ambient?.intensity   ?? 0.5,
      mainIntensity:      modelL.main?.intensity       ?? globalL.main?.intensity       ?? 1.0,
      mainX:              modelL.main?.x               ?? globalL.main?.x               ?? 3.0,
      shadingShiftFactor: modelL.mtoon?.shadingShiftFactor ?? globalL.mtoon?.shadingShiftFactor ?? -0.2,
    };
  });

  // ── Phase 13-4: 口パク設定 即時更新（VRMウィンドウへ転送）──
  ipcMain.handle('ctrl-update-lipsync', (_, modelPath, sensitivity, maxMouthOpen) => {
    if (vrmWin && !vrmWin.isDestroyed())
      vrmWin.webContents.send('do-set-lipsync', { sensitivity, maxMouthOpen });
    console.log(`[main] lipsync更新(メモリ) sensitivity:${sensitivity} maxMouthOpen:${maxMouthOpen}`);
    return { ok: true };
  });

  // ── Phase 13-4: 口パク設定 保存（config.json書き込み）───────
  ipcMain.handle('ctrl-save-lipsync', (_, modelPath, sensitivity, maxMouthOpen) => {
    const modelConf = ensureModelInConfig(config, modelPath);
    if (!modelConf.lipsync) modelConf.lipsync = {};
    modelConf.lipsync.sensitivity  = sensitivity;
    modelConf.lipsync.maxMouthOpen = maxMouthOpen;
    saveConfig(config);
    console.log(`[main] lipsync保存(config.json) sensitivity:${sensitivity} maxMouthOpen:${maxMouthOpen}`);
    return { ok: true };
  });

  // ── Phase 13-2: soundDelayMs 即時更新（メモリのみ）─────────
  ipcMain.handle('ctrl-update-sound-delay', (_, modelPath, pattern, value) => {
    const modelConf = ensureModelInConfig(config, modelPath);
    if (!modelConf.entrance) modelConf.entrance = {};
    if (!modelConf.entrance[pattern]) modelConf.entrance[pattern] = {};
    modelConf.entrance[pattern].soundDelayMs = value;
    console.log(`[main] soundDelayMs更新(メモリ) ${pattern}: ${value}ms`);
    return { ok: true };
  });

  // ── Phase 13-2: soundDelayMs 保存（config.json書き込み）─────
  ipcMain.handle('ctrl-save-sound-delay', (_, modelPath, pattern, value) => {
    const modelConf = ensureModelInConfig(config, modelPath);
    if (!modelConf.entrance) modelConf.entrance = {};
    if (!modelConf.entrance[pattern]) modelConf.entrance[pattern] = {};
    modelConf.entrance[pattern].soundDelayMs = value;
    saveConfig(config);
    console.log(`[main] soundDelayMs保存(config.json) ${pattern}: ${value}ms`);
    return { ok: true };
  });

  // ── Phase 14: streamingTTS トグル ────────────────────────
  ipcMain.handle('ctrl-get-streaming-tts', () => streamingTTSEnabled);
  ipcMain.handle('ctrl-set-streaming-tts', (_, enabled) => {
    streamingTTSEnabled = !!enabled;
    // config.json に永続化
    config.streamingTTS = streamingTTSEnabled;
    saveConfig(config);
    console.log('[main] streamingTTS変更:', streamingTTSEnabled);
    return streamingTTSEnabled;
  });
}

function setupShortcut(config) {
  const key = config.shortcutKey || 'Ctrl+Shift+R';
  const ok  = globalShortcut.register(key, () => {
    const text = clipboard.readText().trim();
    if (!text) return;
    if (vrmWin && !vrmWin.isDestroyed()) vrmWin.webContents.send('speak-queue', text);
  });
  console.log(ok ? `[main] ショートカット登録: ${key}` : `[main] ショートカット登録失敗: ${key}`);

  // Phase 12-2: 表情切り替えグローバルショートカット
  const exprKeys = config.expressionKeys ?? {
    'num0': 'neutral',
    'num1': 'fun',
    'num2': 'sorrow',
    'num3': 'surprised',
    'num4': 'angry',
    'num5': 'joy',
  };
  for (const [accelerator, expressionName] of Object.entries(exprKeys)) {
    const registered = globalShortcut.register(accelerator, () => {
      console.log(`[main] 表情キー: ${accelerator} → ${expressionName}`);
      if (vrmWin && !vrmWin.isDestroyed())
        vrmWin.webContents.send('do-set-expression', expressionName);
    });
    if (!registered) console.warn(`[main] 表情ショートカット登録失敗: ${accelerator}`);
  }
  console.log('[main] 表情ショートカット登録完了:', Object.keys(exprKeys).join(', '));
}

// ── Phase 8: ローカルHTTPサーバー (port:3000) ─────────────────
function startLocalServer(config) {
  // 現在のグループが clipboard ソースかどうかを判定するヘルパー
  function isClipboardGroup() {
    if (!currentGroupId) return false;
    const g = config.groups.find(g => g.id === currentGroupId);
    return g?.lipSyncSource === 'clipboard';
  }

  localServer = http.createServer((req, res) => {
    // CORS（Chrome拡張からのfetchに必要）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Phase 14: Chrome拡張がstreamingTTSモードを取得するエンドポイント ──
    if (req.method === 'GET' && req.url === '/streaming-tts') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: streamingTTSEnabled }));
      return;
    }

    if (req.method === 'POST' && req.url === '/speak') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { text } = JSON.parse(body);
          if (!text || typeof text !== 'string') throw new Error('text が空');

          if (!domReceiveEnabled) {
            console.log('[server] DOM受信無効のためスキップ');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: 'disabled' }));
            return;
          }

          if (!isClipboardGroup()) {
            console.log('[server] グループAのためスキップ (currentGroup:', currentGroupId, ')');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: 'wrong group' }));
            return;
          }

          console.log('[server] Grok DOM受信 →キューへ:', text.slice(0, 60));
          if (vrmWin && !vrmWin.isDestroyed()) {
            vrmWin.webContents.send('speak-queue', text.trim());
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error('[server] POSTパースエラー:', err.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  localServer.listen(3000, '127.0.0.1', () => {
    console.log('[main] ローカルサーバー起動: http://127.0.0.1:3000');
  });
  localServer.on('error', (err) => {
    console.error('[main] サーバー起動失敗:', err.message);
  });
}

app.whenReady().then(() => {
  const config = loadConfig();

  // 初期グループを設定
  currentGroupId = config.groups?.[0]?.id ?? null;
  console.log('[main] 初期グループ:', currentGroupId);

  // Phase 14: streamingTTS 初期値を config.json から読み込む
  if (config.streamingTTS != null) {
    streamingTTSEnabled = !!config.streamingTTS;
  }
  console.log('[main] streamingTTS:', streamingTTSEnabled);

  setupIPC(config);
  setupShortcut(config);
  startLocalServer(config);

  createVRMWindow();
  createControlWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createVRMWindow();
      createControlWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (localServer) localServer.close();
  if (process.platform !== 'darwin') app.quit();
});
