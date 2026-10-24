'use strict';
try{const d=JSON.parse(decodeURIComponent(location.hash.slice(1)));for(const k of ['tint','accent'])if(/^#[a-f0-9]{6}$/i.test(d[k]))document.documentElement.style.setProperty('--'+k,d[k]);if(d.character?.startsWith('file:'))document.querySelector('#character').src=d.character;if(d.background?.startsWith('file:'))document.querySelector('#background').style.backgroundImage=`url(${JSON.stringify(d.background)})`;}catch{}
document.addEventListener('visibilitychange',()=>document.body.classList.toggle('paused',document.hidden));
