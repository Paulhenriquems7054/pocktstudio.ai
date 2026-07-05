export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { model, payload } = req.body || {};

    if (!model) {
      return res.status(400).json({ error: 'Modelo Gemini não informado.' });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.VITE_GOOGLE_GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: 'Chave da API do Gemini não configurada no Vercel.',
        hint: 'Adicione GEMINI_API_KEY nas Environment Variables do projeto e faça um novo deploy.'
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    const rawText = await response.text();
    let data = {};

    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Falha na chamada ao Gemini.',
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: 'Erro interno no proxy do Gemini.',
      message: error.message
    });
  }
}
