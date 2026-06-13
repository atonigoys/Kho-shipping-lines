module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType } = req.body || {};

  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: 'Missing imageBase64 or mediaType' });
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(mediaType)) {
    return res.status(400).json({ error: 'Unsupported image type' });
  }

  try {
    const dataUrl = `data:${mediaType};base64,${imageBase64}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: dataUrl }
            },
            {
              type: 'text',
              text: `You are an ID verification assistant for a Philippine ferry company. Analyze this image and respond ONLY with a valid JSON object — no markdown, no explanation, no extra text.

Format: {"idType":"<type>","isLegit":<true|false>,"confidence":"<low|medium|high>"}

idType must be exactly one of:
- "Student ID"
- "PWD ID"
- "Driver's License"
- "Passport"
- "Senior Citizen ID"
- "Government ID"
- "Not an ID"

isLegit: true if the document appears genuine and unaltered; false if it looks suspicious, edited, blurry beyond recognition, or is not a real ID.
confidence: your confidence level.

Respond with ONLY the JSON object.`
            }
          ]
        }]
      })
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('Groq error:', err);
      return res.status(502).json({ error: 'Groq API error', detail: err });
    }

    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      const match = text.match(/\{[^}]+\}/);
      result = match ? JSON.parse(match[0]) : { idType: 'Unknown', isLegit: false, confidence: 'low' };
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('scan-id error:', err.message);
    return res.status(500).json({ error: 'Scan failed', detail: err.message });
  }
};
