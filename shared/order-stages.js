/* =====================================================================
   Order stages, reservations and a dependency-free PDF writer.
   Used for:
     - the ten-stage purchase / delivery tracker the customer sees
     - professional invoices and receipts the customer can download
   ===================================================================== */

/* The ten stages a buyer moves through, in order. */
export const ORDER_STAGES = [
  { key: 'enquiry_received', label: 'Enquiry received', customer: 'We have received your enquiry and a member of the sales team is reviewing it.' },
  { key: 'availability_confirmed', label: 'Vehicle availability confirmed', customer: 'The vehicle is confirmed as available and, if you wish, held for you.' },
  { key: 'invoice_issued', label: 'Invoice issued', customer: 'Your invoice has been issued with the exact amount, currency and bank details.' },
  { key: 'payment_awaiting', label: 'Payment awaiting verification', customer: 'We have your transfer and are checking it against our bank account.' },
  { key: 'payment_confirmed', label: 'Payment confirmed', customer: 'Your payment has been verified and confirmed. Your receipt is available to download.' },
  { key: 'preparation', label: 'Vehicle preparation', customer: 'The vehicle is being prepared: service check, detailing and document checks.' },
  { key: 'documentation', label: 'Documentation', customer: 'The purchase agreement, export documents and the vehicle file are being completed.' },
  { key: 'shipping', label: 'Shipping or delivery arranged', customer: 'The carrier, insurance and route have been agreed with you in writing.' },
  { key: 'in_transit', label: 'In transit', customer: 'Your vehicle is on its way. Tracking details and a photograph of the loaded vehicle are on the way to you.' },
  { key: 'delivered', label: 'Delivered', customer: 'The vehicle has been handed over with the keys, documents and the condition check.' },
];
export const stageIndex = (key) => Math.max(0, ORDER_STAGES.findIndex((s) => s.key === key));
export const stageByKey = (key) => ORDER_STAGES.find((s) => s.key === key) || ORDER_STAGES[0];

/* Reservation lifecycle (a reservation is a short pre-contract state). */
export const RESERVATION_STAGES = [
  { key: 'requested', label: 'Reservation requested' },
  { key: 'terms_sent', label: 'Reservation terms sent' },
  { key: 'deposit_awaited', label: 'Deposit awaited' },
  { key: 'deposit_paid', label: 'Deposit received' },
  { key: 'confirmed', label: 'Reservation confirmed' },
  { key: 'declined', label: 'Reservation declined' },
  { key: 'cancelled', label: 'Reservation cancelled' },
  { key: 'completed', label: 'Converted to a sale' },
];
export const reservationStageByKey = (key) => RESERVATION_STAGES.find((s) => s.key === key) || RESERVATION_STAGES[0];
export const RESERVATION_TERMS = [
  'The vehicle is held for you once the deposit has been received and verified in our bank account.',
  'The deposit is part of the purchase price and is applied to the final invoice.',
  'If we cannot deliver the vehicle, or we cancel for any reason on our side, the deposit is refunded in full.',
  'If you cancel inside the refund window stated on the reservation, the deposit is refunded in full; after that window it may be retained against costs already committed to you.',
  'The deposit is non-refundable once the vehicle has been shipped or handed over.',
  'A vehicle carries one live reservation at a time.',
];

/* ------------------------------------------------------------------ PDF */
/* A minimal PDF writer: enough for a clean invoice or receipt with no
 * external library. Text only, Helvetica, A4. */
const PDF_ESC = (s) => String(s == null ? '' : s)
  .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '');

export function buildPdf({ title, subtitle, company, lines, meta }) {
  const rows = [];
  const push = (text, size = 10, bold = false, gap = 16) => rows.push({ text, size, bold, gap });
  push(company?.name || 'DM Motor Group', 18, true, 26);
  if (company?.address) push(company.address, 9, false, 13);
  if (company?.contact) push(company.contact, 9, false, 13);
  push('', 8, false, 10);
  push(title || 'Document', 14, true, 20);
  if (subtitle) push(subtitle, 10, false, 16);
  push('', 8, false, 12);
  if (meta) for (const [k, v] of Object.entries(meta)) push(`${k}: ${v}`, 10, false, 14);
  push('', 8, false, 12);
  for (const l of lines || []) {
    if (typeof l === 'string') push(l, 10, false, 15);
    else push(l.text || '', l.size || 10, !!l.bold, l.gap || 15);
  }

  let y = 792;
  const parts = [];
  for (const r of rows) {
    y -= r.gap;
    if (y < 60) break;
    parts.push(`BT /${r.bold ? 'F2' : 'F1'} ${r.size} Tf 50 ${y} Td (${PDF_ESC(r.text)}) Tj ET`);
  }
  const content = parts.join('\n');

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

export function invoiceNumber(prefix, id, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const n = String(id).padStart(5, '0');
  return `${prefix}-${y}${m}-${n}`;
}
