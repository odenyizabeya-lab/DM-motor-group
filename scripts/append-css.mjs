/* Append the video-only / stability CSS to styles.css (UTF-8 safe). */
import fs from 'node:fs';
const add = fs.readFileSync('public/_video-css.txt', 'utf8');
let css = fs.readFileSync('public/styles.css', 'utf8');
if (!css.includes('.videoshow{')) {
  css = css.replace(/\n+$/, '\n') + add;
  fs.writeFileSync('public/styles.css', css);
  console.log('appended video-only CSS');
} else {
  console.log('already present - nothing to do');
}
fs.unlinkSync('public/_video-css.txt');
console.log('styles.css length:', fs.readFileSync('public/styles.css', 'utf8').length);
