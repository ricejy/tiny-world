'use client';
import {useEffect,useRef,useState} from 'react';
import {Trees,Play,Pause,RotateCcw,Fish,Wheat,Heart,Battery,CloudRain,Sun,Shield,Radio,FlaskConical,ArrowLeft,LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {agentState,assignDecisions,createSimulation,demoDecisions,isSheltered,snapshot,tick,TASK_LABELS,type Decisions,type Id,type Simulation,type Task} from '@/lib/simulation';
import './survival.css';

type Reply={model:string;latency:number;answers:Record<Id,{type:'choice';choice:Task;confidence:number;probabilities:Record<string,number>}>;usage?:{input_tokens:number;output_tokens:number}};
const colors={pip:'#ffca74',moss:'#a8dba8',dot:'#a8bfff'};
const clock=(t:number)=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const LIMIT=200;

export default function Autonomous(){
  const [sim,setSim]=useState(()=>createSimulation(42)),[mode,setMode]=useState<'demo'|'live'>('demo');
  const simRef=useRef(sim),running=useRef(false),epoch=useRef(0),inFlight=useRef(false),abort=useRef<AbortController|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reply,setReply]=useState<Reply|null>(null),[calls,setCalls]=useState(0),[tokens,setTokens]=useState(0),[stale,setStale]=useState(0);
  const [seed,setSeed]=useState('42'),[key,setKey]=useState(''),[keyDraft,setKeyDraft]=useState(''),[connect,setConnect]=useState(false);
  const [lastTasks,setLastTasks]=useState<Partial<Decisions>>({}),[override,setOverride]=useState<Id>('pip');
  const callsRef=useRef(0),lastDecision=useRef(-100),lastWeather=useRef(0),lastJobs=useRef(''),modeRef=useRef(mode),keyRef=useRef(key);
  const commit=(s:Simulation)=>{simRef.current=s;setSim(s);};
  function cancelRequest(){epoch.current++;abort.current?.abort();abort.current=null;inFlight.current=false;setBusy(false);}
  function pause(message=''){running.current=false;cancelRequest();const s=simRef.current;if(s.status==='running')commit({...s,status:'paused'});if(message)setError(message);}
  function resetRun(nextSeed?:number){running.current=false;cancelRequest();const value=nextSeed??Number(seed);const normalized=Number.isInteger(value)&&value>=0&&value<=4294967295?value:42;setSeed(String(normalized));commit(createSimulation(normalized));setError('');setReply(null);setLastTasks({});setCalls(0);setTokens(0);setStale(0);callsRef.current=0;lastDecision.current=-100;lastWeather.current=0;lastJobs.current='';}
  function start(){if(['won','lost'].includes(simRef.current.status))return;if(modeRef.current==='live'&&callsRef.current>=LIMIT){setError('This run reached its 200-request limit. Reset to begin another run.');return;}setError('');running.current=true;commit({...simRef.current,status:'running'});lastDecision.current=-100;}
  function changeMode(value:'demo'|'live'){pause();modeRef.current=value;setMode(value);setReply(null);setLastTasks({});setError('');}
  function intervene(task:Task){const s=simRef.current;if(['won','lost'].includes(s.status))return;cancelRequest();const next=assignDecisions({...s,status:'running'},{[override]:task},undefined,true);commit({...next,status:s.status});lastDecision.current=s.time;}

  useEffect(()=>{
    let mounted=true;
    async function decide(){
      const state=simRef.current;
      if(!running.current||state.status!=='running'||inFlight.current)return;
      const jobs=state.robots.map(r=>r.job).join(',');
      const important=state.weatherVersion!==lastWeather.current||jobs!==lastJobs.current;
      if(state.time-lastDecision.current<(important?2:5))return;
      lastDecision.current=state.time;lastWeather.current=state.weatherVersion;lastJobs.current=jobs;
      if(modeRef.current==='demo'){
        const decisions=demoDecisions(state);commit(assignDecisions(state,decisions));setLastTasks(decisions);return;
      }
      if(callsRef.current>=LIMIT){pause('This run reached its 200-request limit. Reset to start another run.');return;}
      inFlight.current=true;setBusy(true);const generation=epoch.current,expected=snapshot(state);
      const controller=new AbortController();abort.current=controller;callsRef.current++;setCalls(callsRef.current);
      try{
        const response=await fetch('/api/autonomy',{method:'POST',headers:{'Content-Type':'application/json',...(keyRef.current?{'x-typesafe-key':keyRef.current}:{})},body:JSON.stringify(agentState(state)),signal:controller.signal});
        const data=await response.json() as Reply&{error?:string};
        if(!mounted||generation!==epoch.current||!running.current)return;
        if(!response.ok)throw new Error(data.error||'Jev could not decide.');
        setReply(data);setTokens(t=>t+(data.usage?.input_tokens??0));
        const current=simRef.current;
        if(current.weatherVersion!==expected.weatherVersion){setStale(n=>n+1);lastDecision.current=-100;return;}
        const decisions=Object.fromEntries(Object.entries(data.answers).map(([id,a])=>[id,a.choice])) as Decisions;
        const changed=current.robots.filter(r=>r.job!==expected.jobs[r.id]).length;if(changed)setStale(n=>n+changed);
        commit(assignDecisions(current,decisions,expected));setLastTasks(decisions);
      }catch(e){if(mounted&&generation===epoch.current){pause(e instanceof Error?e.message:'Jev request failed.');}}
      finally{if(mounted&&generation===epoch.current){inFlight.current=false;setBusy(false);abort.current=null;}}
    }
    const timer=setInterval(()=>{
      if(!running.current||document.hidden)return;
      const current=simRef.current;if(current.status!=='running')return;
      const next=tick(current);commit(next);
      if(next.status!=='running'){running.current=false;cancelRequest();return;}
      void decide();
    },250);
    const visibility=()=>{if(document.hidden&&running.current)pause('Paused while the page is hidden. Resume when you return.');};
    document.addEventListener('visibilitychange',visibility);
    return()=>{mounted=false;running.current=false;epoch.current++;abort.current?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[]);

  const alive=sim.robots.filter(r=>r.phase!=='dead').length;
  return <main className="tiny-app survival-app">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark"><Trees size={24}/></span><span>Tiny World<span className="brand-period">.</span></span></a><span className="top-note">100 fish. 100 crops. Everybody home.</span><Button variant="outline" onClick={()=>{pause();setConnect(true);}}><Radio size={15}/>{mode==='live'?'Live Jev':'Demo controller'}</Button></header>
    <div className="survival-toolbar"><a href="/"><ArrowLeft size={14}/> Command sandbox</a><div className="run-clock">{clock(sim.time)} <span>{sim.status}</span></div><div className="run-buttons"><Button onClick={()=>sim.status==='running'?pause():start()} disabled={sim.status==='won'||sim.status==='lost'}>{sim.status==='running'?<Pause size={16}/>:<Play size={16}/>} {sim.status==='running'?'Pause':sim.status==='ready'?'Start run':'Resume'}</Button><Button variant="outline" onClick={()=>resetRun()} aria-label="Reset this seed"><RotateCcw size={16}/>Reset</Button></div></div>
    <div className="survival-goals"><div><Fish/><span>Fish<strong>{sim.fish}<small> / 100</small></strong></span><progress value={Math.min(100,sim.fish)} max={100}/></div><div><Wheat/><span>Crops<strong>{sim.crops}<small> / 100</small></strong></span><progress value={Math.min(100,sim.crops)} max={100}/></div><div><Heart/><span>Crew alive<strong>{alive}<small> / 3</small></strong></span><p>One loss ends the run</p></div></div>
    {error&&<div className="survival-alert" role="alert">{error}</div>}
    {sim.status==='won'&&<div className="survival-banner won" role="status">Island secured! Both goals reached and every robot survived in {clock(sim.time)}.</div>}
    {sim.status==='lost'&&<div className="survival-banner lost" role="status">A friend was lost to the storm. Reset to replay this seed, or try another island forecast.</div>}
    <div className="game-grid survival-grid"><section>
      <div className={`scene survival-scene ${sim.weather==='storm'?'rainy':''}`}>
        <div className={`forecast ${sim.weather}`}>{sim.weather==='clear'?<Sun size={18}/>:<CloudRain size={18}/>}<div><strong>{sim.weather==='clear'?'Clear skies':sim.weather==='warning'?'Storm approaching':'Storm overhead'}</strong><span>{Math.ceil(sim.weatherRemaining)}s {sim.weather==='clear'?'until warning':sim.weather==='warning'?'to reach shelter':'until clear skies'}</span></div></div>
        <div className="scene-inner"><img className="island-art" src="/island.png" alt="Fernwater island, with a cabin, crop garden, fishing pond, and charging dock"/><div className="night-tint"/>
          {sim.weather==='storm'&&<div className="rain-overlay" aria-hidden="true">{Array.from({length:30},(_,i)=><i key={i} style={{left:`${i*37%100}%`,animationDelay:`${i%7*-.18}s`,animationDuration:`${.65+i%3*.15}s`}}/>)}</div>}
          {sim.robots.map((r,i)=><div key={r.id} className={`robot-token auto-robot ${r.phase==='travel'?'moving':''} ${r.phase==='dead'?'dead':''}`} style={{left:`${r.x+(i-1)*2.2}%`,top:`${r.y+i*1.1}%`,'--robot-color':colors[r.id]} as React.CSSProperties}><span className="robot-state">{r.phase==='dead'?'×':isSheltered(r)?<Shield size={14}/>:r.task==='fish'?<Fish size={14}/>:r.task==='harvest'?<Wheat size={14}/>:null}</span><img src="/robot.png" alt=""/><span className="robot-name">{r.name}</span></div>)}
        </div><div className="scene-bottom"><span>{sim.ripe} ripe crops · {Math.round(sim.moisture)}% soil moisture</span><span>{mode==='live'?'Jev controls the crew':'Local demo rules'}</span></div>
      </div>
      <div className="survival-crew">{sim.robots.map(r=><article key={r.id}><div className="bot-title"><span style={{background:colors[r.id]}}/><strong>{r.name}</strong><small>{isSheltered(r)?'Sheltered':r.phase==='dead'?'Lost':'Outdoors'}</small></div><p>{r.phase==='travel'?`Travelling · ${TASK_LABELS[r.task]}`:r.phase==='dead'?'Lost in the storm':TASK_LABELS[r.task]}{r.phase==='work'&&r.remaining>0?` · ${Math.ceil(r.remaining)}s`:''}</p><label><Heart size={13}/><progress value={r.health} max={100}/>{Math.ceil(r.health)}%</label><label><Battery size={13}/><progress value={r.battery} max={100}/>{Math.ceil(r.battery)}%</label>{r.phase==='work'&&r.duration>0&&<progress className="job-progress" value={r.duration-r.remaining} max={r.duration}/>}</article>)}</div>
      <section className="autonomy-controls"><div><h2>Give the crew a nudge</h2><p>Manual tasks interrupt one robot. Autonomy resumes at the next decision and follows the new task.</p></div><div className="override-row"><select aria-label="Robot to control" value={override} onChange={e=>setOverride(e.target.value as Id)}><option value="pip">Pip</option><option value="moss">Moss</option><option value="dot">Dot</option></select>{(['fish','harvest','water','charge','shelter'] as Task[]).map(t=><Button key={t} size="sm" variant="outline" disabled={sim.status==='won'||sim.status==='lost'} onClick={()=>intervene(t)}>{TASK_LABELS[t]}</Button>)}</div></section>
      <section className="run-rules"><div><h2>A little luck, a little planning.</h2><p>Fishing takes 8–16s: an 18% chance of no bite, usually 1–5 fish, and a 6% chance of a 7–10 fish haul. Harvests take 6–12s and yield 2–6 available crops. Watered crops regrow every 18–28s.</p><p>Storms deal 6 health/s outdoors. The cabin repairs 3 health/s. Only the dock recharges batteries; it does not heal. Robots finish repairs before leaving. Chosen jobs last through travel and one work cycle, with interruptions for danger or low battery. The charging dock is exposed. Empty batteries stop work and slow travel.</p></div><div className="seed-controls"><label htmlFor="run-seed">Run seed</label><Input id="run-seed" type="number" min={0} max={4294967295} value={seed} disabled={sim.status==='running'} onChange={e=>setSeed(e.target.value)}/><Button variant="outline" size="sm" disabled={sim.status==='running'} onClick={()=>resetRun()}>Replay seed</Button><Button variant="ghost" size="sm" disabled={sim.status==='running'} onClick={()=>resetRun(crypto.getRandomValues(new Uint32Array(1))[0])}>New seed</Button></div></section>
    </section><aside className="side-panel survival-panel"><section><div className="section-label"><span><Radio size={15}/>Decision engine</span>{busy&&<LoaderCircle size={15} className="spin"/>}</div><h2>{mode==='live'?'Jev is the island director.':'Try the demo crew.'}</h2><p>{mode==='live'?'While running, the island sends its state to Jev about every 5 seconds, sooner after important events.':'A local controller lets you try the simulation without an API key. Switch to Live Jev for model decisions.'}</p><p className="muted">The run pauses when this page is hidden. One request at a time, up to 200 per run. Live mode uses your TypeSafe balance.</p><div className="auto-metrics"><span>Requests<strong>{calls} / {LIMIT}</strong></span><span>Input tokens<strong>{tokens.toLocaleString()}</strong></span><span>Est. API cost<strong>${(tokens*.042/1e6).toFixed(5)}</strong></span><span>Stale decisions skipped<strong>{stale}</strong></span></div></section>
      <section><div className="section-label"><span><FlaskConical size={15}/>Latest decisions</span><span>{reply&&mode==='live'?`${reply.latency} ms`:'Demo'}</span></div>{sim.robots.map(r=><div className="auto-decision" key={r.id}><strong>{r.name}</strong><span>{lastTasks[r.id]?TASK_LABELS[lastTasks[r.id]!]: 'Waiting to start'}</span>{reply&&mode==='live'&&<small>{Math.round((reply.answers[r.id].probabilities[reply.answers[r.id].choice]??0)*100)}% selected probability</small>}</div>)}{reply&&mode==='live'&&<details className="raw-details"><summary>Raw Jev answers</summary><pre>{JSON.stringify(reply.answers,null,2)}</pre></details>}<p className="muted">Jev chooses tasks. Travel, randomness, damage, and rewards run in code. A bad decision can lose the run.</p></section>
      <section className="survival-feed"><div className="section-label"><span>Island log</span><span>{clock(sim.time)}</span></div><div role="log" aria-label="Island events">{sim.events.length?sim.events.slice(0,18).map(e=><div className={`event ${e.kind}`} key={e.id}><time>{clock(e.time)}</time><p>{e.text}</p></div>):<p className="muted">Press Start run to begin the story.</p>}</div></section>
    </aside></div>
    <Dialog open={connect} onOpenChange={v=>{setConnect(v);if(!v)setKeyDraft('');}}><DialogContent><DialogHeader><DialogTitle>Who runs the island?</DialogTitle><DialogDescription>Live Jev receives the game state and chooses a task for each robot. The demo uses local rules.</DialogDescription></DialogHeader><label htmlFor="autonomy-key">TypeSafe API key</label><Input id="autonomy-key" type="password" autoComplete="off" value={keyDraft} onChange={e=>setKeyDraft(e.target.value)} placeholder={key?'A session key is connected':'Paste a key for this page session'}/><p className="muted">Kept in memory only, sent through this backend to TypeSafe, forgotten on refresh. Connecting does not start the run.</p><Button disabled={!keyDraft.trim()} onClick={()=>{const value=keyDraft.trim();keyRef.current=value;setKey(value);setKeyDraft('');changeMode('live');setConnect(false);}}>Use Live Jev</Button><Button variant="outline" onClick={()=>{keyRef.current='';setKey('');changeMode('live');setConnect(false);}}>Use server-configured key</Button><Button variant="ghost" onClick={()=>{keyRef.current='';setKey('');changeMode('demo');setConnect(false);}}>Use demo controller</Button></DialogContent></Dialog>
  </main>;
}
