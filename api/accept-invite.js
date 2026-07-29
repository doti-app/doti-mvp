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

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Método não permitido.' });
  }
  if (!SUPABASE_ADMIN_KEY) {
    return response.status(503).json({ error: 'Administração ainda não configurada.' });
  }

  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return response.status(401).json({ error: 'Sessão ausente.' });

  try {
    const userResult = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: `Bearer ${token}` }
    });
    const user = await userResult.json().catch(() => null);
    if (!userResult.ok || !user?.id) {
      return response.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    const invitationId = user.user_metadata?.invitation_id;
    if (!invitationId) return response.status(200).json({ accepted: true });

    const update = await fetch(
      `${SUPABASE_URL}/rest/v1/team_invitations?id=eq.${encodeURIComponent(invitationId)}&email=ilike.${encodeURIComponent(user.email)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_ADMIN_KEY,
          Authorization: `Bearer ${SUPABASE_ADMIN_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          status: 'accepted',
          accepted_at: new Date().toISOString()
        })
      }
    );
    if (!update.ok) {
      const body = await update.json().catch(() => ({}));
      throw new Error(body.message || 'Não foi possível concluir o convite.');
    }
    return response.status(200).json({ accepted: true });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
};
