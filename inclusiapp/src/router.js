/**
 * Navegação entre telas por hash (#/, #/livro, #/livro/ar, #/jogo, #/jogo/jogar).
 *
 * - O botão "voltar" do celular funciona naturalmente (histórico do navegador).
 * - As transições são serializadas: a tela anterior sempre termina de sair
 *   (câmera desligada, recursos liberados) antes da próxima entrar.
 * - Rotas com câmera só abrem depois de um toque em "Começar" (guard):
 *   abrir o link direto (ou recarregar) leva para a tela explicativa.
 */
export class Router {
  /**
   * @param {Record<string, {screen: HTMLElement, enter?: Function, leave?: Function, guard?: Function}>} routes
   */
  constructor(routes, { fallback = '' } = {}) {
    this.routes = routes;
    this.fallback = fallback;
    this.current = null;
    this.queue = Promise.resolve();
    this._onHash = () => this._navigate();
  }

  start() {
    window.addEventListener('hashchange', this._onHash);
    return this._navigate();
  }

  static path() {
    return decodeURIComponent(location.hash.replace(/^#\/?/, '')).replace(/\/$/, '');
  }

  go(path, { replace = false } = {}) {
    const hash = `#/${path}`;
    if (location.hash === hash) return this._navigate();
    if (replace) {
      history.replaceState(null, '', hash);
      return this._navigate();
    }
    location.hash = hash;
    return this.queue;
  }

  _navigate() {
    this.queue = this.queue.then(() => this._switch(Router.path())).catch((err) => console.error('[rota]', err));
    return this.queue;
  }

  async _switch(path) {
    let route = this.routes[path];
    if (!route) {
      history.replaceState(null, '', `#/${this.fallback}`);
      path = this.fallback;
      route = this.routes[path];
    }
    const redirect = route.guard?.();
    if (typeof redirect === 'string' && redirect !== path) {
      history.replaceState(null, '', `#/${redirect}`);
      return this._switch(redirect);
    }
    if (this.current?.path === path) return;

    const previous = this.current;
    if (previous) {
      try {
        await previous.route.leave?.();
      } catch (err) {
        console.error('[rota] erro ao sair', err);
      }
      previous.route.screen.classList.remove('is-active');
      previous.route.screen.hidden = true;
    }
    this.current = { path, route };
    const screen = route.screen;
    screen.hidden = false;
    document.body.dataset.activeScreen = screen.dataset.screen;
    requestAnimationFrame(() => screen.classList.add('is-active'));
    const heading = screen.querySelector('h1, [data-focus]');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    screen.scrollTop = 0;
    // não espera o enter(): carregar a câmera pode demorar, e a pessoa precisa
    // poder voltar ao menu a qualquer momento (o leave() interrompe o enter())
    Promise.resolve().then(() => route.enter?.()).catch((err) => console.error('[rota] erro ao entrar', err));
  }
}
