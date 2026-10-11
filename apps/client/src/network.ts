import {Client,type Room} from '@colyseus/sdk';
import type {GameCommand,RoomView,CommandResult} from '../../../packages/shared/src/index.ts';
export interface Credentials {code:string;seatId:string;token:string;roomId?:string;key?:string}
const server=import.meta.env.DEV?`${location.protocol}//${location.hostname}:8788`:location.origin;
export async function api<T>(path:string,body?:unknown):Promise<T>{const response=await fetch(`${server}${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const result=await response.json();if(!response.ok)throw new Error(result.error??'网络请求失败');return result;}
export class Connection {
 room?:Room;credentials?:Credentials;private generation=0;private heartbeat?:ReturnType<typeof setInterval>;private reconnectTimer?:ReturnType<typeof setTimeout>;private attempts=0;private stopped=false;pending?:GameCommand;
 constructor(private receive:(view:RoomView)=>void,private status:(status:string,latency?:number)=>void,private error:(message:string)=>void,private acknowledged:()=>void){}
 async connect(credentials:Credentials,resume=false){this.credentials=credentials;this.stopped=false;const generation=++this.generation;this.status(resume?'正在恢复席位':'正在连接');
 try{const c=credentials.key&&!resume?credentials:await api<Credentials>(`/api/rooms/${credentials.code}/resume`,{token:credentials.token});if(generation!==this.generation)return;const client=new Client(server.replace(/^http/,'ws')),room=await client.joinById(c.roomId!,{key:c.key});if(generation!==this.generation){void room.leave();return;}this.room=room;room.reconnection.maxRetries=0;this.attempts=0;
 room.onMessage('view',(view:RoomView)=>{this.receive(view);this.status('已同步');if(this.pending)room.send('command',this.pending);});room.onMessage('ack',(result:CommandResult)=>{if(this.pending?.id===result.id){this.pending=undefined;this.acknowledged();if(!result.ok)this.error(result.error??'操作失败');}});room.onMessage('error',(message:string)=>this.error(message));room.onMessage('pong',(at:number)=>this.status('已同步',Math.round(performance.now()-at)));
 room.onLeave(code=>{if(generation!==this.generation||this.stopped)return;if(code===4001){this.stopped=true;this.status('席位已在其他窗口恢复');return;}this.schedule();});room.onError((_code,message)=>this.error(message??'连接出错'));room.send('sync');clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>{if(this.room===room)room.send('ping',performance.now());},5000);
 }catch(error){if(generation!==this.generation||this.stopped)return;this.error((error as Error).message);this.schedule();}}
 private schedule(){this.room=undefined;clearInterval(this.heartbeat);const delay=Math.min(1000*2**this.attempts++,10000);this.status(`重连中 · 第 ${this.attempts} 次`);this.reconnectTimer=setTimeout(()=>{if(this.credentials&&!this.stopped)void this.connect(this.credentials,true);},delay);}
 command(command:GameCommand){this.pending=command;this.room?.send('command',command);}
 send(type:string,data:unknown){this.room?.send(type,data);}
 stop(){this.stopped=true;this.generation++;clearTimeout(this.reconnectTimer);clearInterval(this.heartbeat);const room=this.room;this.room=undefined;void room?.leave();}
}
