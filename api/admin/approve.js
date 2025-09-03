const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!ADMIN_TOKEN || req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const { error } = await supabase.from('listings').update({ status: 'approved' }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
};
