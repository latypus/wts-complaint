const Busboy = require('busboy');
const { Resend } = require('resend');

/* ── Parse multipart/form-data from a Netlify Function event ── */
function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType =
      event.headers['content-type'] || event.headers['Content-Type'] || '';

    const bb = Busboy({ headers: { 'content-type': contentType } });
    const fields = {};
    const files  = [];

    bb.on('field', (name, val) => { fields[name] = val; });

    bb.on('file', (name, stream, info) => {
      const chunks = [];
      stream.on('data',  d => chunks.push(d));
      stream.on('close', () => {
        const buf = Buffer.concat(chunks);
        if (info.filename && buf.length > 0) {
          files.push({ filename: info.filename, mimeType: info.mimeType, data: buf });
        }
      });
    });

    bb.on('close', () => resolve({ fields, files }));
    bb.on('error', reject);

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body || '');

    bb.write(body);
    bb.end();
  });
}

/* ── Build HTML email body ── */
function buildHtml(f) {
  const row = (label, value) => {
    if (!value || !String(value).trim()) return '';
    const safe = String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return `<tr>
      <td style="padding:8px 14px;font-weight:600;white-space:nowrap;
                 background:#f3f4f6;border:1px solid #e5e7eb;
                 vertical-align:top;color:#374151">${label}</td>
      <td style="padding:8px 14px;border:1px solid #e5e7eb;
                 color:#1f2937">${safe}</td>
    </tr>`;
  };

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                   color:#1f2937;max-width:640px;margin:0 auto;padding:16px">
  <h2 style="color:#1a6b3c;margin-bottom:4px">Waste Transfer Station Feedback</h2>
  <p style="color:#6b7280;font-size:14px;margin-top:0">
    Submitted via the EJ Coalition feedback form
  </p>
  <table style="border-collapse:collapse;width:100%;margin-top:16px">
    ${row('Name',           f.name)}
    ${row('Email',          f.email)}
    ${row('Address',        f.address)}
    ${row('Ward',           f.ward)}
    ${row('Phone',          f.phone)}
    ${row('Feedback Type', f.feedback_type)}
    ${row('Subject',        f.subject)}
    ${row('Details',        f.details)}
  </table>
</body></html>`;
}

/* ── Handler ── */
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false }) };
  }

  try {
    const { fields, files } = await parseMultipart(event);

    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from:    'WTS Feedback Form <wtsfeedback@ejcoalitionevanston.org>',
      to:      ['ejcoalitionwts@gmail.com'],
      cc:      fields.email ? [fields.email] : undefined,
      replyTo: fields.email || undefined,
      subject: fields.subject || 'Waste Transfer Station Feedback',
      html:    buildHtml(fields),
      attachments: files.map(f => ({
        filename: f.filename,
        content:  f.data,
      })),
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('submit error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, message: 'Failed to send. Please try again.' }),
    };
  }
};
