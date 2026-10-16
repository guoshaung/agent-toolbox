'use strict';
const {createHash}=require('node:crypto');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function createPacketCollector(){
  let pending='',bytes=0,count=0,finished=false; const headers=new Map(),streams=new Map();
  function stream(i){if(i!==0&&i!==1)fail('PACKET_STREAM_UNSUPPORTED');if(!streams.has(i))streams.set(i,{hash:createHash('sha256'),count:0,bytes:0,config:{}});return streams.get(i);}
  function line(text){
    if(!text)return;if(text.length>1024)fail('PACKET_LINE_LIMIT');
    if(text.startsWith('#')){
      if(/^#(?:format: frame checksums|version: 2|hash: SHA256|software: [A-Za-z0-9_.-]{1,80}|stream#,.*)$/.test(text))return;
      let m=text.match(/^#extradata ([01]),\s*(\d+),\s*([a-f0-9]{64})$/),key,value,i;
      if(m){i=Number(m[1]);key='extradata';const size=Number(m[2]);if(!Number.isSafeInteger(size)||size>65536)fail('PACKET_CONFIG_LIMIT');value={bytes:size,sha256:m[3]};}
      else {m=text.match(/^#(tb|media_type|codec_id|dimensions|sar|sample_rate|channel_layout_name) ([01]): ([A-Za-z0-9_./x]+)$/);if(!m)fail('PACKET_HEADER_UNSUPPORTED');i=Number(m[2]);key=m[1];value=m[3];}
      const tag=i+':'+key;if(headers.has(tag))fail('PACKET_HEADER_DUPLICATE');headers.set(tag,true);stream(i).config[key]=value;return;
    }
    const a=text.split(',').map(x=>x.trim());
    if(a.length<6||a.length>23||a.slice(0,5).some(x=>!/^[-]?\d{1,12}$/.test(x))||!/^[a-f0-9]{64}$/.test(a[5]))fail('PACKET_ROW_INVALID');
    const numbers=a.slice(0,5).map(Number);if(numbers.some(x=>!Number.isSafeInteger(x))||numbers[3]<0||numbers[4]<0||numbers[4]>67108864)fail('PACKET_ROW_INVALID');
    if(a.length>6){const extra=a[6].match(/^S=([1-8])$/);if(!extra||a.length!==7+Number(extra[1])*2)fail('PACKET_SIDE_DATA_UNSUPPORTED');for(let j=7;j<a.length;j+=2)if(!/^\d{1,5}$/.test(a[j])||Number(a[j])>65536||!/^[a-f0-9]{64}$/.test(a[j+1]))fail('PACKET_SIDE_DATA_UNSUPPORTED');}
    if(++count>100000)fail('PACKET_COUNT_LIMIT');const s=stream(numbers[0]);s.count++;s.bytes+=numbers[4];s.hash.update(a.join(',')+'\n');
  }
  return {push(buffer){if(finished)fail('PACKET_PROOF_FINISHED');bytes+=buffer.length;if(bytes>12*1024*1024)fail('PACKET_PROOF_LIMIT');if(buffer.some(x=>x>127||x===0))fail('PACKET_PROOF_ASCII');pending+=buffer.toString('ascii');let end;while((end=pending.indexOf('\n'))>=0){line(pending.slice(0,end).replace(/\r$/,''));pending=pending.slice(end+1);}if(pending.length>1024)fail('PACKET_LINE_LIMIT');},finish(){if(finished)fail('PACKET_PROOF_FINISHED');finished=true;if(pending)line(pending);if(!count||!streams.has(0))fail('PACKET_PROOF_EMPTY');return {format:'T050-packet-proof',version:1,packetCount:count,measuredLogBytes:bytes,streams:[...streams].sort((a,b)=>a[0]-b[0]).map(([index,s])=>{if(!s.count||!s.config.extradata||!s.config.tb||!s.config.codec_id||!s.config.media_type)fail('PACKET_CONFIG_MISSING');return {index,packetCount:s.count,compressedBytes:s.bytes,sequenceSHA256:s.hash.digest('hex'),configuration:s.config};})};}};
}
function comparePacketProof(source,output){
  if(!source||!output||source.packetCount!==output.packetCount||JSON.stringify(source.streams)!==JSON.stringify(output.streams))fail('COMPRESSED_PACKET_OR_CONFIG_CHANGED');
  return {verified:true,method:'fixed FFmpeg -c copy framehash; each packet SHA256 + DTS/PTS/duration/size/side-data sequence digest and codec extradata/configuration compared per stream',packetCount:source.packetCount,streams:source.streams};
}
module.exports={createPacketCollector,comparePacketProof};
