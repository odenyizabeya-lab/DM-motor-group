import fs from 'node:fs';
const css = `

/* ======================================================================
   DM MOTOR GROUP — CUSTOMER COMMUNICATION ROOM
   A full, luxurious messaging surface (WhatsApp-grade usability,
   dealership-grade design). Champagne-gold on deep black.
   ====================================================================== */
body.chat-open{overflow:hidden}

.chat-room{position:fixed;inset:0;z-index:400;display:none}
.chat-room.open{display:block}
.chat-backdrop{position:absolute;inset:0;background:rgba(3,4,6,.72);backdrop-filter:blur(6px);animation:chatFadeIn .28s ease}
@keyframes chatFadeIn{from{opacity:0}to{opacity:1}}

.chat-panel{position:absolute;inset:auto 0 0 0;height:min(96dvh,940px);max-width:1040px;margin:0 auto;
  display:flex;flex-direction:column;background:
    radial-gradient(140% 90% at 50% -10%,rgba(201,164,92,.10),transparent 55%),
    linear-gradient(180deg,#10141a 0%,#0c0f14 100%);
  border:1px solid rgba(201,164,92,.38);border-bottom:0;border-radius:22px 22px 0 0;overflow:hidden;
  box-shadow:0 -18px 70px rgba(0,0,0,.65);animation:chatSlideUp .34s cubic-bezier(.22,1.2,.36,1)}
@media(min-width:860px){.chat-panel{inset:4vh auto auto 0;left:50%;transform:translateX(-50%);height:90vh;border-radius:22px;border-bottom:1px solid rgba(201,164,92,.38)}}
@keyframes chatSlideUp{from{transform:translate(-50%,60px);opacity:0}to{transform:translate(-50%,0);opacity:1}}

.chat-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:14px 18px;border-bottom:1px solid rgba(201,164,92,.28);
  background:linear-gradient(180deg,rgba(201,164,92,.10),transparent)}
.chat-id{display:flex;align-items:center;gap:12px;min-width:0}
.chat-avatar{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;flex:none;
  background:radial-gradient(circle at 35% 30%,#2a2417,#16110a 70%);border:1.5px solid rgba(201,164,92,.6);box-shadow:0 0 0 3px rgba(201,164,92,.08)}
.chat-avatar img{width:26px;height:26px}
.chat-id-text{min-width:0}
.chat-id-text b{display:block;font-size:15.5px;letter-spacing:.6px;color:var(--ink);font-family:var(--serif)}
.chat-id-text span{display:block;font-size:11.5px;color:#8fae93;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:58vw}
.chat-head-actions{display:flex;gap:8px;flex:none}

.chat-iconbtn{width:38px;height:38px;border-radius:11px;border:1px solid var(--line2);background:rgba(255,255,255,.02);
  color:var(--gold2);display:inline-grid;place-items:center;cursor:pointer;transition:.18s}
.chat-iconbtn:hover{border-color:rgba(201,164,92,.55);background:rgba(201,164,92,.08)}
.chat-iconbtn svg{width:19px;height:19px}
.chat-iconbtn:disabled{opacity:.45;cursor:wait}

.chat-vehicle{display:flex;align-items:center;gap:10px;padding:8px 18px;border-bottom:1px solid rgba(255,255,255,.05);
  background:rgba(201,164,92,.05);font-size:12px}
.chat-vehicle-k{letter-spacing:2px;text-transform:uppercase;font-size:9.5px;color:var(--ink-faint);flex:none}
.chat-vehicle b{color:var(--gold2);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.chat-human-note{margin:10px 16px 0;padding:9px 13px;border-radius:10px;font-size:12px;line-height:1.5;
  color:#e8d9a3;background:rgba(201,164,92,.14);border:1px solid rgba(201,164,92,.4)}

/* conversation surface - subtle diamond lattice, DM black/gold */
.chat-body{flex:1;overflow-y:auto;padding:16px 18px 10px;display:flex;flex-direction:column;gap:8px;
  background-color:#0b0d10;
  background-image:
    radial-gradient(circle at 12% -6%,rgba(201,164,92,.06),transparent 34%),
    radial-gradient(circle at 88% 108%,rgba(201,164,92,.05),transparent 36%),
    repeating-linear-gradient(45deg,rgba(201,164,92,.025) 0 2px,transparent 2px 22px),
    repeating-linear-gradient(-45deg,rgba(201,164,92,.025) 0 2px,transparent 2px 22px);
  scroll-behavior:smooth}

.chat-day{align-self:center;font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:#9a937c;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);padding:4px 14px;border-radius:99px;margin:4px 0}

.chat-row{display:flex;max-width:100%}
.chat-row.mine{justify-content:flex-end}
.chat-row.theirs{justify-content:flex-start}

.chat-bubble{max-width:78%;border-radius:16px;padding:10px 12px 6px;font-size:14px;line-height:1.55;position:relative;
  box-shadow:0 2px 10px rgba(0,0,0,.35)}
.chat-bubble p{margin:0;white-space:pre-wrap;word-wrap:break-word}
.chat-bubble.mine{
  background:linear-gradient(160deg,#2b2413 0%,#221d10 55%,#1d1a0f 100%);
  border:1px solid rgba(201,164,92,.5);border-bottom-right-radius:4px;color:#f3ead2}
.chat-bubble.theirs{
  background:linear-gradient(165deg,#171b22 0%,#12151b 100%);
  border:1px solid rgba(255,255,255,.09);border-bottom-left-radius:4px;color:#e9e7dd}
.chat-bubble.error{border-color:rgba(255,107,94,.5)}

.chat-attach{display:block;margin:2px 0 6px}
.chat-attach img{max-width:250px;max-height:250px;border-radius:11px;display:block;border:1px solid rgba(255,255,255,.1)}
.chat-attach.vid{max-width:280px;max-height:320px;border-radius:11px;background:#000}

.chat-meta{display:flex;align-items:center;gap:7px;justify-content:flex-end;margin-top:4px}
.chat-meta time{font-size:10.5px;color:#8f8b7d}
.chat-ticks{display:inline-flex;color:#a9a488}
.chat-ticks.on{color:#e3c878}

.chat-retry-msg{background:none;border:none;color:#e3c878;font-size:11px;cursor:pointer;padding:2px 0}

/* skeleton */
.chat-skeleton{display:flex;flex-direction:column;gap:10px;padding:12px}
.chat-skeleton span{height:52px;border-radius:14px;background:linear-gradient(100deg,#14181e 30%,#1b2027 45%,#14181e 60%);background-size:200% 100%;animation:skel 1.3s infinite linear}

/* error card */
.chat-error{margin:auto;max-width:340px;text-align:center;border:1px solid rgba(255,255,255,.1);
  border-radius:16px;padding:26px 20px;background:rgba(255,255,255,.02)}
.chat-error b{color:#e9e7dd}
.chat-error p{color:#a9a794;font-size:13px;margin:10px 0 14px}
.chat-error.inline{margin:8px 0 0;max-width:100%}
.chat-error.inline b{font-size:12.5px}

/* composer */
.chat-composer{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid rgba(201,164,92,.25);
  background:linear-gradient(180deg,rgba(255,255,255,.02),transparent)}
.chat-composer .attach{width:42px;height:42px;flex:none}
#chatText{flex:1;min-width:0;resize:none;max-height:140px;background:#12161c;border:1px solid rgba(255,255,255,.1);
  border-radius:15px;padding:11px 14px;color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.45}
#chatText:focus{outline:none;border-color:rgba(201,164,92,.55);box-shadow:0 0 0 3px rgba(201,164,92,.12)}
.chat-send{width:46px;height:46px;flex:none;border-radius:50%;border:none;cursor:pointer;
  background:linear-gradient(140deg,#e3c878 0%,#c9a45c 55%,#a67c3f 100%);color:#241c08;
  display:grid;place-items:center;box-shadow:0 6px 18px -6px rgba(201,164,92,.5);transition:.18s}
.chat-send:hover{transform:translateY(-1px);box-shadow:0 9px 22px -6px rgba(201,164,92,.6)}
.chat-send:disabled{opacity:.5;cursor:wait}
.chat-send svg{width:21px;height:21px;margin-left:2px}

/* attachment previews */
.chat-previews{display:flex;gap:10px;padding:8px 14px;border-top:1px solid rgba(255,255,255,.05);overflow-x:auto;background:rgba(0,0,0,.25)}
.chat-preview{position:relative;flex:none;width:76px;height:76px;border-radius:12px;overflow:hidden;
  border:1px solid rgba(201,164,92,.4)}
.chat-preview img{width:100%;height:100%;object-fit:cover;display:block}
.chat-preview-file{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:100%;
  background:linear-gradient(160deg,#1a1f27,#12151b);color:var(--gold2)}
.chat-preview-ico{font-size:10px;letter-spacing:1px;border:1px solid rgba(201,164,92,.5);border-radius:5px;padding:2px 5px}
.chat-preview-file small{font-size:9.5px;color:#a9a794;max-width:66px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-preview-remove{position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;
  background:rgba(5,6,8,.78);color:#fff;border:none;cursor:pointer;font-size:13px;line-height:1}

.chat-legal{margin:0;padding:7px 18px 10px;font-size:9.5px;color:#6f6c60;text-align:center;letter-spacing:.3px}

@media(max-width:560px){
  .chat-panel{height:100dvh;max-width:none;border-radius:0;border:none}
  .chat-bubble{max-width:88%}
  .chat-id-text span{max-width:44vw}
  .chat-head{padding:12px 12px}
}

/* the pseudo gold button used for the chat CTA inside CTAs */
.btn-wa{display:none}
`;
const cur = fs.readFileSync('public/styles.css', 'utf8');
if (cur.includes('.chat-panel{')) { console.log('chat css already present'); process.exit(0); }
fs.appendFileSync('public/styles.css', css, 'utf8');
console.log('appended chat css, total bytes:', cur.length + css.length);
