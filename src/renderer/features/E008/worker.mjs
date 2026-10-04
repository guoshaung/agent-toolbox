import {chooseAI} from './model.mjs';
self.onmessage=e=>{try{const{id,board,player,difficulty}=e.data||{};self.postMessage({id,ok:true,result:chooseAI(board,player,difficulty)});}catch(error){self.postMessage({id:e.data?.id,ok:false,error:error.message});}};
