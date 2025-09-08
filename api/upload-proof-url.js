const { json } = require('micro');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }
  try {
    const { filename } = await json(req);
    const ext = (filename || '').split('.').pop() || 'jpg';
    const path = `proofs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { data, error } = await supabase.storage.from('proofs').createSignedUploadUrl(path);
    if (error) throw error;

    const { data: viewData, error: viewError } = await supabase.storage
      .from('proofs')
      .createSignedUrl(path, 60 * 60);
    if (viewError) throw viewError;

    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        uploadUrl: data.signedUrl,
        token: data.token,
        viewUrl: viewData.signedUrl
      })
    );
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
};
