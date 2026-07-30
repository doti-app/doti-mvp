module.exports = function handler(_request, response) {
  const productionUrl = 'https://awfqgynjgcavjgsqdcbw.supabase.co';
  const productionKey = 'sb_publishable_SPw5VxaBTp0nZzQSfSyz3Q_yoomJyKP';
  const useEnvironment = process.env.SUPABASE_URL === productionUrl;
  const supabaseUrl = productionUrl;
  const supabasePublishableKey = useEnvironment
    ? process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      productionKey
    : productionKey;

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
