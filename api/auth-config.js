module.exports = function handler(_request, response) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabasePublishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY;

  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!supabaseUrl || !supabasePublishableKey) {
    return response.status(503).json({
      configured: false,
      message: 'A autenticação ainda não foi configurada neste ambiente.'
    });
  }

  return response.status(200).json({
    configured: true,
    supabaseUrl,
    supabasePublishableKey
  });
};
