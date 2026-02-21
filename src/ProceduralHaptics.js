/**
 * ProceduralHaptics.js
 * A Web-based HD Haptics Engine for DualSense and advanced linear actuators.
 */

function hash(n) { return (Math.sin(n) * 43758.5453123) % 1; }
function noise(x) {
    const p = Math.floor(x);
    const f = x - p;
    const u = f * f * (3.0 - 2.0 * f);
    return (hash(p) * (1.0 - u) + hash(p + 1.0) * u) * 2.0 - 1.0;
}

export class HapticEngine {
    constructor() {
        this.audioCtx = null;
        this.scriptNode = null;
        this.masterGain = null;
        this.isPlaying = false;
        this.phase = 0;
        this.smoothedVelocity = 0;
        this.impulseEnvelope = 0;
        this.impulsePhase = 0;

        this.params = {
            granularity: 0.0, roughness: 0.2, state: 0.0,
            hardness: 0.0, weight: 0.5, viscosity: 0.0
        };
    }

    async init() {
        if (this.audioCtx) return;
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.value = 0;

        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 2048;

        this.scriptNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
        this.scriptNode.onaudioprocess = (e) => this._processAudio(e);

        // --- ここからDualSense用 4chルーティング処理 ---

        // 1. 出力先を強制的に4チャンネルにする
        this.audioCtx.destination.channelCount = 4;
        this.audioCtx.destination.channelCountMode = 'explicit';

        // 2. チャンネルマージャー（振り分け器）を作成 (4ch対応)
        const merger = this.audioCtx.createChannelMerger(4);

        // 3. 生成した触覚信号(masterGain)を、mergerの 3ch(インデックス2) と 4ch(インデックス3) に繋ぐ
        // ※ 0:Left, 1:Right, 2:Left Actuator, 3:Right Actuator
        this.masterGain.connect(merger, 0, 2);
        this.masterGain.connect(merger, 0, 3);

        // 4. mergerを最終出力に繋ぐ
        merger.connect(this.audioCtx.destination);
        this.scriptNode.connect(this.masterGain);

        // アナライザー（波形表示用）にも繋ぐ
        this.masterGain.connect(this.analyser);
        // ----------------------------------------------
    }

    async togglePlay() {
        if (!this.audioCtx) await this.init();
        if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

        if (this.isPlaying) {
            this.masterGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.05);
        } else {
            this.masterGain.gain.setTargetAtTime(1, this.audioCtx.currentTime, 0.05);
        }
        this.isPlaying = !this.isPlaying;
        return this.isPlaying;
    }

    // --- New: Audio Device Routing for HD Haptics ---
    async setAudioSink(deviceId) {
        if (!this.audioCtx) await this.init();
        if (typeof this.audioCtx.setSinkId === 'function') {
            try {
                await this.audioCtx.setSinkId(deviceId);
                return true;
            } catch (err) {
                console.error('Failed to set audio sink (HD Haptics):', err);
                return false;
            }
        } else {
            console.warn('Browser does not support AudioContext.setSinkId()');
            return false;
        }
    }

    setParams(newParams) {
        this.params = { ...this.params, ...newParams };
    }

    setVelocity(rawVelocity) {
        this.smoothedVelocity += (rawVelocity - this.smoothedVelocity) * 0.2;
    }

    triggerCollision(intensity) {
        this.impulseEnvelope = Math.min(Math.max(intensity, 0), 1.0);
        this.impulsePhase = 0;
    }

    _processAudio(audioProcessingEvent) {
        const output = audioProcessingEvent.outputBuffer.getChannelData(0);
        const sampleRate = this.audioCtx.sampleRate;
        const p = this.params;

        let currentVel = this.smoothedVelocity;
        let movementGain = Math.min(currentVel * 1.5, 1.0);

        let currentImpulseEnv = this.impulseEnvelope;
        const impulseFreq = 40 + (p.weight * 300);
        const impulseSampleDecay = Math.pow(0.9995 - p.hardness * 0.0008, 1);

        for (let i = 0; i < output.length; i++) {
            const baseFreq = 20 + (p.weight * 160);
            const drag = p.viscosity > 0 ? (noise(this.phase * 0.1) * p.viscosity * 0.8) : 0;
            let scrollSpeed = Math.max(currentVel, 0.01);
            this.phase += (baseFreq * scrollSpeed * (1 - drag)) / sampleRate;

            let hapticVal = 0;
            let amp = 1.0;
            let freq = 1.0;
            let maxAmp = 0;

            for (let oct = 0; oct < 5; oct++) {
                hapticVal += noise(this.phase * freq) * amp;
                maxAmp += amp;
                amp *= p.roughness;
                freq *= 2.1;
            }
            hapticVal /= maxAmp;

            if (p.granularity > 0) {
                hapticVal = Math.sign(hapticVal) * Math.pow(Math.abs(hapticVal), 1.0 + p.granularity * 30.0);
                hapticVal *= (1.0 + p.granularity * 1.5);
            }

            if (p.state > 0) {
                const steps = 1.0 + (1.0 - p.state) * 15.0;
                hapticVal = Math.round(hapticVal * steps) / steps;
            }

            if (p.hardness > 0) {
                const threshold = 1.0 - p.hardness * 0.7;
                if (hapticVal > threshold) hapticVal = threshold - (hapticVal - threshold);
                else if (hapticVal < -threshold) hapticVal = -threshold - (hapticVal + threshold);
                hapticVal *= (1.0 + p.hardness * 1.2);
            }

            hapticVal = Math.max(-1.0, Math.min(1.0, hapticVal));
            const textureGain = (0.5 + ((1.0 - p.weight) * 0.5)) * movementGain;
            let textureOut = hapticVal * textureGain;

            let impulseOut = 0;
            if (currentImpulseEnv > 0.001) {
                this.impulsePhase += impulseFreq / sampleRate;
                let impVal = Math.sin(this.impulsePhase * 2.0 * Math.PI);
                impVal += noise(this.impulsePhase * 8.0) * p.roughness * 0.6;

                if (p.granularity > 0) {
                    impVal = Math.sign(impVal) * Math.pow(Math.abs(impVal), 1.0 + p.granularity * 3.0);
                }
                if (p.hardness > 0.1) {
                    const foldThresh = 1.0 - p.hardness * 0.5;
                    if (impVal > foldThresh) impVal = foldThresh - (impVal - foldThresh);
                    else if (impVal < -foldThresh) impVal = -foldThresh - (impVal + foldThresh);
                    impVal *= (1.0 + p.hardness * 0.8);
                }
                if (p.state > 0) {
                    const impSteps = 2.0 + (1.0 - p.state) * 14.0;
                    impVal = Math.round(impVal * impSteps) / impSteps;
                }

                impulseOut = Math.max(-1.0, Math.min(1.0, impVal)) * currentImpulseEnv;
                currentImpulseEnv *= impulseSampleDecay;
            }

            let mixed = textureOut + impulseOut;
            output[i] = Math.max(-1.0, Math.min(1.0, mixed));
        }

        this.impulseEnvelope = currentImpulseEnv;
    }
}

export class HapticAI {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }

    async generateParams(prompt) {
        if (!this.apiKey) throw new Error("API Key is missing.");

        const systemInstruction = `あなたはプロのハプティクスデザイナーです。ユーザーの入力した「触覚のイメージ」を分析し、以下の6つのパラメータ（0.0〜1.0）に変換して出力してください。
- granularity: 滑らか(0.0) 〜 ツブツブのインパルス(1.0)
- roughness: すべすべ(0.0) 〜 微細なザラザラノイズ(1.0)
- state: 液体・連続(0.0) 〜 固体・不連続な摩擦(1.0)
- hardness: 柔らかい(0.0) 〜 金属的に硬い(1.0)
- weight: 重い・低音(0.0) 〜 軽い・高音(1.0)
- viscosity: サラサラ(0.0) 〜 泥のようなネバネバ(1.0)
必ず上記6つのキーだけを持つJSONオブジェクトのみを返してください。`;

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' }
            })
        });

        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Failed to parse response.');

        return JSON.parse(text);
    }
}

// --- New: Gamepad Input Helper ---
export class GamepadManager {
    constructor() {
        this.gamepads = {};
        this.callbacks = {
            onConnect: null,
            onDisconnect: null
        };

        window.addEventListener("gamepadconnected", (e) => {
            this.gamepads[e.gamepad.index] = e.gamepad;
            if (this.callbacks.onConnect) this.callbacks.onConnect(e.gamepad);
        });

        window.addEventListener("gamepaddisconnected", (e) => {
            delete this.gamepads[e.gamepad.index];
            if (this.callbacks.onDisconnect) this.callbacks.onDisconnect(e.gamepad);
        });
    }

    // Returns the first active gamepad state (standard mapping)
    getState() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < pads.length; i++) {
            if (pads[i] && pads[i].connected) {
                const pad = pads[i];
                return {
                    connected: true,
                    id: pad.id,
                    axes: pad.axes,     // [0: LX, 1: LY, 2: RX, 3: RY]
                    buttons: pad.buttons // [0: Cross/A, 1: Circle/B, ...] each has .pressed and .value
                };
            }
        }
        return { connected: false };
    }
}

// --- New: Waveform Visualizer ---
export class HapticVisualizer {
    constructor(engine, canvas) {
        this.engine = engine;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.isDrawing = false;

        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = this.canvas.clientWidth || 600;
        this.canvas.height = this.canvas.clientHeight || 100;
    }

    start() {
        if (this.isDrawing) return;
        this.isDrawing = true;
        this.draw();
    }

    stop() {
        this.isDrawing = false;
    }

    draw() {
        if (!this.isDrawing) return;
        requestAnimationFrame(() => this.draw());

        const width = this.canvas.width;
        const height = this.canvas.height;
        this.ctx.fillStyle = '#121212';
        this.ctx.fillRect(0, 0, width, height);

        if (!this.engine.analyser) {
            // Draw silence flatline if audio context isn't running yet
            this.ctx.beginPath();
            this.ctx.moveTo(0, height / 2);
            this.ctx.lineTo(width, height / 2);
            this.ctx.strokeStyle = '#0070cc';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            return;
        }

        const bufferLength = this.engine.analyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        this.engine.analyser.getFloatTimeDomainData(dataArray);

        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = '#00ffff';
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = '#00ffff';
        this.ctx.beginPath();

        const sliceWidth = width * 1.0 / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i];
            const y = height / 2 - (v * height / 2); // mapped to center

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
            x += sliceWidth;
        }
        this.ctx.stroke();
        this.ctx.shadowBlur = 0; // reset
    }
}
