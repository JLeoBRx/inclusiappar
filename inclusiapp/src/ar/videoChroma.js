/**
 * Vídeo de LIBRAS com remoção do fundo (chroma key) em tempo real.
 *
 * Os vídeos foram gravados com um tecido VERDE-LIMÃO (≈ RGB 205,211,79), não
 * um verde de estúdio. Um chroma key comum ("verde > vermelho") apagaria a
 * pele dos braços, que reflete o fundo. A chave usada aqui foi calibrada nos
 * próprios vídeos (ver README):
 *
 *   s = (min(R,G) − B) / max     → "amarelo-esverdeado" do tecido
 *   h = (G − R) / max            → o tecido tem G ≥ R; a pele tem R > G
 *   fundo = smoothstep(low, high, s + hueWeight·h)
 *
 * Depois: erosão de 1 texel (remove o contorno verde), suavização da borda e
 * remoção do reflexo verde (despill).
 *
 * O vídeo é desenhado no HUD do mesmo renderer da cena AR (sem um segundo
 * contexto WebGL) e não captura toques — os controles continuam livres.
 */
import * as THREE from '../lib/three.js';

const VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */`
uniform sampler2D map;
uniform vec2 texel;
uniform vec4 crop;
uniform float hueWeight;
uniform float low;
uniform float high;
uniform float minLuma;
uniform float despill;
uniform float opacity;
varying vec2 vUv;

float keyness(vec3 c) {
  float mx = max(max(c.r, c.g), c.b) + 1e-4;
  float s = (min(c.r, c.g) - c.b) / mx;
  float h = (c.g - c.r) / mx;
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return smoothstep(low, high, s + hueWeight * h) * smoothstep(minLuma, minLuma + 0.18, y);
}

void main() {
  vec2 uv = mix(crop.xy, crop.zw, vUv);
  vec3 c = texture2D(map, uv).rgb;
  float a0 = 1.0 - keyness(c);
  float a1 = 1.0 - keyness(texture2D(map, uv + vec2(texel.x, 0.0)).rgb);
  float a2 = 1.0 - keyness(texture2D(map, uv - vec2(texel.x, 0.0)).rgb);
  float a3 = 1.0 - keyness(texture2D(map, uv + vec2(0.0, texel.y)).rgb);
  float a4 = 1.0 - keyness(texture2D(map, uv - vec2(0.0, texel.y)).rgb);
  float alpha = 0.5 * min(a0, min(min(a1, a2), min(a3, a4))) + 0.1 * (a0 + a1 + a2 + a3 + a4);
  // bordas do quadro: some suavemente (evita "linhas" do tecido na borda)
  vec2 edge = smoothstep(vec2(0.0), vec2(0.02), vUv) * smoothstep(vec2(0.0), vec2(0.02), 1.0 - vUv);
  alpha *= edge.x * edge.y;
  if (alpha < 0.01) discard;
  // despill: o verde nunca passa do vermelho; tons amarelados perdem saturação
  c.g = min(c.g, c.r);
  float mx = max(max(c.r, c.g), c.b) + 1e-4;
  float s2 = (min(c.r, c.g) - c.b) / mx;
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(y), smoothstep(0.2, 0.5, s2) * despill);
  gl_FragColor = vec4(c, clamp(alpha, 0.0, 1.0) * opacity);
}`;

export class LibrasVideo {
  /**
   * @param {object} opts
   * @param {object} opts.chroma   LIBRAS.chroma (config.js)
   * @param {number[]} opts.crop   recorte [x0, y0, x1, y1]
   */
  constructor({ chroma, crop = [0, 0, 1, 1] }) {
    this.crop = crop;
    const video = document.createElement('video');
    video.className = 'libras-source';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    this.video = video;

    this.texture = new THREE.VideoTexture(video);
    this.texture.colorSpace = THREE.NoColorSpace; // a chave foi calibrada em valores sRGB
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        map: { value: this.texture },
        texel: { value: new THREE.Vector2(1 / 940, 1 / 742) },
        crop: { value: new THREE.Vector4(...crop) },
        hueWeight: { value: chroma.hueWeight },
        low: { value: chroma.low },
        high: { value: chroma.high },
        minLuma: { value: chroma.minLuma },
        despill: { value: chroma.despill },
        opacity: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;

    this.src = null;
    this.enabled = true;
    this.ready = false;
    this.failed = false;
    this.onError = null;
    this.onReady = null;
    this.aspect = 940 / 742;

    video.addEventListener('loadedmetadata', () => {
      this.material.uniforms.texel.value.set(1 / video.videoWidth, 1 / video.videoHeight);
      const [x0, y0, x1, y1] = this.crop;
      this.aspect = (video.videoWidth * (x1 - x0)) / (video.videoHeight * (y1 - y0));
      this.onLayout?.();
    });
    video.addEventListener('playing', () => {
      this.ready = true;
      this.onReady?.();
    });
    video.addEventListener('error', () => {
      this.failed = true;
      this.ready = false;
      this.mesh.visible = false;
      this.onError?.(video.error);
    });
  }

  /**
   * Os vídeos são MP4/H.264 (Android, iPhone, Windows, macOS). Se o navegador
   * não tocar H.264 (algumas distribuições Linux), tenta um .webm de mesmo
   * nome — basta colocá-lo ao lado do .mp4 para dar suporte.
   */
  static resolve(url) {
    if (!url || !/\.mp4$/i.test(url)) return url;
    // pergunta pelo codec (H.264 High): só "video/mp4" pode responder "maybe"
    // mesmo sem H.264 (MP4 com outros codecs)
    const probe = document.createElement('video');
    return probe.canPlayType('video/mp4; codecs="avc1.640028"') ? url : url.replace(/\.mp4$/i, '.webm');
  }

  /** Troca o vídeo (só um vídeo carregado por vez). */
  setSource(url) {
    url = LibrasVideo.resolve(url);
    if (url === this.src) return;
    this.src = url;
    this.ready = false;
    this.failed = false;
    this.material.uniforms.opacity.value = 0;
    this.video.pause();
    if (!url) {
      this.video.removeAttribute('src');
      this.video.load();
      this.mesh.visible = false;
      return;
    }
    this.video.src = url;
    this.video.load();
    if (this.enabled) this._play();
  }

  _play() {
    if (!this.src || this.failed) return;
    if (!this.video.isConnected) document.body.appendChild(this.video);
    const p = this.video.play();
    if (p?.catch) p.catch((err) => {
      if (err?.name !== 'AbortError') console.warn('[LIBRAS] play()', err);
    });
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this._play();
    else this.video.pause();
  }

  /**
   * Posiciona o vídeo no HUD (coordenadas em pixels, origem embaixo à esquerda).
   * @param {{x:number, y:number, height:number}} box
   */
  place({ x, y, height }) {
    const width = height * this.aspect;
    this.mesh.scale.set(width, height, 1);
    this.mesh.position.set(x + width / 2, y + height / 2, 0);
    this.box = { x, y, width, height };
    return this.box;
  }

  /** Atualiza o fade-in/out (chamar a cada quadro). */
  update(dt) {
    const show = this.enabled && this.ready && !this.failed && !!this.src;
    const u = this.material.uniforms.opacity;
    u.value = Math.max(0, Math.min(1, u.value + (show ? dt : -dt) * 4));
    this.mesh.visible = u.value > 0.001;
  }

  dispose() {
    this.setSource(null);
    this.video.remove();
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
