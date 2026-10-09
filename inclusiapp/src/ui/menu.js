/**
 * Menu principal: links externos (vindos de config.js) e o botão
 * "Instalar o aplicativo" quando o navegador permite (Android/desktop).
 */
import { APP } from '../config.js';

export function setupMenu(screen) {
  const store = screen.querySelector('[data-link="store"]');
  const site = screen.querySelector('[data-link="site"]');
  store.href = APP.links.store;
  site.href = APP.links.site;

  const install = screen.querySelector('[data-action="install"]');
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    install.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    install.hidden = true;
    deferred = null;
  });
  install.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } finally {
      deferred = null;
      install.hidden = true;
    }
  });

  return {
    enter() {
      screen.querySelector('.menu')?.classList.remove('is-entering');
      requestAnimationFrame(() => screen.querySelector('.menu')?.classList.add('is-entering'));
    },
  };
}
