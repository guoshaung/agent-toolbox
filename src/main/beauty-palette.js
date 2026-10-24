'use strict';
async function portraitPalette(file){
 const {data}=await require('sharp')(file,{limitInputPixels:40_000_000}).resize(64,64,{fit:'inside'}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const buckets=Array.from({length:24},()=>({weight:0,r:0,g:0,b:0}));
 for(let i=0;i<data.length;i+=4){if(data[i+3]<64)continue;const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;if(delta<.16||max<.22)continue;let hue=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;hue=(hue*60+360)%360;const weight=delta*data[i+3]/255,bin=buckets[Math.floor(hue/15)];bin.weight+=weight;bin.r+=r*weight;bin.g+=g*weight;bin.b+=b*weight;}
 const winner=buckets.sort((a,b)=>b.weight-a.weight)[0];if(winner.weight<.1)return null;
 const rgb=[winner.r,winner.g,winner.b].map(x=>x/winner.weight),peak=Math.max(...rgb);
 const hex=values=>'#'+values.map(x=>Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join('');
 return {accent:hex(rgb.map(x=>x/peak*155+70)),tint:hex(rgb.map(x=>x/peak*26+13))};
}
module.exports={portraitPalette};
