import{runWorker}from'./model.mjs';
self.onmessage=e=>runWorker(e,self);
