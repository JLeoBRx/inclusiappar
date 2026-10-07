/**
 * Ponto único de importação do Three.js (r160, vendorizado em /vendor/three).
 *
 * Usamos caminhos relativos em vez de "import maps" para funcionar também em
 * iPhones com iOS anterior ao 16.4. Para atualizar o Three.js, troque os
 * arquivos em /vendor/three (veja vendor/README.md).
 */
export * from '../../vendor/three/three.module.min.js';
export { GLTFLoader } from '../../vendor/three/addons/GLTFLoader.js';
