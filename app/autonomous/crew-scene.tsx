import type {CSSProperties} from 'react';
import {BatteryCharging,Droplets,Fish,Frown,Heart,Shield,Smile,Sparkles,Trophy,Wheat} from 'lucide-react';
import {isSheltered,LOCATIONS,type Simulation} from '@/lib/simulation';

const colors={pip:'#ffca74',moss:'#a8dba8',dot:'#a8bfff'};

export function CrewTokens({sim}:{sim:Simulation}){
  const won=sim.status==='won';
  return <>
    <div className="dock-caption" style={{left:`${LOCATIONS.charger.x}%`,top:`${LOCATIONS.charger.y+9}%`}}><BatteryCharging size={13}/> Charging dock</div>
    {sim.robots.map((r,i)=>{
      const reaction=r.phase!=='dead'&&r.reaction&&r.reaction.until>sim.time?r.reaction:undefined;
      const mood=won?'victory':reaction?.kind;
      const charging=r.task==='charge'&&r.phase==='work';
      const label=r.phase==='dead'?'Lost':won?'We did it!':reaction?.text??(charging?'Charging':isSheltered(r)?r.health<100?'Repairing':'Sheltered':r.task==='charge'?'To charger':r.task==='fish'?'Fishing':r.task==='harvest'?'Harvesting':r.task==='water'?'Watering':'');
      const icon=r.phase==='dead'?'×':won?<Heart size={16}/>:reaction?reaction.kind==='lucky'?<Sparkles size={18}/>:reaction.kind==='sad'?<Frown size={16}/>:<Smile size={16}/>:r.task==='charge'?<BatteryCharging size={16}/>:isSheltered(r)?<Shield size={14}/>:r.task==='fish'?<Fish size={14}/>:r.task==='harvest'?<Wheat size={14}/>:r.task==='water'?<Droplets size={14}/>:null;
      return <div key={r.id} className={`robot-token auto-robot ${won?'won-robot':r.phase==='travel'?'moving':''} ${r.phase==='dead'?'dead':''} ${mood?`mood-${mood}`:''}`} style={{left:`${won?44+i*10:r.x+(i-1)*2.2}%`,top:`${won?61:r.y+i*1.1}%`,'--robot-color':colors[r.id],'--dance-delay':`${1.8+i*.16}s`} as CSSProperties}>
        {icon&&<span key={reaction?.id??label} className={`robot-state ${reaction?'outcome-bubble':''} ${charging?'charging-bubble':''}`} role={reaction?'status':undefined} aria-label={`${r.name}: ${label}`} title={label}>{icon}{(reaction||won)&&<span>{label}</span>}</span>}
        <img src="/robot.png" alt={r.name}/><span className="robot-name">{r.name}</span>
      </div>;
    })}
    {won&&<div className="island-party" role="status" aria-label="Victory! All three robots gather and dance.">
      <div className="party-title"><Trophy size={30}/><h2>Everybody home!</h2><p>100 fish. 100 crops. Three very happy robots.</p></div>
      <div className="party-confetti" aria-hidden="true">{Array.from({length:36},(_,i)=><i key={i} style={{left:`${(i*29)%100}%`,background:['#ffcc68','#a8dba8','#a8bfff','#ff8b79'][i%4],animationDelay:`${i%9*.17}s`,'--drift':`${(i%7-3)*24}px`} as CSSProperties}/>)}</div>
      <p className="party-caption">Pip + Moss + Dot · island dance party</p>
    </div>}
  </>;
}
