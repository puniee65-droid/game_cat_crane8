/* functions/api/[[path]].js ― Cloudflare Pages Functions
   /api/* へのリクエストをすべてここで受け、lib/api-core.js の handleApi に委譲する。
   Node版(server.js)との違いはStoreの実装だけ（ここではWorkers KVを使う）。 */
import { handleApi } from '../../lib/api-core.js';

class KvStore {
  constructor(kv){ this.kv = kv; }
  async getUser(id){
    const v = await this.kv.get(`user:${id}`);
    return v ? JSON.parse(v) : null;
  }
  async putUser(user){
    await this.kv.put(`user:${user.userId}`, JSON.stringify(user));
    return user;
  }
}

export async function onRequest(context){
  const { request, env } = context;
  const url = new URL(request.url);

  let body = null;
  if(request.method !== 'GET'){
    const text = await request.text();
    try{ body = text ? JSON.parse(text) : {}; }   // sendBeacon(text/plain)も同様に処理
    catch(e){ body = {}; }
  }

  try{
    const store = new KvStore(env.NEKO_KV);
    const { status, data } = await handleApi(request.method, url.pathname, body, store);
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }catch(err){
    return new Response(JSON.stringify({ error: String(err.message || err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
