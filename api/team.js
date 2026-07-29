const crypto = require('crypto');

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://znbfxlozwoictznmgsjf.supabase.co';
const SUPABASE_PUBLIC_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'sb_publishable_DlqJcO67Ydae3LbV0gCaQQ__PREHRQN';
const SUPABASE_ADMIN_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_SITE_URL =
  process.env.PUBLIC_SITE_URL ||
  'https://doti-mvp.vercel.app';

const ROLE_LABELS = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador'
};

function json(response, status, body) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  return response.status(status).json(body);
}

function adminHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ADMIN_KEY,
    Authorization: `Bearer ${SUPABASE_ADMIN_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function requestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') {
    try {
      return JSON.parse(request.body);
    } catch (_) {
      return {};
    }
  }
  return {};
}

async function supabaseRequest(path, options = {}) {
  const result = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: adminHeaders(options.headers)
  });
  const body = await result.json().catch(() => null);
  if (!result.ok) {
    const message = body?.msg || body?.message || body?.error_description || 'Falha ao acessar o Supabase.';
    const error = new Error(message);
    error.status = result.status;
    throw error;
  }
  return body;
}

async function requireManager(request) {
  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) {
    const error = new Error('Sessão ausente.');
    error.status = 401;
    throw error;
  }

  const userResult = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLIC_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  const user = await userResult.json().catch(() => null);
  if (!userResult.ok || !user?.id) {
    const error = new Error('Sessão inválida ou expirada.');
    error.status = 401;
    throw error;
  }

  const profiles = await supabaseRequest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,agency_id,email,full_name,agency_name,role,is_active&limit=1`
  );
  const profile = profiles?.[0];
  if (!profile?.is_active || !['owner', 'admin'].includes(profile.role)) {
    const error = new Error('Você não tem permissão para administrar a equipe.');
    error.status = 403;
    throw error;
  }
  return profile;
}

async function listTeam(profile) {
  const agencyId = encodeURIComponent(profile.agency_id);
  const [members, invitations] = await Promise.all([
    supabaseRequest(
      `/rest/v1/profiles?agency_id=eq.${agencyId}&select=id,email,full_name,role,is_active,created_at&order=created_at.asc`
    ),
    supabaseRequest(
      `/rest/v1/team_invitations?agency_id=eq.${agencyId}&status=eq.pending&select=id,email,full_name,role,status,expires_at,created_at&order=created_at.desc`
    )
  ]);
  return { members, invitations, currentUserId: profile.id, currentRole: profile.role };
}

async function createInvitation(request, profile) {
  const body = requestBody(request);
  const email = String(body.email || '').trim().toLowerCase();
  const fullName = String(body.fullName || '').trim();
  const role = String(body.role || 'member');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('Informe um e-mail válido.');
    error.status = 400;
    throw error;
  }
  if (fullName.length < 2 || fullName.length > 120) {
    const error = new Error('Informe o nome completo da pessoa.');
    error.status = 400;
    throw error;
  }
  if (!['admin', 'member', 'viewer'].includes(role)) {
    const error = new Error('Nível de acesso inválido.');
    error.status = 400;
    throw error;
  }
  if (profile.role !== 'owner' && role === 'admin') {
    const error = new Error('Somente o proprietário pode convidar administradores.');
    error.status = 403;
    throw error;
  }

  const existing = await supabaseRequest(
    `/rest/v1/profiles?agency_id=eq.${encodeURIComponent(profile.agency_id)}&email=ilike.${encodeURIComponent(email)}&select=id&limit=1`
  );
  if (existing.length) {
    const error = new Error('Esta pessoa já faz parte da equipe.');
    error.status = 409;
    throw error;
  }

  const invitationId = crypto.randomUUID();
  await supabaseRequest('/rest/v1/team_invitations', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: invitationId,
      agency_id: profile.agency_id,
      email,
      full_name: fullName,
      role,
      invited_by: profile.id
    })
  });

  try {
    await supabaseRequest(
      `/auth/v1/invite?redirect_to=${encodeURIComponent(`${PUBLIC_SITE_URL.replace(/\/$/, '')}/dot-admin/?mode=invite`)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          data: {
            invitation_id: invitationId,
            full_name: fullName,
            agency_name: profile.agency_name,
            role
          }
        })
      }
    );
  } catch (error) {
    await supabaseRequest(
      `/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    ).catch(() => {});
    throw error;
  }

  return {
    message: `Convite enviado para ${email}.`,
    invitation: { id: invitationId, email, full_name: fullName, role }
  };
}

async function updateMember(request, profile) {
  const body = requestBody(request);
  const memberId = String(body.memberId || '');
  const role = body.role == null ? null : String(body.role);
  const isActive = body.isActive == null ? null : Boolean(body.isActive);

  if (!memberId || memberId === profile.id) {
    const error = new Error('Você não pode alterar o próprio acesso.');
    error.status = 400;
    throw error;
  }

  const matches = await supabaseRequest(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}&agency_id=eq.${encodeURIComponent(profile.agency_id)}&select=id,email,role,is_active&limit=1`
  );
  const member = matches?.[0];
  if (!member) {
    const error = new Error('Membro não encontrado.');
    error.status = 404;
    throw error;
  }
  if (member.role === 'owner') {
    const error = new Error('O acesso do proprietário não pode ser alterado.');
    error.status = 403;
    throw error;
  }
  if (profile.role !== 'owner' && (member.role === 'admin' || role === 'admin')) {
    const error = new Error('Somente o proprietário pode alterar administradores.');
    error.status = 403;
    throw error;
  }
  if (role !== null && !['admin', 'member', 'viewer'].includes(role)) {
    const error = new Error('Nível de acesso inválido.');
    error.status = 400;
    throw error;
  }

  const changes = {};
  if (role !== null) changes.role = role;
  if (isActive !== null) changes.is_active = isActive;
  if (!Object.keys(changes).length) {
    const error = new Error('Nenhuma alteração informada.');
    error.status = 400;
    throw error;
  }

  if (isActive !== null) {
    await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(memberId)}`, {
      method: 'PUT',
      body: JSON.stringify({ ban_duration: isActive ? 'none' : '876000h' })
    });
  }

  await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(changes)
  });

  return {
    message: isActive === false
      ? 'Acesso desativado.'
      : isActive === true
        ? 'Acesso reativado.'
        : `Nível alterado para ${ROLE_LABELS[role]}.`
  };
}

module.exports = async function handler(request, response) {
  if (!SUPABASE_ADMIN_KEY) {
    return json(response, 503, {
      error: 'Administração ainda não configurada. Adicione SUPABASE_SECRET_KEY no Vercel.'
    });
  }

  try {
    const profile = await requireManager(request);
    if (request.method === 'GET') {
      return json(response, 200, await listTeam(profile));
    }
    if (request.method === 'POST') {
      return json(response, 201, await createInvitation(request, profile));
    }
    if (request.method === 'PATCH') {
      return json(response, 200, await updateMember(request, profile));
    }
    response.setHeader('Allow', 'GET, POST, PATCH');
    return json(response, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return json(response, error.status || 500, {
      error: error.message || 'Não foi possível administrar a equipe.'
    });
  }
};
