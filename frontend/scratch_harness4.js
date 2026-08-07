var e=/(^|[-_ ])ad([-_ ]|$)|advert|sponsor|adsbygoogle/i,t=/modal|popup|overlay|lightbox/i,n=/sidebar/i;function r(e){return`${typeof e.className==`string`?e.className:``} ${e.id||``}`}function i(e){if(e.hidden)return!1;let t=e.getBoundingClientRect();if(t.width===0&&t.height===0)return!1;let n=getComputedStyle(e);return n.display!==`none`&&n.visibility!==`hidden`&&n.opacity!==`0`}function a(t){let n=r(t);return e.test(n)||t.tagName.toLowerCase()===`ins`&&n.includes(`adsbygoogle`)}function o(e){let n=r(e);return t.test(n)||e.getAttribute(`role`)===`dialog`||e.getAttribute(`aria-modal`)===`true`}function ee(e){let t=r(e);return e.tagName.toLowerCase()===`aside`||n.test(t)||e.getAttribute(`role`)===`complementary`}function s(e){let t=getComputedStyle(e).position;return t===`fixed`||t===`sticky`}var c=`data-distill-id`,te=`h1.h2.h3.h4.h5.h6.p.article.section.nav.aside.header.footer.form.input.select.textarea.button.img.picture.svg.video.iframe.[role].[class*="ad" i].[id*="ad" i].[class*="modal" i].[id*="modal" i].[class*="popup" i].[id*="popup" i].[class*="overlay" i].[class*="sidebar" i].[id*="sidebar" i]`.split(`.`).join(`,`),ne=/youtube|vimeo|player/i,re=/card.?number|cvv|cvc|expir|credit.?card/i;function ie(e){let t=e.tagName.toLowerCase(),n=e.getAttribute(`role`);if(o(e))return`popup`;if(a(e))return`ad`;if(t===`nav`||n===`navigation`)return`nav`;if(ee(e))return`sidebar`;if(t===`article`)return`article`;if(/^h[1-6]$/.test(t))return`heading`;if(t===`form`)return`form`;if(t===`input`||t===`select`||t===`textarea`)return`input`;if(t===`button`||n===`button`||t===`input`&&[`submit`,`button`].includes(e.type))return`button`;if(t===`video`||t===`iframe`&&ne.test(e.getAttribute(`src`)||``))return`video`;if(t===`img`||t===`picture`||t===`svg`)return`image`;if(t===`p`)return`paragraph`;if(t===`section`)return`section`;let r=getComputedStyle(e);return r.position===`fixed`||r.position===`sticky`?`sticky`:null}function l(){let e=new Map;document.querySelectorAll(`a[href]`).forEach(t=>{let n=t.parentElement;n&&e.set(n,(e.get(n)||0)+1)});let t=[];return e.forEach((e,n)=>{e>=4&&!n.closest(`nav`)&&t.push(n)}),t}function u(e){return e.getAttribute(`role`)||{nav:`navigation`,header:`banner`,footer:`contentinfo`,main:`main`,aside:`complementary`,button:`button`,form:`form`,img:`img`}[e.tagName.toLowerCase()]||e.tagName.toLowerCase()}function d(e){let t=e.tagName.toLowerCase();if([`a`,`button`,`input`,`select`,`textarea`,`summary`].includes(t))return!0;let n=e.getAttribute(`role`);if(n&&[`button`,`link`,`checkbox`,`radio`,`tab`,`menuitem`,`switch`].includes(n)||e.hasAttribute(`onclick`))return!0;let r=e.tabIndex;return r!==void 0&&r>=0||getComputedStyle(e).cursor===`pointer`}function f(e){let t=getComputedStyle(e).position;return t===`fixed`||t===`sticky`}function p(e){let t=getComputedStyle(e);return t.animationName!==`none`||t.transitionDuration.split(`,`).some(e=>parseFloat(e)>0)}function ae(e){let t=e.getBoundingClientRect();return{x:Math.round(t.left+window.scrollX),y:Math.round(t.top+window.scrollY),width:Math.round(t.width),height:Math.round(t.height)}}function oe(e){let t=e.replace(/\s+/g,` `).trim();return t.length>300?`${t.slice(0,300)}…`:t}function m(e){let t=e.id;if(t){let e=document.querySelector(`label[for="${CSS.escape(t)}"]`);if(e)return e.textContent||``}return e.closest(`label`)?.textContent||``}function h(e,t){return oe(t===`input`?m(e)||e.getAttribute(`placeholder`)||e.getAttribute(`aria-label`)||``:e.innerText??e.textContent??``)}function se(){if(document.querySelector(`input[type="password"]`))return!0;let e=document.querySelectorAll(`input, select, textarea`);for(let t of e){if((t.getAttribute(`autocomplete`)||``).startsWith(`cc-`))return!0;let e=[t.getAttribute(`name`),t.getAttribute(`id`),t.getAttribute(`placeholder`),t.getAttribute(`aria-label`)].filter(Boolean).join(` `);if(re.test(e))return!0}return!1}function g(){let e=0;return document.querySelectorAll(`[${c}]`).forEach(t=>{let n=t.getAttribute(c)?.match(/^ff-(\d+)$/);n&&(e=Math.max(e,parseInt(n[1],10)))}),e+1}function _(e,t,n){let r=e.getAttribute(c);return r||(r=`ff-${n.n++}`,e.setAttribute(c,r)),{id:r,tag:e.tagName.toLowerCase(),role:u(e),textPreview:h(e,t),elementType:t,position:ae(e),isInteractive:d(e),isFixed:f(e),hasAnimation:p(e),linkCount:e.querySelectorAll(`a`).length}}function ce(){let e=new Set,t=[],n={n:g()};return document.querySelectorAll(te).forEach(r=>{if(e.has(r)||!i(r))return;let a=ie(r);a&&(e.add(r),t.push(_(r,a,n)))}),l().forEach(r=>{e.has(r)||!i(r)||(e.add(r),t.push(_(r,`link-group`,n)))}),{url:window.location.href,extractedAt:Date.now(),blocks:t,hasSensitiveForms:se()}}var v=new Map;function y(e){if(v.has(e))return;let t=e;v.set(e,{className:t.className,style:t.getAttribute(`style`)||``})}function le(){v.forEach((e,t)=>{let n=t;n.className=e.className,e.style?n.setAttribute(`style`,e.style):n.removeAttribute(`style`)}),v.clear()}var b=`data-distill-simplified`,x=`distill-global-style`,S=`distill-restore-button`,C=`distill-primary-content`,w=`distill-deemphasize`,T=`distill-unstick`,E=`distill-neutral-color`,D=`#1a1a1a`,O=`distill-section-hidden`,k=`distill-progressive-controls`,A=/^h[23]$/i,j=`nav, aside, footer, [role="navigation"], [role="complementary"], [role="contentinfo"], [class*="ad" i], [id*="ad" i], ins, [class*="modal" i], [id*="modal" i], [class*="popup" i], [id*="popup" i], [class*="overlay" i]`;function M(){let e=document.querySelectorAll(`main, article, [role="main"]`),t=null,n=0;return e.forEach(e=>{if(!i(e))return;let r=(e.innerText||``).length;r>n&&(n=r,t=e)}),t}function N(e){return e.filter(t=>!e.some(e=>e!==t&&e.contains(t)))}function P(e){let t=new Set;return document.querySelectorAll(j).forEach(n=>{if(e&&(e===n||e.contains(n))||!i(n))return;if(a(n)||o(n)||[`nav`,`aside`,`footer`].includes(n.tagName.toLowerCase())){t.add(n);return}let r=n.getAttribute(`role`);(r===`navigation`||r===`complementary`||r===`contentinfo`)&&t.add(n)}),document.querySelectorAll(`body > *, header, div, section`).forEach(n=>{t.has(n)||e&&(e===n||e.contains(n))||i(n)&&s(n)&&t.add(n)}),N(Array.from(t))}function F(){document.querySelectorAll(`video[autoplay], audio[autoplay]`).forEach(e=>{y(e),e.pause(),e.removeAttribute(`autoplay`),e.classList.add(w)})}function I(){if(document.getElementById(x))return;let e=document.createElement(`style`);e.id=x,e.textContent=`
html[${b}] body {
  line-height: 1.7 !important;
}
html[${b}] .${C} {
  max-width: 760px !important;
  margin-left: auto !important;
  margin-right: auto !important;
  font-size: 1.15em !important;
  line-height: 1.75 !important;
  float: none !important;
}
html[${b}] .${C} p,
html[${b}] .${C} li {
  margin-bottom: 1.1em !important;
  font-size: 1.05em !important;
}
html[${b}] .${C} h1,
html[${b}] .${C} h2,
html[${b}] .${C} h3 {
  margin-top: 1.4em !important;
  margin-bottom: 0.6em !important;
}
html[${b}] .${w} {
  opacity: 0.4 !important;
  filter: grayscale(60%) !important;
  transition: opacity 0.2s ease !important;
}
html[${b}] .${w}:hover {
  opacity: 0.85 !important;
}
html[${b}] .${w} input,
html[${b}] .${w} button,
html[${b}] .${w} select,
html[${b}] .${w} textarea,
html[${b}] .${w} a[href] {
  opacity: 1 !important;
  filter: none !important;
}
html[${b}] .${T} {
  position: static !important;
}
html[${b}] .${C}.${E},
html[${b}] .${C}.${E} :not(form):not(form *):not(button):not(button *) {
  color: ${D} !important;
}
html[${b}] .${C}.${E} a:not(form a):not(button a) {
  text-decoration: underline !important;
}
#${S} {
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
#${S}:hover {
  opacity: 0.9;
}
html[${b}] .${O} {
  display: none !important;
}
#${k} {
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
#${k} button {
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 2px 6px;
}
#${k} button:disabled {
  opacity: 0.35;
  cursor: default;
}
#${k} button:hover:not(:disabled) {
  opacity: 0.8;
}
#${k} [data-role="label"] {
  opacity: 0.8;
  white-space: nowrap;
}
`,document.head.appendChild(e)}function L(){if(document.getElementById(S))return;let e=document.createElement(`button`);e.id=S,e.type=`button`,e.textContent=`Show original page`,e.addEventListener(`click`,$),document.body.appendChild(e)}function R(){return document.documentElement.getAttribute(b)===`true`}function z(){if(R())return{primaryFound:!!document.querySelector(`.${C}`),deemphasizedCount:document.querySelectorAll(`.${w}`).length};let e=M();e&&(y(e),e.classList.add(C));let t=P(e);return t.forEach(e=>{y(e),e.classList.add(w),s(e)&&e.classList.add(T)}),F(),I(),L(),document.documentElement.setAttribute(b,`true`),{primaryFound:!!e,deemphasizedCount:t.length}}function B(){return document.querySelector(`.${C}`)}function V(){return R()&&!!B()}function H(){return B()?.classList.contains(E)??!1}function U(e){let t=B();return!R()||!t?!1:(y(t),t.classList.toggle(E,e),!0)}var W=[],G=0,ue=150;function K(e){let t=e.firstElementChild;return t?A.test(t.tagName)?!0:!!t.querySelector(`h2, h3`)&&(t.textContent||``).length<ue:!1}function q(e){return A.test(e.tagName)||K(e)}function J(e,t=0){if(t>6||Array.from(e.children).filter(q).length>=2)return e;let n=null,r=0;for(let t of Array.from(e.children)){let e=t.querySelectorAll(`h2, h3`).length;e>r&&(r=e,n=t)}return n&&r>=2?J(n,t+1):e}function de(e){let t=Array.from(e.children);if(t.filter(K).length>=2){let e=[],n=[],r=!1;return t.forEach(t=>{K(t)?(!r&&n.length&&e.push(n),r=!0,e.push([t])):r?e[e.length-1]?.push(t):n.push(t)}),!r&&n.length&&e.push(n),e}let n=[],r=[];return t.forEach(e=>{A.test(e.tagName)?(r.length&&n.push(r),r=[e]):r.push(e)}),r.length&&n.push(r),n}function fe(){return W.length>0}function Y(){W.forEach((e,t)=>{e.forEach(e=>{y(e),e.classList.remove(w,O),t===G||(t===G+1?e.classList.add(w):e.classList.add(O))})})}function X(){let e=document.getElementById(k);if(!e)return;let t=e.querySelector(`[data-role="label"]`);t&&(t.textContent=`Section ${G+1} of ${W.length}`);let n=e.querySelector(`[data-role="prev"]`),r=e.querySelector(`[data-role="next"]`);n&&(n.disabled=G===0),r&&(r.disabled=G===W.length-1)}function Z(e){G=Math.max(0,Math.min(e,W.length-1)),Y(),X()}function pe(){document.getElementById(k)?.remove()}function me(){if(document.getElementById(k)){X();return}let e=document.createElement(`div`);e.id=k;let t=document.createElement(`button`);t.type=`button`,t.dataset.role=`prev`,t.textContent=`‹ Prev`,t.addEventListener(`click`,()=>Z(G-1));let n=document.createElement(`span`);n.dataset.role=`label`;let r=document.createElement(`button`);r.type=`button`,r.dataset.role=`next`,r.textContent=`Next ›`,r.addEventListener(`click`,()=>Z(G+1));let i=document.createElement(`button`);i.type=`button`,i.dataset.role=`show-all`,i.textContent=`Show All`,i.addEventListener(`click`,Q),e.append(t,n,r,i),document.body.appendChild(e),X()}function he(){return R()&&!!B()}function ge(){return fe()}function _e(){let e=B();if(!R()||!e)return{eligible:!1,totalSections:0,currentIndex:0};let t=de(J(e));return t.filter(e=>q(e[0])).length<2?(W=[],{eligible:!1,totalSections:0,currentIndex:0}):(W=t,G=0,Y(),me(),{eligible:!0,totalSections:W.length,currentIndex:G})}function Q(){W.forEach(e=>{e.forEach(e=>e.classList.remove(w,O))}),W=[],G=0,pe()}function $(){Q(),le(),document.documentElement.removeAttribute(b),document.getElementById(x)?.remove(),document.getElementById(S)?.remove()}