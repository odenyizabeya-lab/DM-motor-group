import fs from 'node:fs';
const add = fs.readFileSync('admin/_video-css.txt', 'utf8');
let css = fs.readFileSync('admin/admin.css', 'utf8');
if (!css.includes('.vitem .vth{')) {
  css = css.replace(/\n+$/, '\n') + add;
  fs.writeFileSync('admin/admin.css', css);
  console.log('appended admin video CSS');
} else console.log('already present');
fs.unlinkSync('admin/_video-css.txt');
console.log('admin.css length:', fs.readFileSync('admin/admin.css', 'utf8').length);
