# 実装依頼 Phase 12：環境・仕上げ

## 前提

- 作業ディレクトリ: `D:\Projects\VRMmascot\`
- 要件定義書: `D:\Projects\VRMmascot\要件定義書.md`
- 仕様書: `D:\Projects\VRMmascot\仕様書.md`

**進め方の厳守事項：**
- タスクは必ず1つずつ実装すること
- 1つのタスクが完了したら動作確認できる状態で止まること
- 私がコミットして「次へ」と伝えるまで次のタスクに進まないこと
- 各タスク完了時に「何を変更したか」「どう確認するか」を簡潔に報告すること

---

## タスク一覧

| # | タスク | 内容 |
|---|--------|------|
| 1 | 12-1 | ライティング＆影セット調整 |
| 2 | 12-2 | 表情BlendShape（テンキー割り当て） |

---

## タスク1：12-1 ライティング＆影セット調整

### 運用方針
**config.jsonを直接編集して再起動する運用。設定UIにスライダー等は設けない。**
アプリ起動時にconfig.jsonのlightingセクションを読み込んでThree.jsのライトに反映する。

### 要件

| # | 要件 | 詳細 |
|---|------|------|
| F12-1-1 | アンビエントライト強度 | config.jsonのambient.intensityをAmbientLightに反映。値が低いほど影が濃くなる |
| F12-1-2 | メインライト強度・方向 | intensity・x/y/zをDirectionalLightに反映 |
| F12-1-3 | 影のオン/オフ | shadow.enabledでDirectionalLightのcastShadowを切り替え |
| F12-1-4 | shadowBias | shadow.biasでセルフシャドウのちらつき（アクネ）を抑制 |

### config.jsonの構造

```json
"lighting": {
  "ambient": { "intensity": 0.4 },
  "main": { "intensity": 1.2, "x": 1.0, "y": 2.0, "z": 1.0 },
  "shadow": { "enabled": true, "bias": -0.001 }
}
```

### 完了条件
- アプリ起動時にconfig.jsonのlighting設定がThree.jsのライトに反映されている
- config.jsonを編集して再起動すると変化が確認できる
- lightingキーがconfig.jsonに存在しない場合はデフォルト値にフォールバックする

### 完了したら
変更したファイルと変更箇所を報告して止まること。

---

## タスク2：12-2 表情BlendShape（テンキー割り当て）

### 概要
テンキー0〜5をElectronのグローバルショートカットとして登録し、VRM標準表情を切り替える。
OBSやブラウザを操作中（他のウィンドウにフォーカスがある状態）でも有効であること。

### テンキーマッピング

| キー | 表情 |
|------|------|
| Numpad0 | neutral（リセット） |
| Numpad1 | fun |
| Numpad2 | sorrow |
| Numpad3 | surprised |
| Numpad4 | angry |
| Numpad5 | joy |

### 要件

| # | 要件 | 詳細 |
|---|------|------|
| F12-2-1 | グローバルショートカット | ElectronのglobalShortcutでテンキー0〜5を登録する |
| F12-2-2 | 表情の適用 | 押したキーに対応するVRM標準表情のBlendShapeを1.0にセット。それ以外は0にリセット |
| F12-2-3 | 独立動作 | 瞬き・視線・口パクのBlendShapeとは別レイヤーで管理。上書きしないこと |
| F12-2-4 | config対応 | テンキーと表情名のマッピングはconfig.jsonで変更可能にする |
| F12-2-5 | フォールバック | VRMモデルが対応していない表情名を指定した場合はコンソールに警告を出すだけ（エラーにしない） |

### config.jsonの構造

```json
"expressionKeys": {
  "Numpad0": "neutral",
  "Numpad1": "fun",
  "Numpad2": "sorrow",
  "Numpad3": "surprised",
  "Numpad4": "angry",
  "Numpad5": "joy"
}
```

### BlendShapeレイヤーの考え方
既存のBlendShapeレイヤーとの優先順位：

| レイヤー | 担当 |
|---------|------|
| 表情レイヤー | Numpad切り替え（本タスク） |
| 瞬きレイヤー | blink BlendShape（既存） |
| 口パクレイヤー | aa/ih/ou/ee/oh（既存） |
| 視線レイヤー | lookAt（既存） |

表情レイヤーは neutral / fun / sorrow / surprised / angry / joy の切り替えのみ担当し、
瞬き・口パク・視線レイヤーには干渉しないこと。

### 完了条件
- 他のアプリを操作中にテンキーを押すとVRMの表情が切り替わる
- Numpad0を押すとneutralに戻る
- 表情が切り替わっても瞬き・口パク・視線は正常に動作し続ける
- config.jsonのexpressionKeysを編集して再起動すると割り当てが変わる

### 完了したら
変更したファイルと変更箇所を報告して止まること。
