import fs from 'node:fs';
const css = `
/* ---------------- customer messaging thread ---------------- */
.msg-thread{display:flex;flex-direction:column;gap:10px;max-height:46vh;overflow-y:auto;padding:14px;background:var(--panel2);border:1px solid var(--line);border-radius:14px;margin:12px 0}
.msg{max-width:82%;border-radius:14px;padding:10px 13px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word}
.msg.theirs{align-self:flex-start;background:#141820;border:1px solid var(--line2);color:var(--ink);border-bottom-left-radius:4px}
.msg.mine{align-self:flex-end;background:linear-gradient(160deg,#2b2413,#1f1a0e);border:1px solid rgba(201,164,92,.45);color:#f3ead2;border-bottom-right-radius:4px}
.msg .mt{display:block;font-size:10px;color:var(--dim);margin-top:6px}
.msg.mine .mt{color:#b8a86f}
.msg-attach{max-width:180px;max-height:180px;border-radius:10px;display:block;margin:6px 0;border:1px solid var(--line)}
.msg-attach.vid{max-width:240px;max-height:240px;background:#000}
.conv-flags{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.flag{font-size:10.5px;letter-spacing:1px;text-transform:uppercase;border-radius:99px;padding:3px 10px;border:1px solid var(--line2);color:var(--dim)}
.flag.gold{border-color:rgba(201,164,92,.55);color:var(--gold2)}
.flag.red{border-color:rgba(192,57,43,.6);color:#ffb3a8}
.flag.green{border-color:rgba(61,157,107,.55);color:#8fd8b4}
.msg-adminbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
`;
fs.appendFileSync('admin/admin.css', css, 'utf8');
console.log('admin css appended', fs.readFileSync('admin/admin.css','utf8').length);
