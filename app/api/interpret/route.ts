import { z } from "zod";
import { QUESTIONS } from "@/lib/jev";

const headers={"Cache-Control":"no-store","Content-Type":"application/json"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
const State=z.object({command:z.string().trim().min(1).max(500),robots:z.array(z.object({id:z.enum(["pip","moss","dot"]),name:z.string().max(20),battery:z.number().min(0).max(100),status:z.enum(["idle","charging","resting","watering","walking"]),place:z.enum(["cabin","garden","pond","charger"])})).length(3),lights:z.object({porch:z.number().min(0).max(1),garden:z.number().min(0).max(1),cabin:z.number().min(0).max(1)}),garden_moisture_percent:z.number().min(0).max(100),weather:z.enum(["storm","clear"]),time:z.enum(["evening","afternoon"]),preferred_available_worker:z.enum(["pip","moss","dot"]).nullable()}).strict();
const prob=z.number().min(0).max(1);
const choice=z.object({type:z.literal("choice"),choice:z.string(),confidence:prob,probabilities:z.record(prob)}).refine(a=>Object.hasOwn(a.probabilities,a.choice)&&Math.abs(Object.values(a.probabilities).reduce((x,y)=>x+y,0)-1)<.03);
const noul=z.object({type:z.literal("noul"),noul:prob});
const resultSchema=z.object({model:z.string(),answers:z.object({action:choice.refine(a=>["move","water","lights_on","lights_off","rest","unknown"].includes(a.choice)),destination:choice.refine(a=>["cabin","garden","pond","charger","none"].includes(a.choice)),robot_pip:noul,robot_moss:noul,robot_dot:noul,light_porch:noul,light_garden:noul,light_cabin:noul,brightness:z.object({type:z.literal("score"),score:z.number().min(0).max(2),confidence:prob,probabilities:z.record(prob)})}),usage:z.object({input_tokens:z.number().int().nonnegative(),output_tokens:z.number().int().nonnegative()}).optional()});

export async function POST(request:Request){
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin) return json({error:"This request must come from Tiny World."},403);
  if(Number(request.headers.get("content-length")||0)>12000) return json({error:"Command is too large."},413);
  let state: z.infer<typeof State>;
  try{ const raw=await request.text(); if(raw.length>12000)return json({error:"Command is too large."},413); state=State.parse(JSON.parse(raw)); }catch{return json({error:"The command or world state is invalid."},400);}
  // Session keys are never persisted. The request is forwarded only to TypeSafe's fixed endpoint.
  let key=request.headers.get("x-typesafe-key")?.trim();
  if(!key) { try { const { env }=await import("cloudflare:workers"); key=(env as {TYPESAFE_API_KEY?:string}).TYPESAFE_API_KEY; } catch { key=process.env.TYPESAFE_API_KEY; } }
  if(!key) return json({error:"Connect your TypeSafe API key to use live Jev, or switch to demo mode."},401);
  if(key.length>1024||/[\r\n]/.test(key))return json({error:"The API key format is invalid."},400);
  const started=performance.now();
  try{
    const response=await fetch("https://api.typesafe.ai/v1/systemone",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"jev-1.13.0",state,questions:QUESTIONS}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) return json({error:response.status===401?"TypeSafe did not accept this key. Check it and try again.":response.status===429?"TypeSafe is busy with this account. Wait a moment and retry.":"Jev could not complete this command. Your world has not changed."},response.status===401?401:response.status===429?429:502);
    const parsed=resultSchema.safeParse(await response.json());
    if(!parsed.success) return json({error:"Jev returned an unexpected answer. Your world has not changed."},502);
    return json({...parsed.data,mode:"live",latency:Math.round(performance.now()-started)});
  }catch{return json({error:"Could not reach Jev within 15 seconds. Your world has not changed. Try again or use demo mode."},502);}
}
