// @ts-check

import { append, element } from '../dom.js';

/**
 * Modal primitives for new flows. `openLegacy` is a temporary adapter for the
 * original operation forms; new code must use `open` with DOM nodes.
 * @param {{ root?: HTMLElement, onClose?: () => void }} [options]
 */
export function createModalService(options = {}) {
  const root = options.root || document.body;

  function close() {
    root.querySelector('.doti-modal')?.remove();
    options.onClose?.();
  }

  /**
   * @param {{ title: string, body: Node, submitLabel?: string, onSubmit: (form: HTMLFormElement) => unknown, afterOpen?: (form: HTMLFormElement) => void }} config
   */
  function open(config) {
    close();
    const modal = element('div', { className: 'doti-modal' });
    const form = element('form');
    const header = element('header');
    const title = element('h2', { text: config.title });
    const closeButton = element('button', {
      className: 'modal-close',
      text: '×',
      attributes: { type: 'button', 'aria-label': 'Fechar' }
    });
    const body = element('div', { className: 'modal-body' }, config.body);
    const footer = element('footer');
    const cancel = element('button', { className: 'cancel', text: 'Cancelar', attributes: { type: 'button' } });
    const submit = element('button', { className: 'primary-btn', text: config.submitLabel || 'Salvar', attributes: { type: 'submit' } });
    append(header, title, closeButton);
    append(footer, cancel, submit);
    append(form, header, body, footer);
    modal.append(form);
    root.append(modal);

    closeButton.addEventListener('click', close);
    cancel.addEventListener('click', close);
    modal.addEventListener('click', /** @param {MouseEvent} event */ event => { if (event.target === modal) close(); });
    form.addEventListener('submit', /** @param {SubmitEvent} event */ event => {
      event.preventDefault();
      if (config.onSubmit(form) !== false) close();
    });
    config.afterOpen?.(form);
    /** @type {HTMLElement | null} */ (form.querySelector('input:not([type="checkbox"])'))?.focus();
    return { modal, form, close };
  }

  /**
   * Compatibility bridge while the existing operation forms are migrated.
   * @param {{ title: string, bodyHtml: string, submitLabel?: string, onSubmit: (form: HTMLFormElement) => unknown, afterOpen?: (form: HTMLFormElement) => void }} config
   */
  function openLegacy(config) {
    const template = document.createElement('template');
    template.innerHTML = config.bodyHtml;
    return open({ ...config, body: template.content });
  }

  /** @param {{ title: string, message: string, confirmLabel?: string, onConfirm: () => void }} config */
  function confirm(config) {
    const layer = element('div', { className: 'confirm-layer' });
    const card = element('div');
    const icon = element('span', { className: 'confirm-icon', text: '!' });
    const title = element('h3', { text: config.title });
    const message = element('p', { text: config.message });
    const footer = element('footer');
    const cancel = element('button', { className: 'outline-btn', text: 'Cancelar', attributes: { type: 'button' } });
    const confirmButton = element('button', { className: 'danger-btn', text: config.confirmLabel || 'Confirmar exclusão', attributes: { type: 'button' } });
    append(footer, cancel, confirmButton);
    append(card, icon, title, message, footer);
    layer.append(card);
    (root.querySelector('.doti-modal') || root).append(layer);
    cancel.addEventListener('click', () => layer.remove());
    confirmButton.addEventListener('click', () => {
      layer.remove();
      config.onConfirm();
    });
    return layer;
  }

  return { open, openLegacy, confirm, close };
}
