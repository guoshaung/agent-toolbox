'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFile,spawnSync}=require('node:child_process');
const PDF_ID=/^pdf-[a-f0-9]{32}$/;
const MAX_BYTES=64*1024*1024;
const clean=s=>String(s||'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim();
function sourceId(input){const value=String(input||'').replace(/^local:/,'');return PDF_ID.test(value)?value:'';}
function buildPaper(raw,{id,name,dir}){
  if(!Array.isArray(raw.pages) || !raw.pages.length || raw.pages.length>200)throw Error('PDF 页数异常，仅支持 1–200 页');
  const pages=raw.pages.map((p,i)=>({number:i+1,text:clean(p.text)}));
  const textChars=pages.reduce((n,p)=>n+p.text.length,0);
  if(textChars<1500)throw Error('没有读到足够的论文正文，可能是扫描版或仅有摘要。请先 OCR，或上传可选中文字的完整 PDF');
  const sparse=pages.filter(p=>p.text.length<80).length;
  if(sparse>pages.length*.4)throw Error('PDF 有大量页面无法提取文字，可能是混合扫描件。请先 OCR 后再上传，避免遗漏正文');
  const budget=Math.floor(100000/pages.length);
  const body=pages.map(p=>`[PDF 第 ${p.number} 页]\n`+(p.text.length>budget?p.text.slice(0,Math.floor(budget*.75))+'\n[本页中间部分过长，已省略]\n'+p.text.slice(-Math.floor(budget*.25)):p.text)).join('\n\n');
  const candidates=pages.filter(p=>p.text.split('\n').some(t=>/^\s*(?:Figure\s*\d|Fig\.\s*\d|Table\s*\d|图\s*\d|表\s*\d)/i.test(t)));
  const figures=candidates.slice(0,8).map(p=>({id:`pdf-p${p.number}`,page:p.number,localPath:path.join(dir,`page-${p.number}.png`),caption:`PDF 第 ${p.number} 页的原文整页图（不是单独裁取的图表）：`+p.text.split('\n').filter(t=>/(?:Figure\s*\d|Fig\.\s*\d|Table\s*\d|图\s*\d|表\s*\d)/i.test(t)).join(' ').slice(0,600)}));
  const warnings=[];
  if(pages.some(p=>p.text.length>budget))warnings.push('正文较长，AI 将读取按页保留的内容节选，省略位置已标注');
  const title=clean(raw.title).slice(0,240)||name.replace(/\.pdf$/i,'');
  return{id,title,authors:clean(raw.authors).slice(0,500),abstract:'',body,figures,sourceType:'local-pdf',sourceUrl:'',originalName:name,pageCount:pages.length,textChars,warnings};
}
class LocalPaperService{
  constructor({userDataDir,resourcesDir,runHelper}={}){
    this.root=path.join(userDataDir,'paper-talk','imports');this.userDataDir=userDataDir;this.resourcesDir=resourcesDir;this.busy=false;
    this.runHelper=runHelper||((mode,...args)=>this._run(mode,...args));
  }
  async _run(mode,...args){
    let bin=path.join(this.resourcesDir,'bin','paperpdf');
    if(!fs.existsSync(bin) || spawnSync(bin,['version'],{encoding:'utf8',timeout:3000}).stdout?.trim()!=='paperpdf 1'){
      if(process.platform!=='darwin')throw Error('当前本地 PDF 解析功能需要 macOS');
      bin=path.join(this.userDataDir,'paperpdf-v1');
      const src=path.join(__dirname,'native','paperpdf.swift');
      const hash=crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
      if(!fs.existsSync(bin)||!fs.existsSync(bin+'.sha256')||fs.readFileSync(bin+'.sha256','utf8')!==hash){
        await this._exec('xcrun',['swiftc','-O',src,'-o',bin+'.building']);fs.renameSync(bin+'.building',bin);fs.writeFileSync(bin+'.sha256',hash);
      }
    }
    return this._exec(bin,[mode,...args]);
  }
  _exec(bin,args){return new Promise((resolve,reject)=>execFile(bin,args,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024},(error,stdout,stderr)=>error?reject(Error((stderr||'PDF 解析失败或超时，请检查文件是否完整').slice(0,350))):resolve(stdout)));}
  load(id){
    if(!PDF_ID.test(String(id||'')))throw Error('本地论文编号无效，请重新选择 PDF');
    const dir=path.join(this.root,id),real=fs.realpathSync(dir);
    if(path.dirname(real)!==fs.realpathSync(this.root))throw Error('本地论文缓存路径异常');
    const paper=JSON.parse(fs.readFileSync(path.join(real,'paper.json'),'utf8'));
    if(paper.id!==id||paper.sourceType!=='local-pdf')throw Error('本地论文缓存无效，请重新上传');
    return paper;
  }
  summary(paper){return{ok:true,paper:{id:paper.id,title:paper.title,name:paper.originalName,pageCount:paper.pageCount,textChars:paper.textChars,figures:paper.figures.length,preview:paper.body.slice(0,600),warnings:paper.warnings||[],file:path.join(this.root,paper.id,'source.pdf')}};}
  info(id){return this.summary(this.load(id));}
  async importFile(file){
    if(this.busy)return{ok:false,error:'正在读取 PDF，请稍候'};
    this.busy=true;let pending;
    try{
      if(typeof file!=='string'||!file||!path.isAbsolute(file)||!/\.pdf$/i.test(file))throw Error('请选择一个本地 PDF 文件');
      const resolved=await fs.promises.realpath(file),stat=await fs.promises.stat(resolved);
      if(!stat.isFile()||stat.size<8||stat.size>MAX_BYTES)throw Error('PDF 需为普通文件，大小不超过 64 MB');
      const chunks=[];let count=0;
      for await(const chunk of fs.createReadStream(resolved,{start:0,end:MAX_BYTES})){count+=chunk.length;if(count>MAX_BYTES)throw Error('PDF 大小不超过 64 MB');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);
      if(bytes.length>MAX_BYTES||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('文件内容不是有效 PDF，不能只修改扩展名');
      const id='pdf-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,32),dir=path.join(this.root,id),name=path.basename(file);
      fs.mkdirSync(this.root,{recursive:true,mode:0o700});
      if(fs.existsSync(path.join(dir,'paper.json')))return this.info(id);
      pending=fs.mkdtempSync(path.join(this.root,'pending-'));fs.chmodSync(pending,0o700);
      const stored=path.join(pending,'source.pdf');fs.writeFileSync(stored,bytes,{mode:0o600});
      const raw=JSON.parse(await this.runHelper('inspect',stored));
      const paper=buildPaper(raw,{id,name,dir});
      if(paper.figures.length){
        try{await this.runHelper('pages',stored,pending,paper.figures.map(f=>f.page).join(','));}
        catch{paper.warnings.push('原文页图未提取成功，将使用已读取的正文生成讲解');}
        paper.figures=paper.figures.filter(f=>fs.existsSync(path.join(pending,path.basename(f.localPath))));
      }
      fs.writeFileSync(path.join(pending,'paper.json'),JSON.stringify(paper),{mode:0o600});
      fs.renameSync(pending,dir);pending=null;
      return this.summary(paper);
    }catch(error){return{ok:false,error:error.code==='ENOENT'?'找不到该 PDF，请重新选择文件':error.message};}
    finally{if(pending)fs.rmSync(pending,{recursive:true,force:true});this.busy=false;}
  }
}
module.exports={LocalPaperService,buildPaper,sourceId,PDF_ID};
