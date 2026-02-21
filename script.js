// ===============================
// 1) Reveal on scroll
// ===============================
const revealEls = document.querySelectorAll('.reveal');

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.12 }
);

revealEls.forEach((el) => revealObserver.observe(el));

// ===============================
// 2) 3D tilt cards
// ===============================
const tiltCards = document.querySelectorAll('.tilt-card');

tiltCards.forEach((card) => {
  card.addEventListener('mousemove', (e) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    const rotateY = (px - 0.5) * 8;
    const rotateX = (0.5 - py) * 8;

    card.style.transform =
      `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform =
      'perspective(900px) rotateX(0deg) rotateY(0deg) translateY(0px)';
  });
});

// ===============================
// 3) WebGL fluid background
// Works on GitHub Pages (no backend needed)
// ===============================
const fluidCanvas = document.getElementById('bg-canvas');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!fluidCanvas || reducedMotion) {
  // No-op if disabled.
} else {
  initFluid(fluidCanvas);
}

function initFluid(canvas) {
  const gl =
    canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false }) ||
    canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });

  if (!gl) {
    return;
  }

  const isWebGL2 = gl instanceof WebGL2RenderingContext;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const ext = getExtensions(gl, isWebGL2);
  if (!ext.floatTex || !ext.linearFloat) {
    return;
  }

  let simWidth = 0;
  let simHeight = 0;
  let dyeWidth = 0;
  let dyeHeight = 0;

  const pointer = {
    down: false,
    moved: false,
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.5,
    dx: 0,
    dy: 0,
    color: [0.22, 0.38, 0.78]
  };

  const config = {
    SIM_RESOLUTION: 256,
    DYE_RESOLUTION: 1024,
    DENSITY_DISSIPATION: 0.993,
    VELOCITY_DISSIPATION: 0.998,
    PRESSURE_DISSIPATION: 0.992,
    PRESSURE_ITERATIONS: 24,
    CURL: 10,
    SPLAT_RADIUS: 0.0075
  };

  const baseVertexShader = compileShader(gl.VERTEX_SHADER, `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `);

  const clearShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;
    void main () {
      gl_FragColor = value * texture2D(uTexture, vUv);
    }
  `);

  const displayShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec2 texelSize;
    void main () {
      vec3 c = texture2D(uTexture, vUv).rgb;
      c += texture2D(uTexture, vUv + vec2(texelSize.x, 0.0)).rgb;
      c += texture2D(uTexture, vUv - vec2(texelSize.x, 0.0)).rgb;
      c += texture2D(uTexture, vUv + vec2(0.0, texelSize.y)).rgb;
      c += texture2D(uTexture, vUv - vec2(0.0, texelSize.y)).rgb;
      c /= 5.0;
      c = 1.0 - exp(-0.95 * c);
      gl_FragColor = vec4(c, 0.58);
    }
  `);

  const splatShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;
    void main () {
      vec2 p = vUv - point;
      p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      vec3 base = texture2D(uTarget, vUv).xyz;
      gl_FragColor = vec4(base + splat, 1.0);
    }
  `);

  const advectionShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;
    void main () {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
      vec3 result = texture2D(uSource, coord).xyz;
      gl_FragColor = vec4(result * dissipation, 1.0);
    }
  `);

  const divergenceShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;
      float div = 0.5 * (R - L + T - B);
      gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
  `);

  const curlShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      float c = R - L - T + B;
      gl_FragColor = vec4(c, 0.0, 0.0, 1.0);
    }
  `);

  const vorticityShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;
    void main () {
      float L = abs(texture2D(uCurl, vL).x);
      float R = abs(texture2D(uCurl, vR).x);
      float T = abs(texture2D(uCurl, vT).x);
      float B = abs(texture2D(uCurl, vB).x);
      float C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(R - L, T - B);
      force /= (length(force) + 0.0001);
      force *= curl * C;
      force.y *= -1.0;
      vec2 vel = texture2D(uVelocity, vUv).xy;
      gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
    }
  `);

  const pressureShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    varying vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float D = texture2D(uDivergence, vUv).x;
      float P = (L + R + T + B - D) * 0.25;
      gl_FragColor = vec4(P, 0.0, 0.0, 1.0);
    }
  `);

  const gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    varying vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 vel = texture2D(uVelocity, vUv).xy;
      vel -= vec2(R - L, T - B) * 0.5;
      gl_FragColor = vec4(vel, 0.0, 1.0);
    }
  `);

  const clearProgram = createProgram(baseVertexShader, clearShader);
  const displayProgram = createProgram(baseVertexShader, displayShader);
  const splatProgram = createProgram(baseVertexShader, splatShader);
  const advectionProgram = createProgram(baseVertexShader, advectionShader);
  const divergenceProgram = createProgram(baseVertexShader, divergenceShader);
  const curlProgram = createProgram(baseVertexShader, curlShader);
  const vorticityProgram = createProgram(baseVertexShader, vorticityShader);
  const pressureProgram = createProgram(baseVertexShader, pressureShader);
  const gradientSubtractProgram = createProgram(baseVertexShader, gradientSubtractShader);

  const quadVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);

  let velocity;
  let dye;
  let divergence;
  let curl;
  let pressure;

  resize();
  randomInitialSplats();

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', () => {
    pointer.down = true;
    pointer.color = randomColor();
  });
  window.addEventListener('mouseup', () => {
    pointer.down = false;
  });
  window.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (!t) return;
    pointer.down = true;
    pointer.color = randomColor();
    pointer.x = t.clientX;
    pointer.y = t.clientY;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - pointer.x;
    const dy = t.clientY - pointer.y;
    pointer.dx = dx * 2.2;
    pointer.dy = dy * 2.2;
    pointer.x = t.clientX;
    pointer.y = t.clientY;
    pointer.moved = true;
  }, { passive: true });
  window.addEventListener('touchend', () => {
    pointer.down = false;
  }, { passive: true });

  let lastTime = performance.now();
  requestAnimationFrame(update);

  function update(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.016);
    lastTime = now;

    if (pointer.moved) {
      splat(
        pointer.x / canvas.width,
        1.0 - pointer.y / canvas.height,
        pointer.dx,
        -pointer.dy,
        pointer.color
      );
      pointer.moved = false;
    }

    step(dt);
    render();
    requestAnimationFrame(update);
  }

  function step(dt) {
    gl.disable(gl.BLEND);

    bindProgram(curlProgram, simWidth, simHeight, velocity.read.texelSizeX, velocity.read.texelSizeY);
    uniform1i(curlProgram, 'uVelocity', velocity.read.attach(0));
    blit(curl.fbo);

    bindProgram(vorticityProgram, simWidth, simHeight, velocity.read.texelSizeX, velocity.read.texelSizeY);
    uniform1i(vorticityProgram, 'uVelocity', velocity.read.attach(0));
    uniform1i(vorticityProgram, 'uCurl', curl.attach(1));
    uniform1f(vorticityProgram, 'curl', config.CURL);
    uniform1f(vorticityProgram, 'dt', dt);
    blit(velocity.write.fbo);
    velocity.swap();

    bindProgram(divergenceProgram, simWidth, simHeight, velocity.read.texelSizeX, velocity.read.texelSizeY);
    uniform1i(divergenceProgram, 'uVelocity', velocity.read.attach(0));
    blit(divergence.fbo);

    bindProgram(clearProgram, simWidth, simHeight, pressure.read.texelSizeX, pressure.read.texelSizeY);
    uniform1i(clearProgram, 'uTexture', pressure.read.attach(0));
    uniform1f(clearProgram, 'value', config.PRESSURE_DISSIPATION);
    blit(pressure.write.fbo);
    pressure.swap();

    bindProgram(pressureProgram, simWidth, simHeight, pressure.read.texelSizeX, pressure.read.texelSizeY);
    uniform1i(pressureProgram, 'uDivergence', divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      uniform1i(pressureProgram, 'uPressure', pressure.read.attach(1));
      blit(pressure.write.fbo);
      pressure.swap();
    }

    bindProgram(gradientSubtractProgram, simWidth, simHeight, velocity.read.texelSizeX, velocity.read.texelSizeY);
    uniform1i(gradientSubtractProgram, 'uPressure', pressure.read.attach(0));
    uniform1i(gradientSubtractProgram, 'uVelocity', velocity.read.attach(1));
    blit(velocity.write.fbo);
    velocity.swap();

    bindProgram(advectionProgram, simWidth, simHeight, velocity.read.texelSizeX, velocity.read.texelSizeY);
    uniform1i(advectionProgram, 'uVelocity', velocity.read.attach(0));
    uniform1i(advectionProgram, 'uSource', velocity.read.attach(0));
    uniform1f(advectionProgram, 'dt', dt);
    uniform1f(advectionProgram, 'dissipation', config.VELOCITY_DISSIPATION);
    uniform2f(advectionProgram, 'texelSize', velocity.read.texelSizeX, velocity.read.texelSizeY);
    blit(velocity.write.fbo);
    velocity.swap();

    bindProgram(advectionProgram, dyeWidth, dyeHeight, dye.read.texelSizeX, dye.read.texelSizeY);
    uniform1i(advectionProgram, 'uVelocity', velocity.read.attach(0));
    uniform1i(advectionProgram, 'uSource', dye.read.attach(1));
    uniform1f(advectionProgram, 'dt', dt);
    uniform1f(advectionProgram, 'dissipation', config.DENSITY_DISSIPATION);
    uniform2f(advectionProgram, 'texelSize', dye.read.texelSizeX, dye.read.texelSizeY);
    blit(dye.write.fbo);
    dye.swap();
  }

  function render() {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    bindProgram(displayProgram, canvas.width, canvas.height, 1 / canvas.width, 1 / canvas.height);
    uniform1i(displayProgram, 'uTexture', dye.read.attach(0));
    uniform2f(displayProgram, 'texelSize', 1 / dyeWidth, 1 / dyeHeight);
    blit(null);
  }

  function splat(x, y, dx, dy, color) {
    gl.disable(gl.BLEND);

    bindProgram(splatProgram, simWidth, simHeight, velocity.read.texelSizeX, velocity.read.texelSizeY);
    uniform1i(splatProgram, 'uTarget', velocity.read.attach(0));
    uniform1f(splatProgram, 'aspectRatio', canvas.width / canvas.height);
    uniform2f(splatProgram, 'point', x, y);
    uniform3f(splatProgram, 'color', dx, dy, 0.0);
    uniform1f(splatProgram, 'radius', config.SPLAT_RADIUS);
    blit(velocity.write.fbo);
    velocity.swap();

    bindProgram(splatProgram, dyeWidth, dyeHeight, dye.read.texelSizeX, dye.read.texelSizeY);
    uniform1i(splatProgram, 'uTarget', dye.read.attach(0));
    uniform1f(splatProgram, 'aspectRatio', canvas.width / canvas.height);
    uniform2f(splatProgram, 'point', x, y);
    uniform3f(splatProgram, 'color', color[0], color[1], color[2]);
    uniform1f(splatProgram, 'radius', config.SPLAT_RADIUS * 1.2);
    blit(dye.write.fbo);
    dye.swap();
  }

  function randomInitialSplats() {
    for (let i = 0; i < 4; i++) {
      const x = Math.random();
      const y = Math.random();
      const dx = (Math.random() - 0.5) * 240;
      const dy = (Math.random() - 0.5) * 240;
      splat(x, y, dx, dy, randomColor());
    }
  }

  function onMouseMove(e) {
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    const boost = pointer.down ? 4.2 : 2.4;
    pointer.dx = dx * boost;
    pointer.dy = dy * boost;
    pointer.moved = Math.abs(dx) + Math.abs(dy) > 0;
    if (pointer.down) pointer.color = randomColor();
  }

  function resize() {
    const width = Math.max(1, Math.floor(window.innerWidth * dpr));
    const height = Math.max(1, Math.floor(window.innerHeight * dpr));
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;

    simWidth = Math.max(2, Math.floor(config.SIM_RESOLUTION * dpr));
    simHeight = Math.max(2, Math.floor((config.SIM_RESOLUTION * window.innerHeight / window.innerWidth) * dpr));
    dyeWidth = Math.max(2, Math.floor(config.DYE_RESOLUTION * dpr));
    dyeHeight = Math.max(2, Math.floor((config.DYE_RESOLUTION * window.innerHeight / window.innerWidth) * dpr));

    velocity = createDoubleFBO(simWidth, simHeight, ext.rgInternal, ext.rgFormat, ext.halfFloatTexType, ext.filtering);
    dye = createDoubleFBO(dyeWidth, dyeHeight, ext.rgbaInternal, ext.rgbaFormat, ext.halfFloatTexType, ext.filtering);
    divergence = createFBO(simWidth, simHeight, ext.rInternal, ext.rFormat, ext.halfFloatTexType, gl.NEAREST);
    curl = createFBO(simWidth, simHeight, ext.rInternal, ext.rFormat, ext.halfFloatTexType, gl.NEAREST);
    pressure = createDoubleFBO(simWidth, simHeight, ext.rInternal, ext.rFormat, ext.halfFloatTexType, gl.NEAREST);
  }

  function createDoubleFBO(w, h, internalFormat, format, type, filtering) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, filtering);
    let fbo2 = createFBO(w, h, internalFormat, format, type, filtering);
    return {
      get read() { return fbo1; },
      get write() { return fbo2; },
      swap() {
        const t = fbo1;
        fbo1 = fbo2;
        fbo2 = t;
      }
    };
  }

  function createFBO(w, h, internalFormat, format, type, filtering) {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (isWebGL2) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, type, null);
    }

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      }
    };
  }

  function bindProgram(program, w, h) {
    gl.useProgram(program);
    gl.viewport(0, 0, w, h);
    const aPos = gl.getAttribLocation(program, 'aPosition');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  function blit(target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
  }

  function uniform1i(program, name, v) {
    gl.uniform1i(gl.getUniformLocation(program, name), v);
  }

  function uniform1f(program, name, v) {
    gl.uniform1f(gl.getUniformLocation(program, name), v);
  }

  function uniform2f(program, name, x, y) {
    gl.uniform2f(gl.getUniformLocation(program, name), x, y);
  }

  function uniform3f(program, name, x, y, z) {
    gl.uniform3f(gl.getUniformLocation(program, name), x, y, z);
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile error');
    }
    return shader;
  }

  function createProgram(vs, fs) {
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Program link error');
    }
    return program;
  }

  function randomColor() {
    const blue = [0.16, 0.42, 0.95];
    const red = [0.90, 0.20, 0.30];
    const t = Math.random();
    const color = [
      blue[0] * (1 - t) + red[0] * t,
      blue[1] * (1 - t) + red[1] * t,
      blue[2] * (1 - t) + red[2] * t
    ];
    const intensity = 0.26 + Math.random() * 0.10;
    return color.map((c) => c * intensity);
  }

  function getExtensions(glCtx, webgl2) {
    if (webgl2) {
      glCtx.getExtension('EXT_color_buffer_float');
      return {
        floatTex: true,
        linearFloat: !!glCtx.getExtension('OES_texture_float_linear'),
        halfFloatTexType: glCtx.HALF_FLOAT,
        rInternal: glCtx.R16F,
        rFormat: glCtx.RED,
        rgInternal: glCtx.RG16F,
        rgFormat: glCtx.RG,
        rgbaInternal: glCtx.RGBA16F,
        rgbaFormat: glCtx.RGBA,
        filtering: glCtx.LINEAR
      };
    }

    const halfFloat = glCtx.getExtension('OES_texture_half_float');
    const linear = glCtx.getExtension('OES_texture_half_float_linear');
    return {
      floatTex: !!halfFloat,
      linearFloat: !!linear,
      halfFloatTexType: halfFloat ? halfFloat.HALF_FLOAT_OES : 0,
      rInternal: glCtx.RGBA,
      rFormat: glCtx.RGBA,
      rgInternal: glCtx.RGBA,
      rgFormat: glCtx.RGBA,
      rgbaInternal: glCtx.RGBA,
      rgbaFormat: glCtx.RGBA,
      filtering: linear ? glCtx.LINEAR : glCtx.NEAREST
    };
  }
}
