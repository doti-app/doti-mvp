import { createApplication } from './application.js';

const application = createApplication();
void application.start();

window.addEventListener('pagehide', () => {
  void application.stop();
}, { once: true });
