# Bibliotecas de terceiros (vendorizadas)

Copiadas localmente para o app não depender de CDN (escolas e redes móveis
às vezes bloqueiam CDNs) e para fixar versões testadas.

| Biblioteca | Versão | Origem (npm) | Licença |
|---|---|---|---|
| MindAR (image tracking) | 1.2.5 | `mind-ar/dist/mindar-image.prod.js` + chunks `controller-*.js`, `ui-*.js` | MIT |
| Three.js | r160 (0.160.0) | `three/build/three.module.min.js` | MIT |
| GLTFLoader / BufferGeometryUtils | r160 | `three/examples/jsm/...` | MIT |

## Ajustes feitos nas cópias

- `three/addons/*.js`: `from 'three'` foi trocado por `from '../three.module.min.js'`
  e o import de `BufferGeometryUtils` aponta para a mesma pasta. Assim os módulos
  funcionam sem *import maps* (iOS < 16.4).

## Por que Three.js r160?

O MindAR 1.2.5 foi publicado e testado com o Three.js r160 (é a versão usada na
documentação oficial). O app usa apenas o `Controller` de baixo nível do MindAR
(`MINDAR.IMAGE.Controller`), com integração própria ao Three.js em
`src/ar/arSession.js`.
