import fs from 'node:fs';
let buf = fs.readFileSync('shared/youtube.js');
/* strip a stray UTF-8 BOM if present */
if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) buf = buf.subarray(3);
let text = buf.toString('utf8');
/* repair the corrupted first line from the PowerShell round-trip */
if (text.startsWith('---')) text = text.slice(3);
fs.writeFileSync('shared/youtube.js', text, 'utf8');
console.log('first bytes:', [...fs.readFileSync('shared/youtube.js').subarray(0, 20)].map((b) => b.toString(16).padStart(2, '0')).join(' '));
