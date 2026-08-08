// @ts-check

import { createModalService } from '../../../shared/ui/modal-service.js';
import { createApprovalStore } from '../infrastructure/approval-store.js';

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

/** @param {string} value */
function formatDate(value) {
  if (!value) return 'Sem prazo';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

/** @param {string} value */
function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/** @param {number} bytes */
function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** @param {string} value */
function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * @param {{ auth: any, document?: Document, notify?: (title: string, message: string, icon?: string) => void }} dependencies
 */
export function createApprovalDomain({ auth, document: documentRef = globalThis.document, notify = () => {} }) {
  const document = documentRef;
  const store = createApprovalStore(auth);
  const modalService = createModalService();
  const page = document.getElementById('aprovacoes');
  const navItem = document.getElementById('approvalNavItem');
  const list = document.getElementById('approvalQueue');
  const search = document.getElementById('approvalSearch');
  const refreshButton = document.getElementById('refreshApprovals');
  const isClient = auth.profile.role === 'client';
  let state = { items: [], role: auth.profile.role, canDecide: false };
  let loading = false;

  function activatePage() {
    document.querySelectorAll('.page').forEach(item => item.classList.toggle('active', item === page));
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item === navItem);
    });
    history.replaceState(null, '', '#aprovacoes');
  }

  function activateClientPortal() {
    document.documentElement.classList.remove('operation-pending');
    document.body.classList.add('client-portal-access');
    document.body.dataset.userRole = 'client';
    const title = document.querySelector('.approvals-page-title h1');
    const subtitle = document.querySelector('.approvals-page-title p:last-child');
    if (title) title.textContent = 'Minhas aprovações';
    if (subtitle) subtitle.textContent = 'Revise o que foi enviado para você e registre sua decisão.';
    activatePage();
  }

  function renderMetrics(items) {
    const clients = new Set(items.map(item => item.clientId)).size;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = items.filter(item => item.due && new Date(`${String(item.due).slice(0, 10)}T23:59:59`) < today).length;
    document.getElementById('approvalPendingMetric').textContent = String(items.length);
    document.getElementById('approvalClientMetric').textContent = String(isClient ? Math.min(clients, 1) : clients);
    document.getElementById('approvalOverdueMetric').textContent = String(overdue);
    document.getElementById('approvalNavCount').textContent = items.length ? String(items.length) : '';
  }

  function filteredItems() {
    const filter = normalized(search?.value || '');
    if (!filter) return state.items;
    return state.items.filter(item => normalized([
      item.clientName,
      item.projectName,
      item.deliverableName,
      item.stepName,
      item.category
    ].join(' ')).includes(filter));
  }

  function renderQueue() {
    const items = filteredItems();
    renderMetrics(state.items);
    if (!items.length) {
      list.innerHTML = `<div class="approval-empty"><span>✓</span><strong>${state.items.length ? 'Nenhuma aprovação encontrada' : 'Tudo em dia por aqui'}</strong><p>${state.items.length ? 'Tente outro termo de busca.' : 'Não há demandas aguardando uma decisão neste momento.'}</p></div>`;
      return;
    }
    list.innerHTML = items.map(item => `
      <article class="approval-card" data-approval-id="${escapeHtml(item.deliverableId)}">
        <header>
          <span class="tag ${escapeHtml(item.color || 'site')}">${escapeHtml(item.category)}</span>
          <time class="${item.due && new Date(`${String(item.due).slice(0, 10)}T23:59:59`) < new Date() ? 'late' : ''}">◷ ${formatDate(item.due)}</time>
        </header>
        <small>${escapeHtml(item.clientName)} · ${escapeHtml(item.projectName)}</small>
        <h2>${escapeHtml(item.deliverableName)}</h2>
        <div class="approval-stage"><span>AGUARDANDO SUA AÇÃO</span><strong>${escapeHtml(item.stepName)}</strong></div>
        <p>${escapeHtml(item.note || 'Abra para consultar os materiais e registrar a decisão.')}</p>
        <footer><span>${item.attachments?.length || 0} arquivo(s) · ${item.links?.length || 0} link(s)</span><button type="button">Revisar →</button></footer>
      </article>`).join('');
    list.querySelectorAll('[data-approval-id]').forEach(card => {
      card.addEventListener('click', () => openApproval(card.dataset.approvalId));
    });
  }

  function renderAttachments(item) {
    if (!item.attachments?.length) return '<p class="approval-inline-empty">Nenhum arquivo foi anexado a este entregável.</p>';
    return item.attachments.map(attachment => `
      <button type="button" class="approval-attachment" data-approval-file="${escapeHtml(attachment.id)}">
        <span>${String(attachment.type || '').startsWith('image/') ? 'IMG' : String(attachment.type || '').includes('pdf') ? 'PDF' : 'ARQ'}</span>
        <div><strong>${escapeHtml(attachment.name)}</strong><small>${formatFileSize(Number(attachment.size || 0))}${attachment.stepName ? ` · ${escapeHtml(attachment.stepName)}` : ''}</small></div>
        <b>↓</b>
      </button>`).join('');
  }

  function renderLinks(item) {
    if (!item.links?.length) return '';
    return `<div class="approval-links">${item.links.map(link => `
      <a href="${escapeHtml(link.href || link.url)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(link.label || link.href || link.url)}</a>`).join('')}</div>`;
  }

  function renderHistory(item) {
    if (!item.history?.length) return '<p class="approval-inline-empty">Esta é a primeira decisão deste entregável.</p>';
    return `<div class="approval-history">${item.history.map(decision => `
      <article class="${decision.decision}">
        <i>${decision.decision === 'approved' ? '✓' : '!'}</i>
        <div><strong>${decision.decision === 'approved' ? 'Aprovado' : 'Ajustes solicitados'}</strong><small>${escapeHtml(decision.decidedBy)} · ${formatDateTime(decision.decidedAt)}</small>${decision.comment ? `<p>${escapeHtml(decision.comment)}</p>` : ''}</div>
      </article>`).join('')}</div>`;
  }

  async function downloadAttachment(item, attachmentId, button) {
    const attachment = item.attachments.find(file => file.id === attachmentId);
    if (!attachment) return;
    button.disabled = true;
    try {
      const blob = await store.download(attachment);
      if (!blob) {
        notify('Arquivo indisponível', 'Este arquivo não está disponível no modo local.', '!');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name || 'arquivo';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify('Não foi possível baixar', error.message, '!');
    } finally {
      button.disabled = false;
    }
  }

  async function decide(item, decision, form, close) {
    const comment = String(form.elements.namedItem('comment')?.value || '').trim();
    const status = form.querySelector('[data-approval-status]');
    if (decision === 'rejected' && !comment) {
      status.textContent = 'Explique os ajustes necessários antes de reprovar.';
      form.elements.namedItem('comment').focus();
      return;
    }
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = decision === 'approved' ? 'Registrando aprovação…' : 'Devolvendo para ajustes…';
    try {
      await store.decide({
        deliverableId: item.deliverableId,
        stepId: item.stepId,
        decision,
        comment
      });
      close();
      notify(
        decision === 'approved' ? 'Aprovação registrada' : 'Ajustes solicitados',
        decision === 'approved'
          ? 'A demanda avançou para a próxima etapa.'
          : 'A demanda voltou para a etapa anterior.',
        decision === 'approved' ? '✓' : '!'
      );
      await load();
    } catch (error) {
      status.textContent = error.message;
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function openApproval(deliverableId) {
    const item = state.items.find(entry => entry.deliverableId === deliverableId);
    if (!item) return;
    const bodyHtml = `
      <div class="approval-modal-context"><span class="tag ${escapeHtml(item.color || 'site')}">${escapeHtml(item.category)}</span><strong>${escapeHtml(item.clientName)}</strong><span>${escapeHtml(item.projectName)}</span></div>
      <div class="approval-modal-stage"><small>ETAPA ATUAL</small><h3>${escapeHtml(item.stepName)}</h3><p>Prazo: <strong>${formatDate(item.due)}</strong></p></div>
      <section class="approval-modal-section"><h4>Orientações e observações</h4><p class="approval-note">${escapeHtml(item.note || 'Nenhuma orientação adicional foi informada.')}</p>${renderLinks(item)}</section>
      <section class="approval-modal-section"><h4>Materiais para revisão</h4>${renderAttachments(item)}</section>
      <section class="approval-modal-section"><h4>Histórico de decisões</h4>${renderHistory(item)}</section>
      ${state.canDecide ? `<label class="approval-comment"><span>Comentário <small>obrigatório ao solicitar ajustes</small></span><textarea name="comment" maxlength="2000" rows="4" placeholder="Registre sua avaliação ou descreva os ajustes necessários"></textarea></label><p class="approval-form-status" data-approval-status role="alert"></p>` : '<div class="approval-readonly-note">Seu perfil pode acompanhar esta aprovação, mas somente cliente, proprietário ou administrador podem decidir.</div>'}`;
    const modal = modalService.openLegacy({
      title: item.deliverableName,
      bodyHtml,
      submitLabel: state.canDecide ? 'Aprovar e avançar' : 'Fechar',
      onSubmit(form) {
        if (!state.canDecide) {
          modal.close();
          return false;
        }
        void decide(item, 'approved', form, modal.close);
        return false;
      },
      afterOpen(form) {
        form.classList.add('approval-review-form');
        form.querySelectorAll('[data-approval-file]').forEach(button => {
          button.addEventListener('click', () => void downloadAttachment(item, button.dataset.approvalFile, button));
        });
        if (state.canDecide) {
          const reject = document.createElement('button');
          reject.type = 'button';
          reject.className = 'reject-step-btn';
          reject.textContent = 'Solicitar ajustes';
          reject.addEventListener('click', () => void decide(item, 'rejected', form, modal.close));
          form.querySelector(':scope > footer').insertBefore(reject, form.querySelector(':scope > footer .primary-btn'));
        } else {
          form.querySelector(':scope > footer .cancel').hidden = true;
        }
      }
    });
  }

  async function load() {
    if (loading) return;
    loading = true;
    refreshButton.disabled = true;
    list.innerHTML = '<div class="approval-loading">Carregando aprovações…</div>';
    try {
      state = await store.load();
      state.items ||= [];
      renderQueue();
    } catch (error) {
      list.innerHTML = `<div class="approval-empty error"><span>!</span><strong>Não foi possível carregar</strong><p>${escapeHtml(error.message)}</p></div>`;
    } finally {
      loading = false;
      refreshButton.disabled = false;
    }
  }

  const onNavClick = () => {
    activatePage();
    void load();
  };

  let mounted = false;
  return {
    id: 'approvals',
    async mount() {
      if (mounted) return;
      mounted = true;
      navItem.addEventListener('click', onNavClick);
      search.addEventListener('input', renderQueue);
      refreshButton.addEventListener('click', () => void load());
      if (isClient) activateClientPortal();
      if (isClient || location.hash === '#aprovacoes') {
        activatePage();
        await load();
      }
    },
    unmount() {
      navItem.removeEventListener('click', onNavClick);
      search.removeEventListener('input', renderQueue);
      document.body.classList.remove('client-portal-access');
      modalService.close();
      mounted = false;
    }
  };
}
