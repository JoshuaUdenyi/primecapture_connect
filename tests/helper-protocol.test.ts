import { it, expect } from 'vitest';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// This uses an actual obs-websocket-js client against a labelled protocol simulator.
// It does not establish compatibility with a real Windows OBS installation.
it('helper polls through the OBS protocol and never modifies an already live/recording feed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'prime-helper-'));
 const requests:string[]=[];
 const ws=new WebSocketServer({host:'127.0.0.1',port:4455});
 await new Promise<void>((resolve,reject)=>{ws.once('listening',resolve);ws.once('error',reject);});
 ws.on('connection',socket=>{
   socket.send(JSON.stringify({op:0,d:{obsWebSocketVersion:'5.6.0-simulated',rpcVersion:1}}));
   socket.on('message',raw=>{
     const message=JSON.parse(raw.toString());
     if(message.op===1){socket.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));return;}
     if(message.op===6){
       requests.push(message.d.requestType);
       socket.send(JSON.stringify({op:7,d:{requestType:message.d.requestType,requestId:message.d.requestId,requestStatus:{result:true,code:100},responseData:{outputActive:true}}}));
     }
   });
 });
 let heartbeat:Record<string,unknown>|undefined;
 let received!:()=>void;
 const completed=new Promise<void>(resolve=>{received=resolve;});
 const cloud=createServer((req,res)=>{
   let raw='';req.on('data',part=>raw+=part);req.on('end',()=>{
     heartbeat=JSON.parse(raw);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({commands:[],control_enabled:false}));received();
   });
 });
 await new Promise<void>(resolve=>cloud.listen(0,'127.0.0.1',resolve));
 const address=cloud.address();if(!address||typeof address==='string')throw new Error('Test server failed');
 const origin=`http://127.0.0.1:${address.port}`;
 await writeFile(join(dir,'device.json'),JSON.stringify({agent_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',device_token:'a'.repeat(43),origin}));
 const child=spawn(process.execPath,['--env-file-if-exists=agent/.env','--import','tsx','agent/src/index.ts'],{env:{...process.env,CONNECT_APP_URL:origin,AGENT_ALLOW_LOCAL_DEVELOPMENT:'true',AGENT_STATE_DIR:dir,OBS_WEBSOCKET_PASSWORD:'simulated-test-password'},stdio:'pipe'});
 let output='';child.stderr.on('data',part=>{output+=part.toString();});
 let timeout:ReturnType<typeof setTimeout>|undefined;
 try{
   await Promise.race([completed,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('No helper heartbeat: '+output)),10000);})]);
   expect(heartbeat).toEqual({obs_connected:true,output_active:true,recording_active:true});
   expect(requests.sort()).toEqual(['GetRecordStatus','GetStreamStatus']);
 }finally{
   clearTimeout(timeout);child.kill('SIGTERM'); const killTimer=setTimeout(()=>child.kill('SIGKILL'),3000);
   await new Promise<void>(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',()=>resolve());});
   clearTimeout(killTimer);cloud.closeAllConnections();
   for(const client of ws.clients)client.terminate();
   await Promise.all([new Promise<void>(resolve=>ws.close(()=>resolve())),new Promise<void>(resolve=>cloud.close(()=>resolve()))]);
   await rm(dir,{recursive:true,force:true});
 }
},20000);
