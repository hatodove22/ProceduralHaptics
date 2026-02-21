# ProceduralHaptics.js

Webブラウザ上で、HDハプティクス（DualSenseや広帯域VCA）向けの複雑な触覚テクスチャをリアルタイムに生成・合成する軽量なJavaScriptライブラリです。

## 特徴
- **Procedural DSP**: フラクタル・ブラウン運動(fBm)やウェーブフォールディングを用いた数式ベースの触覚波形生成。
- **Interactive**: 移動速度や加速度に応じて動的に摩擦感や衝突（インパルス）を表現。
- **AI Integration**: Gemini APIを用いた「Prompt-to-Haptics」。自然言語（例：「氷の上を滑る」）から最適な触覚パラメータを自動生成。

## 使い方 (Usage)

ESモジュールとしてインポートし、Web Audio APIコンテキスト内で実行します。

```javascript
import { HapticEngine, HapticAI } from './src/ProceduralHaptics.js';

const haptics = new HapticEngine();
await haptics.init();
await haptics.togglePlay();

// パラメータの手動設定
haptics.setParams({
    granularity: 0.8, // ツブツブ感
    roughness: 0.5,   // ザラザラ感
    state: 0.0,       // 液体〜固体
    hardness: 0.2,    // 硬さ
    weight: 0.5,      // 重さ（周波数）
    viscosity: 0.0    // ネバネバ感
});

// マウス等の移動速度を渡して摩擦を表現
haptics.setVelocity(3.5);

// 衝突の発生 (0.0 ~ 1.0)
haptics.triggerCollision(0.8);
```

### AIからのパラメータ生成
```javascript
const ai = new HapticAI('YOUR_GEMINI_API_KEY');
const params = await ai.generateParams("泥沼のようなネバネバ感");
haptics.setParams(params);
```

## デモ (Example)
ローカルでテストする場合は、ローカルサーバーを立ち上げて `example/index.html` にアクセスしてください。
```bash
npx serve .
```
