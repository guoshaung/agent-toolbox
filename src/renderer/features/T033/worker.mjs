import {inspect,clean} from './model.mjs';
self.onmessage=e=>{try{const{kind,bytes}=e.data;if(kind==='inspect')self.postMessage({ok:true,info:inspect(bytes)});else if(kind==='clean'){const r=clean(bytes);self.postMessage({ok:true,...r},[r.bytes.buffer]);}else throw Error('未知处理操作。');}catch(error){self.postMessage({ok:false,error:error.message});}};
