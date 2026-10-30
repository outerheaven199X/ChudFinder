export const LOOKUP_HELP = [
  'Careful is passive: saved flags appear automatically. For an unknown account, use About ↗ to open X normally; its displayed country is saved without typing. Loading, scrolling, hovering and investigating start no background X visits.',
  'Auto optionally opens extra X About pages in the background. X prohibits website scripting and warns of permanent account suspension. Pacing does not remove that risk.',
  'Switching to Careful stops new background lookups; one already running may finish. Passive capture removes these extra visits, but cannot guarantee how X will enforce its rules.'
];

/** Shared hover/focus help. No network calls or setting changes. */
export function mountLookupHelp(host:HTMLElement, above=false, signal?:AbortSignal) {
  const doc=host.ownerDocument;
  if(host.querySelector('.cf-lookup-help'))return;
  if(!host.style.position)host.style.position='relative';
  const wrap=doc.createElement('span');wrap.className='cf-lookup-help';
  wrap.style.cssText='display:inline-flex;align-items:center;flex-shrink:0';
  const button=doc.createElement('button');button.type='button';button.textContent='(?)';
  button.setAttribute('aria-label','Auto and Careful mode: behavior and account risks');
  button.style.cssText='width:auto;margin:0;padding:2px 4px;background:transparent;color:inherit;border:1px solid currentColor;cursor:help;font:inherit;line-height:20px;flex-shrink:0';
  const tip=doc.createElement('span');tip.id='cf-lookup-risk-help';tip.setAttribute('role','tooltip');tip.hidden=true;
  button.setAttribute('aria-describedby',tip.id);
  tip.style.cssText='position:absolute;left:0;'+(above?'bottom:100%':'top:100%')+';z-index:2147483647;box-sizing:border-box;width:min(340px, calc(100vw - 32px));max-width:calc(100vw - 32px);padding:12px;background:#17171c;color:#fff;border:1px solid #aaa;box-shadow:0 4px 16px #0006;text-align:left;white-space:normal;font:12px/1.45 system-ui';
  // Flow into a new row so narrow extension panels do not clip the help.
  if(host.dataset.cfHelpWidth==='container'){
    host.style.display='grid';host.style.gridTemplateColumns='1fr auto auto';
    wrap.style.display='contents';tip.style.position='static';tip.style.gridColumn='1 / -1';
    tip.style.width='100%';tip.style.maxWidth='100%';
  }
  for(const text of LOOKUP_HELP){const p=doc.createElement('span');p.style.cssText='display:block;margin:0 0 8px';p.textContent=text;tip.appendChild(p);}
  (tip.lastElementChild as HTMLElement).style.marginBottom='0';
  let hovered=false,pinned=false;
  const show=()=>{tip.hidden=false;};
  const hide=()=>{tip.hidden=true;pinned=false;};
  const leave=()=>{if(!hovered&&!pinned&&doc.activeElement!==button)hide();};
  wrap.addEventListener('mouseenter',()=>{hovered=true;show();},{signal});
  wrap.addEventListener('mouseleave',()=>{hovered=false;leave();},{signal});
  button.addEventListener('focus',show,{signal});
  button.addEventListener('blur',leave,{signal});
  button.addEventListener('click',()=>{pinned=!pinned;if(pinned)show();else hide();},{signal});
  // Escape dismisses hover help even when the pointer is over it, per WCAG 1.4.13.
  const keydown=(e:KeyboardEvent)=>{if(e.key==='Escape'&&tip.isConnected&&!tip.hidden){hide();e.stopPropagation();}};
  doc.addEventListener('keydown',keydown,{signal});
  wrap.append(button,tip);host.appendChild(wrap);
}
