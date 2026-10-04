import{compare}from'./model.mjs';
self.onmessage=e=>{try{if(e.data?.op!=='compare'||Object.keys(e.data).sort().join('|')!=='a|b|op|settings')throw Error('仅固定视觉比较操作');const result=compare(e.data.a,e.data.b,e.data.settings);self.postMessage({ok:true,result},[result.overlay.buffer]);}catch(error){self.postMessage({ok:false,error:error.message});}finally{self.close();}};
