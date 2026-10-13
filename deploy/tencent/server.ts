import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GET as getStatus } from '../../app/api/status/route';
import { POST as interpret } from '../../app/api/interpret/route';
import { POST as getData } from '../../app/api/data/route';
const webRoot = fileURLToPath(new URL('./web/', import.meta.url));
const port = Number(process.env.PORT || 4319);
const host = process.env.HOST || '127.0.0.1';
const types: Record<string,string> = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server = createServer(async (req,res) => {
  const json = (status: number, value: unknown) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/healthz' && req.method === 'GET') return json(200,{ok:true,product:'condition-lab'});
    if (url.pathname.startsWith('/api/')) {
      const handler = url.pathname === '/api/interpret' ? interpret : url.pathname === '/api/data' ? getData : null;
      const statusRoute = url.pathname === '/api/status';
      if (!handler && !statusRoute) return json(404,{error:'接口不存在'});
      if ((statusRoute && req.method !== 'GET') || (handler && req.method !== 'POST')) return json(405,{error:'请求方式不支持'});
      let response: Response;
      if (statusRoute) response = await getStatus();
      else {
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) {const part=Buffer.from(chunk);size+=part.length;if(size>8192){json(413,{error:'请求内容过长'});req.resume();return;}chunks.push(part);}
        const headers = new Headers();
        for (const [name,value] of Object.entries(req.headers)) if (typeof value==='string' && !['host','connection','transfer-encoding'].includes(name)) headers.set(name,value);
        headers.set('content-length',String(size));
        response = await handler!(new Request(url,{method:'POST',headers,body:Buffer.concat(chunks)}));
      }
      res.writeHead(response.status,Object.fromEntries(response.headers.entries()));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if (!['GET','HEAD'].includes(req.method||'')) return json(405,{error:'请求方式不支持'});
    const decoded=decodeURIComponent(url.pathname);
    if (decoded.includes('\0') || decoded.split('/').some(part=>part.startsWith('.'))) return json(404,{error:'页面不存在'});
    const file=resolve(webRoot,decoded==='/'?'index.html':'.'+decoded);
    if (!file.startsWith(resolve(webRoot)+sep)) return json(404,{error:'页面不存在'});
    let body: Buffer;try{body=await readFile(file);}catch{return json(404,{error:'页面不存在'});}
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':decoded.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    res.end(req.method==='HEAD'?undefined:body);
  } catch { if(!res.headersSent) json(400,{error:'请求无效或服务暂不可用'});else res.end(); }
});
server.requestTimeout=20_000;server.headersTimeout=15_000;server.keepAliveTimeout=5_000;
server.listen(port,host,()=>{const address=server.address();console.log(`Condition Lab http://${host}:${address&&typeof address==='object'?address.port:port}`);});
const stop=()=>server.close(()=>process.exit(0));process.once('SIGTERM',stop);process.once('SIGINT',stop);
