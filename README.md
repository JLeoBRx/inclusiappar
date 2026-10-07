# SinalizaAção: Animais em Voga — WebApp de Realidade Aumentada

WebApp de **Realidade Aumentada (AR)** com duas experiências, feito para celulares
Android e iPhone (e funcional em tablets e computadores):

- **📖 Livro em AR** — aponte o celular para uma página do livro e o animal aparece
  em 3D sobre ela, acompanhado do **vídeo do sinal em LIBRAS** (com o fundo verde
  removido em tempo real). O botão **✋ Interagir** tira o animal da página para
  girar, aproximar e explorar com os dedos.
- **🃏 Jogo de Cartas** — o jogo sorteia uma carta (como um baralho, sem repetir
  no ciclo), a criança procura a carta física e a escaneia: acerto soma pontos e
  bônus de tempo, erro desconta pontos, **⏭️ Pular** passa a vez.

Tudo roda no navegador, sem instalar nada: [MindAR](https://github.com/hiukim/mind-ar-js)
(reconhecimento de imagens) + [Three.js](https://threejs.org/) (3D) + HTML/CSS/JS.

| Menu | Livro em AR (animal 3D + LIBRAS) | Modo Interação | Jogo |
|---|---|---|---|
| ![Menu](docs/screenshots/menu-celular.jpg) | ![Livro](docs/screenshots/livro-ar-elefante.jpg) | ![Interação](docs/screenshots/livro-interacao.jpg) | ![Jogo](docs/screenshots/jogo-acerto.jpg) |

---

## 1. Como abrir

**Publicado (recomendado):** a câmera só funciona em endereços `https://`. Com o
GitHub Pages ativado (seção 9), o app fica em
`https://<usuário>.github.io/inclusiappar/` — a raiz redireciona para `inclusiapp/`.

**No computador, para desenvolver:**

```bash
npm install          # só para as ferramentas e testes (Playwright)
npm start            # http://localhost:8080/inclusiapp/
```

No próprio computador, `localhost` é considerado seguro e a webcam funciona. Para
testar num celular, use o endereço publicado (HTTPS).

## 2. Estrutura

```text
/
├── index.html                  redireciona para inclusiapp/
├── inclusiapp/                 ← o WebApp (pasta publicada)
│   ├── index.html              telas: carregamento, menu, explicações, AR
│   ├── manifest.webmanifest    instalação como app (PWA)
│   ├── sw.js                   service worker (cache para visitas seguintes)
│   ├── src/
│   │   ├── main.js             inicialização, rotas, pré-carregamento
│   │   ├── router.js           navegação (#/, #/livro, #/livro/ar, #/jogo, #/jogo/jogar)
│   │   ├── config.js           ★ CONFIGURAÇÃO CENTRAL
│   │   ├── lib/three.js        ponto único de importação do Three.js
│   │   ├── ar/
│   │   │   ├── arSession.js    câmera + MindAR + Three.js (ciclo de vida, erros, projeção)
│   │   │   ├── targets.js      carrega os .mind (comprimidos, com verificação)
│   │   │   ├── bookAR.js       experiência do livro (Modo Página / Interação)
│   │   │   ├── modelManager.js modelos 3D sob demanda, sombra, animação
│   │   │   ├── animalMaterial.js cores, padrões e partes animadas (shaders)
│   │   │   ├── gestures.js     girar, pinça, torcer, arrastar, duplo toque
│   │   │   └── videoChroma.js  vídeo de LIBRAS com chroma key (WebGL)
│   │   ├── game/
│   │   │   ├── cardGame.js     experiência do jogo (interface + AR)
│   │   │   ├── gameState.js    regras (acerto, erro, pular, ciclo) — sem DOM
│   │   │   ├── deck.js         baralho em ciclos (Fisher–Yates)
│   │   │   ├── scoring.js      pontos, penalidade, bônus de tempo
│   │   │   └── timer.js        cronômetro
│   │   ├── ui/                 menu, explicações, avisos/erros, sons, efeitos
│   │   └── styles/main.css     identidade visual, responsividade
│   ├── assets/                 arquivos GERADOS a partir dos originais
│   │   ├── models/*.glb        animais convertidos (tools/convert_models.py)
│   │   ├── targets/            paginas.mind, cartas.mind (+ .gz, .json)
│   │   ├── img/                imagens otimizadas (WebP) e ícones
│   │   └── fonts/              Baloo 2 e Nunito (OFL)
│   ├── vendor/                 MindAR 1.2.5 e Three.js r160 (cópias locais)
│   ├── cartas/ codes/ exemplo/ modelo3d/ pag/ videos/   ← arquivos originais
├── tools/                      conversores, compilador de alvos, servidor, visualizador
├── tests/                      testes unitários, de reconhecimento e ponta a ponta
└── docs/screenshots/
```

Os arquivos originais ficam intactos; o app usa os originais quando eles já são
adequados à Web (cartas, vídeos) e versões geradas quando não são (modelos,
imagens decorativas, alvos do MindAR).

## 3. O que foi encontrado nos arquivos

| Pasta | Conteúdo real | Uso no app |
|---|---|---|
| `cartas/` | **20** cartas PNG (≈460×700). Grupos: 1–5 animais, 6–10 sinais dos animais em LIBRAS, 11–15 vogais no alfabeto manual, 16–20 letras A E I O U | alvos do jogo (`cartas.mind`) e imagem da carta-alvo |
| `pag/` | 5 páginas PNG (935×1319 a 1332×908) | alvos do livro (`paginas.mind`) |
| `modelo3d/` | **não são FBX**: são assets `Mesh` do Unity em YAML (classe 43), com malha e rig (pesos de skinning), **sem texturas, materiais nem animações** | convertidos para GLB (seção 5) |
| `videos/` | MP4 H.264 940×742, 30 fps, 10–18 s, **sem áudio**, fundo **verde-limão** (não verde de estúdio) | LIBRAS com chroma key (seção 7) |
| `exemplo/` | `vila.jpg` (4961×3508, 13,8 MB) — a cidade de **Signária**; `logo.png`; `protagonista.png` — a **Aia** | fundo do app (WebP de 75 KB), logotipo, Aia no menu e no jogo |
| `codes/` | `ARCombinationGameManager.cs` (a classe interna se chama `ARStoryGameManager`) | lógica adaptada no jogo (seção 8) |

> Observação: no Unity, o nome da classe deve ser igual ao do arquivo; com
> `ARStoryGameManager` dentro de `ARCombinationGameManager.cs`, o Unity não
> consegue anexar o script a um objeto.

## 4. Configuração central — `inclusiapp/src/config.js`

Toda a relação **Página → Alvo → Animal → Modelo → Vídeo** está em `ANIMALS`:

```js
{ id: 'abelha', page: 1, target: 0, image: 'pag/Pagina1.png', name: 'Abelha', emoji: '🐝',
  model: 'assets/models/abelha.glb', video: 'videos/abelha.mp4', scale: 0.4, lift: 0.12, offset: [0, 0.05] }
```

`target` é o índice no `paginas.mind`, que segue a numeração dos arquivos:
`Pagina1 → 0, Pagina2 → 1, Pagina3 → 2, Pagina4 → 3, Pagina5 → 4`.
No mesmo arquivo: links do menu (`APP.links`), parâmetros do chroma key
(`LIBRAS`), nomes das cartas e todas as regras de pontuação (`GAME`), e os ajustes
do rastreamento (`AR`).

## 5. Modelos 3D (Unity `.asset` → GLB)

O Three.js não lê `.asset`. O script `tools/convert_models.py` (Python + numpy):

1. decodifica o *vertex buffer* do Unity (`m_VertexData`, streams alinhados a 16 bytes)
   e os índices — o tamanho calculado confere byte a byte com `m_DataSize`;
2. converte de mão esquerda (Unity) para mão direita (glTF) e corrige a orientação
   de cada animal (Abelha, Onça e Urso vinham em Z-up; a Onça ainda tinha 30° de
   rotação no osso raiz; o Elefante olhava para +X);
3. como **não vieram texturas**, pinta cores por região usando os **ossos do rig
   original** (cabeça, tórax, asas, orelhas, presas...) e adiciona padrões
   procedurais no shader (listras da abelha, rosetas da onça, faixas da iguana);
4. cria **animações** a partir do rig: asas da abelha batendo, orelhas, tromba e
   cauda do elefante, cabeça e cauda da iguana, cauda e cabeça da onça, cabeça do
   urso — com pivô na articulação original;
5. grava GLB válidos (verificados com o *glTF Validator* da Khronos: 0 erros).

```bash
npm run models     # recria inclusiapp/assets/models/*.glb
npm start          # e abra http://localhost:8080/tools/model-viewer.html para conferir
```

Se as **texturas originais** existirem no projeto Unity, elas podem ser usadas: os
GLB mantêm as UVs originais e `createAnimalMaterial({ map })` aceita uma textura.

## 6. Alvos do MindAR (páginas e cartas)

O navegador não consegue listar pastas, e o MindAR precisa de um arquivo `.mind`
compilado. Por isso existe um passo de compilação que **lê a pasta e conta as
cartas automaticamente**:

```bash
npm run targets          # compila páginas e cartas
npm run targets -- cartas
```

ou pelo navegador: com `npm start` (ou qualquer servidor na raiz do repositório),
abra `http://localhost:8080/tools/compile-targets.html`, clique em **Compilar** e
copie os arquivos baixados para `inclusiapp/assets/targets/`.

Saída: `cartas.mind` (+ `cartas.mind.gz`, metade do tamanho, que o app prefere) e
`cartas.json` com a quantidade, o tamanho e o checksum. **O jogo monta o baralho a
partir desse manifesto** — para ter 30 cartas, basta colocar `carta21.png` ...
`carta30.png` na pasta e recompilar; nenhuma linha de código muda (os nomes em
`GAME.labels` são opcionais).

Resolução de compilação escolhida por medição (`tests/e2e/recognition.mjs`, com o
detector real do MindAR em fotos sintéticas com perspectiva, rotação, distância e
pouca luz):

| Conjunto | Resolução | Reconhecimento | Confusões entre alvos |
|---|---|---|---|
| Páginas | 512 px | **100%** (20/20) | 0 |
| Cartas | 400 px | **98,8%** (79/80) | 0 |
| Cartas (teste) | 720 px | 97,5% — e arquivo 40% maior | 0 |

## 7. LIBRAS e chroma key

O fundo dos vídeos é um tecido **verde-limão** (≈ RGB 205, 211, 79) com dobras e
sombras, e o tecido reflete verde na pele. Um chroma key comum apagava os braços.
A chave foi calibrada nos próprios vídeos:

```
s = (min(R,G) − B) / max(R,G,B)    "amarelo-esverdeado" do tecido
h = (G − R) / max(R,G,B)           o tecido tem G ≥ R; a pele tem R > G
transparência = smoothstep(0,24; 0,40; s + 2·h)
```

seguida de erosão de 1 pixel na borda, suavização e remoção do reflexo verde. Roda
num shader WebGL, desenhado sobre a cena AR pelo mesmo renderer (sem segundo
contexto). O teste automático mede **0,00% de verde-limão restante** na imagem final.

- só **um vídeo** carregado por vez; ao trocar de página, troca o vídeo;
- **🎥 LIBRAS: ON/OFF** (a preferência é lembrada) e botão ⤢ para ampliar;
- o vídeo não captura toques: não atrapalha os gestos nem os botões;
- se o vídeo falhar, aparece um aviso e a AR continua funcionando;
- navegadores sem H.264 (raros, ex.: algumas distribuições Linux) usam um `.webm`
  de mesmo nome se ele existir ao lado do `.mp4`.

## 8. Jogo de cartas e o código original (C#)

O `ARCombinationGameManager.cs` foi lido e sua lógica adaptada:

| Original (Unity) | Versão Web |
|---|---|
| `ResetDeck()` — Fisher–Yates | `deck.js` — mesmo algoritmo, testado |
| `GenerateNewMission()` — tira do topo; baralho vazio = novo | idem, **e a 1ª carta do novo ciclo nunca repete a última** (o original podia repetir) |
| `ShuffleAndGenerate()` — "roleta" de 2 s (0,05 s + 0,01 s por passo) | mesma roleta, mesmos tempos (`GAME.shuffleTime`) |
| `delayNextMission = 2 s` | `GAME.delayNextMission` |
| `CheckActiveCards()` a cada quadro com `GameObject.Find` | eventos de "carta encontrada/perdida" do MindAR |
| `CorrectScan()` — pontos por faixa de tempo 100/70/40/10 | pontos fixos + bônus de tempo; o modo `'tiers'` reproduz a tabela original |
| `WrongScan()` — só som, intervalo de 1 s | **desconta pontos**, com proteções: intervalo entre penalidades, mesma carta só após 6 s, máx. 3 por carta sorteada, pontuação nunca negativa |
| `SkipMission()` | **Pular**: a carta sai do ciclo e só volta no próximo baralho |
| objetos `correto`/`incorreto` da Aia sobre a carta | moldura verde/vermelha em AR sobre a carta escaneada e a Aia comemorando no acerto |
| `correctSound` / `errorSound` | sons sintetizados (WebAudio) + vibração no Android |
| `PlayerPrefs("score")` | recorde salvo e **"Continuar jogo"** (baralho e placar) |
| — | tela **CICLO COMPLETO** (cartas usadas 20/20, acertos, erros, puladas, pontuação, recorde) e **NOVO BARALHO** |

Pontuação padrão (`config.js → GAME.scoring`): acerto **+100**; bônus de tempo
**+100 até 5 s**, caindo até 0 em 40 s; erro **−20**; mínimo 0.

## 9. Publicar no GitHub Pages

1. No GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**.
2. Escolha a branch e a pasta **/ (root)** → **Save**.
3. Em 1–2 minutos o app estará em `https://<usuário>.github.io/inclusiappar/`.

Ao publicar mudanças grandes, aumente `VERSION` em `inclusiapp/sw.js` para
renovar o cache dos visitantes.

## 10. Testes

```bash
npm test                         # 24 testes de unidade: baralho, pontuação, regras
python3 tests/make_frames.py     # (opcional) regera as fotos sintéticas de teste
node tests/e2e/recognition.mjs   # reconhecimento real de páginas e cartas
npm run test:e2e                 # 54 verificações ponta a ponta no Chromium
```

Os testes ponta a ponta usam uma **câmera falsa** (`tests/e2e/fakeCamera.js`) que
entrega ao app um `MediaStream` real com as fotos de teste, então todo o caminho
(câmera → MindAR → 3D → LIBRAS) é exercitado. Eles verificam: os 5 alvos com o
animal e o vídeo corretos, chroma key, LIBRAS ON/OFF, Modo Página/Interação, girar,
pinça, duplo toque, câmera desligada ao sair, mensagens de câmera negada/ocupada/
inexistente, acerto, erro, penalidade, Pular, 20 cartas sem repetição, ciclo
completo, novo baralho, e as telas em celular, paisagem, tablet e desktop
(capturas em `test-results/`).

## 11. Compatibilidade e desempenho

- **Android** (Chrome) e **iPhone/iPad** (Safari, iOS 15+); desktop com webcam.
- Sem dependência de CDN: bibliotecas e fontes ficam no próprio site.
- Carregamento sob demanda: a biblioteca de AR é preparada enquanto a pessoa lê
  as instruções; cada modelo 3D (75–390 KB) só é baixado quando a página aparece;
  os alvos vêm comprimidos (páginas 1,5 MB, cartas 2,5 MB).
- Um único contexto WebGL reaproveitado; resolução limitada a 2× em telas densas;
  o rastreamento pausa no Modo Interação e com o app em segundo plano.
- Acessibilidade: textos para leitores de tela, foco visível, alvos de toque
  grandes, "reduzir movimento" respeitado, retorno visual de todo som.

## 12. Problemas comuns

| Sintoma | Solução |
|---|---|
| "Precisamos acessar sua câmera" | permita a câmera: Android — cadeado 🔒 → Permissões; iPhone — **aA** → Ajustes do Site |
| Câmera não abre | use `https://`; feche apps que usam a câmera; abra no Chrome/Safari (não dentro do Instagram/WhatsApp) |
| Página não reconhecida | ~30 cm de distância, página inteira no quadro, boa iluminação, sem reflexo |
| Carta nova não é reconhecida | rode `npm run targets` (ou `tools/compile-targets.html`) e publique os arquivos gerados |

## 13. Créditos e licenças

- Ilustrações, cartas, vídeos e modelos: projeto **SinalizaAção: Animais em Voga** / InclusiVR.
- [MindAR](https://github.com/hiukim/mind-ar-js) 1.2.5 — MIT.
- [Three.js](https://threejs.org/) r160 — MIT.
- Fontes [Baloo 2](https://fonts.google.com/specimen/Baloo+2) e [Nunito](https://fonts.google.com/specimen/Nunito) — SIL Open Font License.
