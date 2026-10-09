/**
 * Câmera falsa para testes (injetada com page.addInitScript).
 *
 * Substitui navigator.mediaDevices.getUserMedia por um MediaStream vindo de
 * um <canvas>, cujo conteúdo o teste controla:
 *   await __fakeCam.show('/tests/fixtures/frames/paginas/1_frente.jpg')
 *   __fakeCam.clear()                 // só "mesa", sem alvo
 *   __fakeCam.mode = 'denied'         // simula permissão negada
 *   __fakeCam.mode = 'notfound' | 'busy' | 'ok'
 * O app recebe um MediaStream de verdade, então todo o caminho real
 * (vídeo → MindAR → Three.js) é exercitado.
 */
(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  let image = null;
  let tick = 0;

  function draw() {
    tick++;
    if (image) {
      ctx.drawImage(image, 0, 0, 640, 480);
    } else {
      ctx.fillStyle = '#7b5a3c';
      ctx.fillRect(0, 0, 640, 480);
    }
    // ruído mínimo para o encoder sempre ter quadros novos
    ctx.fillStyle = tick % 2 ? 'rgba(0,0,0,0.004)' : 'rgba(255,255,255,0.004)';
    ctx.fillRect(0, 0, 2, 2);
  }
  draw();
  setInterval(draw, 33);

  const streams = [];
  const fake = {
    mode: 'ok',
    calls: 0,
    streams,
    async show(url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      image = img;
      draw();
    },
    clear() {
      image = null;
      draw();
    },
    liveTracks() {
      return streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length;
    },
  };
  window.__fakeCam = fake;

  const md = navigator.mediaDevices || {};
  md.getUserMedia = async (constraints = {}) => {
    fake.calls++;
    if (fake.mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
    if (fake.mode === 'notfound') throw new DOMException('Requested device not found', 'NotFoundError');
    if (fake.mode === 'busy') throw new DOMException('Could not start video source', 'NotReadableError');
    if (!constraints.video) throw new TypeError('video required');
    const stream = canvas.captureStream(30);
    streams.push(stream);
    return stream;
  };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md });
})();
