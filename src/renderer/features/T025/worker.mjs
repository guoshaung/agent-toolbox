import{inspect}from'./model.mjs';
self.onmessage=async e=>{try{if(e.data?.op!=='inspect'||Object.keys(e.data).sort().join('|')!=='bytes|constraints|name|op')throw Error('仅固定PDF结构预检操作');self.postMessage({ok:true,result:await inspect(e.data.bytes,e.data.name,e.data.constraints)});}catch(error){self.postMessage({ok:false,error:String(error.message).slice(0,480)});}finally{self.close();}};
