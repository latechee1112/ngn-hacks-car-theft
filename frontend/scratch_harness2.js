var e=/(^|[-_ ])ad([-_ ]|$)|advert|sponsor|adsbygoogle/i,t=/modal|popup|overlay|lightbox/i,n=/sidebar/i;function r(e){return`${typeof e.className==`string`?e.className:``} ${e.id||``}`}function i(e){if(e.hidden)return!1;let t=e.getBoundingClientRect();if(t.width===0&&t.height===0)return!1;let n=getComputedStyle(e);return n.display!==`none`&&n.visibility!==`hidden`&&n.opacity!==`0`}function a(t){let n=r(t);return e.test(n)||t.tagName.toLowerCase()===`ins`&&n.includes(`adsbygoogle`)}function o(e){let n=r(e);return t.test(n)||e.getAttribute(`role`)===`dialog`||e.getAttribute(`aria-modal`)===`true`}function ee(e){let t=r(e);return e.tagName.toLowerCase()===`aside`||n.test(t)||e.getAttribute(`role`)===`complementary`}function s(e){let t=getComputedStyle(e).position;return t===`fixed`||t===`sticky`}var c=`data-distill-id`,l=`h1.h2.h3.h4.h5.h6.p.article.section.nav.aside.header.footer.form.input.select.textarea.button.img.picture.svg.video.iframe.[role].[class*="ad" i].[id*="ad" i].[class*="modal" i].[id*="modal" i].[class*="popup" i].[id*="popup" i].[class*="overlay" i].[class*="sidebar" i].[id*="sidebar" i]`.split(`.`).join(`,`),u=/youtube|vimeo|player/i,te=/card.?number|cvv|cvc|expir|credit.?card/i;function d(e){let t=e.tagName.toLowerCase(),n=e.getAttribute(`role`);if(o(e))return`popup`;if(a(e))return`ad`;if(t===`nav`||n===`navigation`)return`nav`;if(ee(e))return`sidebar`;if(t===`article`)return`article`;if(/^h[1-6]$/.test(t))return`heading`;if(t===`form`)return`form`;if(t===`input`||t===`select`||t===`textarea`)return`input`;if(t===`button`||n===`button`||t===`input`&&[`submit`,`button`].includes(e.type))return`button`;if(t===`video`||t===`iframe`&&u.test(e.getAttribute(`src`)||``))return`video`;if(t===`img`||t===`picture`||t===`svg`)return`image`;if(t===`p`)return`paragraph`;if(t===`section`)return`section`;let r=getComputedStyle(e);return r.position===`fixed`||r.position===`sticky`?`sticky`:null}function f(){let e=new Map;document.querySelectorAll(`a[href]`).forEach(t=>{let n=t.parentElement;n&&e.set(n,(e.get(n)||0)+1)});let t=[];return e.forEach((e,n)=>{e>=4&&!n.closest(`nav`)&&t.push(n)}),t}function p(e){return e.getAttribute(`role`)||{nav:`navigation`,header:`banner`,footer:`contentinfo`,main:`main`,aside:`complementary`,button:`button`,form:`form`,img:`img`}[e.tagName.toLowerCase()]||e.tagName.toLowerCase()}function ne(e){let t=e.tagName.toLowerCase();if([`a`,`button`,`input`,`select`,`textarea`,`summary`].includes(t))return!0;let n=e.getAttribute(`role`);if(n&&[`button`,`link`,`checkbox`,`radio`,`tab`,`menuitem`,`switch`].includes(n)||e.hasAttribute(`onclick`))return!0;let r=e.tabIndex;return r!==void 0&&r>=0||getComputedStyle(e).cursor===`pointer`}function m(e){let t=getComputedStyle(e).position;return t===`fixed`||t===`sticky`}function re(e){let t=getComputedStyle(e);return t.animationName!==`none`||t.transitionDuration.split(`,`).some(e=>parseFloat(e)>0)}function ie(e){let t=e.getBoundingClientRect();return{x:Math.round(t.left+window.scrollX),y:Math.round(t.top+window.scrollY),width:Math.round(t.width),height:Math.round(t.height)}}function ae(e){let t=e.replace(/\s+/g,` `).trim();return t.length>300?`${t.slice(0,300)}…`:t}function oe(e){let t=e.id;if(t){let e=document.querySelector(`label[for="${CSS.escape(t)}"]`);if(e)return e.textContent||``}return e.closest(`label`)?.textContent||``}function h(e,t){return ae(t===`input`?oe(e)||e.getAttribute(`placeholder`)||e.getAttribute(`aria-label`)||``:e.innerText??e.textContent??``)}function g(){if(document.querySelector(`input[type="password"]`))return!0;let e=document.querySelectorAll(`input, select, textarea`);for(let t of e){if((t.getAttribute(`autocomplete`)||``).startsWith(`cc-`))return!0;let e=[t.getAttribute(`name`),t.getAttribute(`id`),t.getAttribute(`placeholder`),t.getAttribute(`aria-label`)].filter(Boolean).join(` `);if(te.test(e))return!0}return!1}function _(){let e=0;return document.querySelectorAll(`[${c}]`).forEach(t=>{let n=t.getAttribute(c)?.match(/^ff-(\d+)$/);n&&(e=Math.max(e,parseInt(n[1],10)))}),e+1}function v(e,t,n){let r=e.getAttribute(c);return r||(r=`ff-${n.n++}`,e.setAttribute(c,r)),{id:r,tag:e.tagName.toLowerCase(),role:p(e),textPreview:h(e,t),elementType:t,position:ie(e),isInteractive:ne(e),isFixed:m(e),hasAnimation:re(e),linkCount:e.querySelectorAll(`a`).length}}function y(){let e=new Set,t=[],n={n:_()};return document.querySelectorAll(l).forEach(r=>{if(e.has(r)||!i(r))return;let a=d(r);a&&(e.add(r),t.push(v(r,a,n)))}),f().forEach(r=>{e.has(r)||!i(r)||(e.add(r),t.push(v(r,`link-group`,n)))}),{url:window.location.href,extractedAt:Date.now(),blocks:t,hasSensitiveForms:g()}}var b=new Map;function x(e){if(b.has(e))return;let t=e;b.set(e,{className:t.className,style:t.getAttribute(`style`)||``})}function se(){b.forEach((e,t)=>{let n=t;n.className=e.className,e.style?n.setAttribute(`style`,e.style):n.removeAttribute(`style`)}),b.clear()}var S=`data-distill-simplified`,C=`distill-global-style`,w=`distill-restore-button`,T=`distill-primary-content`,E=`distill-deemphasize`,D=`distill-unstick`,O=`distill-neutral-color`,k=`#1a1a1a`,A=`distill-section-hidden`,j=`distill-progressive-controls`,M=/^h[23]$/i,N=`nav, aside, footer, [role="navigation"], [role="complementary"], [role="contentinfo"], [class*="ad" i], [id*="ad" i], ins, [class*="modal" i], [id*="modal" i], [class*="popup" i], [id*="popup" i], [class*="overlay" i]`;function P(){let e=document.querySelectorAll(`main, article, [role="main"]`),t=null,n=0;return e.forEach(e=>{if(!i(e))return;let r=(e.innerText||``).length;r>n&&(n=r,t=e)}),t}function F(e){return e.filter(t=>!e.some(e=>e!==t&&e.contains(t)))}function I(e){let t=new Set;return document.querySelectorAll(N).forEach(n=>{if(e&&(e===n||e.contains(n))||!i(n))return;if(a(n)||o(n)||[`nav`,`aside`,`footer`].includes(n.tagName.toLowerCase())){t.add(n);return}let r=n.getAttribute(`role`);(r===`navigation`||r===`complementary`||r===`contentinfo`)&&t.add(n)}),document.querySelectorAll(`body > *, header, div, section`).forEach(n=>{t.has(n)||e&&(e===n||e.contains(n))||i(n)&&s(n)&&t.add(n)}),F(Array.from(t))}function L(){document.querySelectorAll(`video[autoplay], audio[autoplay]`).forEach(e=>{x(e),e.pause(),e.removeAttribute(`autoplay`),e.classList.add(E)})}function R(){if(document.getElementById(C))return;let e=document.createElement(`style`);e.id=C,e.textContent=`
html[${S}] body {
  line-height: 1.7 !important;
}
html[${S}] .${T} {
  max-width: 760px !important;
  margin-left: auto !important;
  margin-right: auto !important;
  font-size: 1.15em !important;
  line-height: 1.75 !important;
  float: none !important;
}
html[${S}] .${T} p,
html[${S}] .${T} li {
  margin-bottom: 1.1em !important;
  font-size: 1.05em !important;
}
html[${S}] .${T} h1,
html[${S}] .${T} h2,
html[${S}] .${T} h3 {
  margin-top: 1.4em !important;
  margin-bottom: 0.6em !important;
}
html[${S}] .${E} {
  opacity: 0.4 !important;
  filter: grayscale(60%) !important;
  transition: opacity 0.2s ease !important;
}
html[${S}] .${E}:hover {
  opacity: 0.85 !important;
}
html[${S}] .${E} input,
html[${S}] .${E} button,
html[${S}] .${E} select,
html[${S}] .${E} textarea,
html[${S}] .${E} a[href] {
  opacity: 1 !important;
  filter: none !important;
}
html[${S}] .${D} {
  position: static !important;
}
html[${S}] .${T}.${O},
html[${S}] .${T}.${O} :not(form):not(form *):not(button):not(button *) {
  color: ${k} !important;
}
html[${S}] .${T}.${O} a:not(form a):not(button a) {
  text-decoration: underline !important;
}
#${w} {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2147483647;
  background: #1a1a1a;
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: 10px 18px;
  font: 600 13px system-ui, sans-serif;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}
#${w}:hover {
  opacity: 0.9;
}
html[${S}] .${A} {
  display: none !important;
}
#${j} {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #1a1a1a;
  color: #fff;
  border-radius: 999px;
  padding: 8px 14px;
  font: 600 13px system-ui, sans-serif;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}
#${j} button {
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 2px 6px;
}
#${j} button:disabled {
  opacity: 0.35;
  cursor: default;
}
#${j} button:hover:not(:disabled) {
  opacity: 0.8;
}
#${j} [data-role="label"] {
  opacity: 0.8;
  white-space: nowrap;
}
`,document.head.appendChild(e)}function z(){if(document.getElementById(w))return;let e=document.createElement(`button`);e.id=w,e.type=`button`,e.textContent=`Show original page`,e.addEventListener(`click`,$),document.body.appendChild(e)}function B(){return document.documentElement.getAttribute(S)===`true`}function V(){if(B())return{primaryFound:!!document.querySelector(`.${T}`),deemphasizedCount:document.querySelectorAll(`.${E}`).length};let e=P();e&&(x(e),e.classList.add(T));let t=I(e);return t.forEach(e=>{x(e),e.classList.add(E),s(e)&&e.classList.add(D)}),L(),R(),z(),document.documentElement.setAttribute(S,`true`),{primaryFound:!!e,deemphasizedCount:t.length}}function H(){return document.querySelector(`.${T}`)}function U(){return B()&&!!H()}function W(){return H()?.classList.contains(O)??!1}function G(e){let t=H();return!B()||!t?!1:(x(t),t.classList.toggle(O,e),!0)}var K=[],q=0;function J(e,t=0){if(t>6||Array.from(e.children).filter(e=>M.test(e.tagName)).length>=2)return e;let n=null,r=0;for(let t of Array.from(e.children)){let e=t.querySelectorAll(`h2, h3`).length;e>r&&(r=e,n=t)}return n&&r>=2?J(n,t+1):e}function ce(e){let t=[],n=[];return Array.from(e.children).forEach(e=>{M.test(e.tagName)?(n.length&&t.push(n),n=[e]):n.push(e)}),n.length&&t.push(n),t}function le(){return K.length>0}function Y(){K.forEach((e,t)=>{e.forEach(e=>{x(e),e.classList.remove(E,A),t===q||(t===q+1?e.classList.add(E):e.classList.add(A))})})}function X(){let e=document.getElementById(j);if(!e)return;let t=e.querySelector(`[data-role="label"]`);t&&(t.textContent=`Section ${q+1} of ${K.length}`);let n=e.querySelector(`[data-role="prev"]`),r=e.querySelector(`[data-role="next"]`);n&&(n.disabled=q===0),r&&(r.disabled=q===K.length-1)}function Z(e){q=Math.max(0,Math.min(e,K.length-1)),Y(),X()}function ue(){document.getElementById(j)?.remove()}function de(){if(document.getElementById(j)){X();return}let e=document.createElement(`div`);e.id=j;let t=document.createElement(`button`);t.type=`button`,t.dataset.role=`prev`,t.textContent=`‹ Prev`,t.addEventListener(`click`,()=>Z(q-1));let n=document.createElement(`span`);n.dataset.role=`label`;let r=document.createElement(`button`);r.type=`button`,r.dataset.role=`next`,r.textContent=`Next ›`,r.addEventListener(`click`,()=>Z(q+1));let i=document.createElement(`button`);i.type=`button`,i.dataset.role=`show-all`,i.textContent=`Show All`,i.addEventListener(`click`,Q),e.append(t,n,r,i),document.body.appendChild(e),X()}function fe(){return B()&&!!H()}function pe(){return le()}function me(){let e=H();if(!B()||!e)return{eligible:!1,totalSections:0,currentIndex:0};let t=ce(J(e));return t.filter(e=>M.test(e[0].tagName)).length<2?(K=[],{eligible:!1,totalSections:0,currentIndex:0}):(K=t,q=0,Y(),de(),{eligible:!0,totalSections:K.length,currentIndex:q})}function Q(){K.forEach(e=>{e.forEach(e=>e.classList.remove(E,A))}),K=[],q=0,ue()}function $(){Q(),se(),document.documentElement.removeAttribute(S),document.getElementById(C)?.remove(),document.getElementById(w)?.remove()}window.__ffSimplify = V;
window.__ffEnableProgressive = me;
window.__ffDisableProgressive = Q;
window.__ffRestore = $;
window.__ffGetSections = () => K.map(g => g.map(el => el.tagName + (el.tagName.match(/^H[23]$/) ? ':' + el.textContent.slice(0,40) : '')));
'installed';
