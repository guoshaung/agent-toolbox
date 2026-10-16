import{build}from'./model.mjs';
self.onmessage=async e=>{try{if(e.data?.op!=='build'||Object.keys(e.data).sort().join('|')!=='op|pages')throw Error('仅固定纯位图PDF构建操作');self.postMessage({ok:true,result:await build(e.data.pages)});}catch(error){self.postMessage({ok:false,error:error.message});}finally{self.close();}};
