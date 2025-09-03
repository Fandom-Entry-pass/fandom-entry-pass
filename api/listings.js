const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const {
        proof, proofName, proofType,
        ...fields
      } = body;
      const id = fields.id || crypto.randomUUID();
      let proofUrl = null;
      if (proof) {
        const buffer = Buffer.from(proof, 'base64');
        const path = `${id}/${proofName || 'proof'}`;
        const { error: uploadErr } = await supabase.storage
          .from('proofs')
          .upload(path, buffer, { contentType: proofType || 'application/octet-stream' });
        if (uploadErr) return res.status(500).json({ error: uploadErr.message });
        const { data: urlData } = supabase.storage.from('proofs').getPublicUrl(path);
        proofUrl = urlData.publicUrl;
      }
      const { error } = await supabase.from('listings').insert([{
        id,
        group: fields.group,
        date: fields.date,
        city: fields.city,
        seat: fields.seat,
        face: fields.face,
        price: fields.price,
        pay: fields.pay,
        seller: fields.seller,
        seller_email: fields.sellerEmail,
        qty: fields.qty,
        remaining: fields.qty,
        edit_token: fields.editToken,
        manage_code: fields.manageCode,
        proof_url: proofUrl,
        status: 'pending'
      }]);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ id, status: 'pending' });
    } catch (e) {
      return res.status(400).json({ error: 'Invalid request' });
    }
  }
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }
  res.status(405).end();
};
