export type RobotId = "pip" | "moss" | "dot";
export type Place = "cabin" | "garden" | "pond" | "charger";
export type LightId = "porch" | "garden" | "cabin";
export type Action = "move" | "water" | "lights_on" | "lights_off" | "rest" | "unknown";
export type Robot = { id: RobotId; name: string; battery: number; status: "idle" | "charging" | "resting" | "watering" | "walking"; place: Place; x: number; y: number };
export type World = { robots: Robot[]; lights: Record<LightId, number>; moisture: number; evening: boolean; rain: boolean };
export const PLACES: Record<Place, { name: string; x: number; y: number }> = {
  cabin: { name: "Cabin", x: 39, y: 30 }, garden: { name: "Garden", x: 38, y: 56 },
  pond: { name: "Pond", x: 61, y: 50 }, charger: { name: "Charging dock", x: 54, y: 21 },
};
export const ROBOT_COLORS: Record<RobotId, string> = { pip: "#ffca74", moss: "#a8dba8", dot: "#a8bfff" };
export const LIGHTS: { id: LightId; name: string; x: number; y: number }[] = [
  { id: "porch", name: "Porch light", x: 46.6, y: 24 }, { id: "garden", name: "Garden lantern", x: 43.4, y: 44.2 }, { id: "cabin", name: "Cabin window", x: 35.6, y: 23 },
];
export const initialWorld = (): World => ({ robots: [
  { id: "pip", name: "Pip", battery: 92, status: "idle", place: "cabin", x: 45, y: 57 },
  { id: "moss", name: "Moss", battery: 68, status: "idle", place: "garden", x: 42, y: 52 },
  { id: "dot", name: "Dot", battery: 24, status: "charging", place: "charger", x: 54, y: 21 },
], lights: { porch: 0, garden: 0, cabin: 0 }, moisture: 28, evening: false, rain: false });

export type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
export type NoulAnswer = { type: "noul"; noul: number };
export type ScoreAnswer = { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };
export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;
export type Interpretation = { answers: Record<string, Answer>; model: string; mode: "demo" | "live"; latency: number; usage?: { input_tokens: number; output_tokens: number }; };
export type Plan = { action: Action; robots: RobotId[]; lights: LightId[]; destination: Place | null; brightness: number; needsReview: boolean; reviewReason?: string; message: string; supported: boolean };
export const ACTION_NAMES: Record<Action, string> = { move: "Move", water: "Water plants", lights_on: "Turn lights on", lights_off: "Turn lights off", rest: "Rest", unknown: "Not supported" };
export function publicState(command: string, world: World) {
  const worker = [...world.robots].filter(r => !["charging", "resting"].includes(r.status)).sort((a,b) => b.battery-a.battery)[0];
  return { command, robots: world.robots.map(({ id, name, battery, status, place }) => ({ id, name, battery, status, place })), lights: world.lights, garden_moisture_percent: world.moisture, weather: world.rain ? "storm" : "clear", time: world.evening ? "evening" : "afternoon", preferred_available_worker: worker?.id ?? null };
}
export function makePlan(result: Interpretation): Plan {
  const getChoice = (key: string) => { const a=result.answers[key]; return a?.type === "choice" ? a : null; };
  const actionAnswer=getChoice("action");
  let action=(actionAnswer && Object.hasOwn(ACTION_NAMES,actionAnswer.choice) ? actionAnswer.choice : "unknown") as Action;
  let reviewReason:string|undefined;
  // A rejected command may still have a meaningful alternative. Show it as a
  // proposal only; retain the raw model answer and require explicit approval.
  if(action==="unknown" && result.mode==="live" && actionAnswer){
    const alternative=Object.entries(actionAnswer.probabilities)
      .filter(([id,p])=>id!=="unknown"&&Object.hasOwn(ACTION_NAMES,id)&&p>=.2)
      .sort((a,b)=>b[1]-a[1])[0];
    if(alternative){
      action=alternative[0] as Action;
      reviewReason=`Jev’s top answer was unsupported. Its alternative was ${ACTION_NAMES[action].toLowerCase()} (${Math.round(alternative[1]*100)}%). Confirm the action and targets below; nothing has changed yet.`;
    }
  }
  const targetKeys = action.startsWith("lights") ? LIGHTS.map(l=>`light_${l.id}`) : ["pip","moss","dot"].map(id=>`robot_${id}`);
  const yes=(key:string) => { const a=result.answers[key]; return a?.type === "noul" ? a.noul : 0; };
  const robots=(["pip","moss","dot"] as RobotId[]).filter(id=>yes(`robot_${id}`)>.5);
  const lights=LIGHTS.filter(l=>yes(`light_${l.id}`)>.5).map(l=>l.id);
  const destAnswer=getChoice("destination");
  const destination=destAnswer && Object.hasOwn(PLACES,destAnswer.choice) ? destAnswer.choice as Place : null;
  const s=result.answers.brightness;
  const brightness=s?.type === "score" ? Math.max(.25, Math.min(1,(s.score+1)/3)) : .65;
  const supported=action!=="unknown" && (action.startsWith("lights") ? lights.length>0 : robots.length>0);
  const needsReview=!!supported && (!!reviewReason || (actionAnswer?.confidence ?? 0)<.55 || targetKeys.some(k=>yes(k)>.25 && yes(k)<.75) || (action==="move" && (!destination || (destAnswer?.confidence??0)<.55)));
  let message = !supported ? "I couldn’t find a supported action and target. Try naming a robot or a light." : action==="move" ? `Send ${robots.join(", ")} to ${destination ? PLACES[destination].name.toLowerCase() : "a place you choose"}.` : action==="water" ? `${robots.join(", ")} will water the garden.` : action==="rest" ? `${robots.join(", ")} will rest at the cabin.` : `Turn ${lights.map(id=>id==="garden"?"the garden lantern":`the ${id} light`).join(" and ")} ${action==="lights_on"?"on":"off"}.`;
  message=message[0].toUpperCase()+message.slice(1);
  return { action, robots, lights, destination, brightness, needsReview, reviewReason, message, supported };
}
export function applyPlan(world: World, plan: Plan): World {
  if (!plan.supported || plan.needsReview || (plan.action==="move" && !plan.destination)) return world;
  if(plan.action.startsWith("lights")) return {...world,lights:{...world.lights,...Object.fromEntries(plan.lights.map(id=>[id,plan.action==="lights_on"?plan.brightness:0]))}};
  const destination = plan.action==="water" ? "garden" : plan.action==="rest" ? "cabin" : plan.destination!;
  return { ...world, robots:world.robots.map((r,index)=>plan.robots.includes(r.id) ? {...r,place:destination,status:destination==="charger"?"charging":plan.action==="water"?"watering":plan.action==="rest"?"resting":"idle",battery:Math.max(0,r.battery-2),x:PLACES[destination].x+(index-1)*3.5,y:PLACES[destination].y+index*2} : r),moisture:plan.action==="water" ? Math.min(100,world.moisture+36*plan.robots.length) : world.moisture };
}

// Explicitly local rules for trying the world without a key. These are not model predictions.
export function interpretDemo(command:string, world:World): Interpretation {
  const started=performance.now(); const c=command.toLowerCase().replace(/[’]/g,"'");
  let action:Action="unknown";
  const excludedClause=c.match(/(?:except|excluding|but (?:not|leave)|without (?:moving|disturbing))\s+(.+)/)?.[1] ?? "";
  const primary=c.split(/\b(?:except|excluding|but|without)\b/)[0];
  const lightContext=/light|lantern|bright|cozy|cosy|illuminate|dark|\bturn\b.*\b(on|off)\b/.test(c);
  if(lightContext) action=/\boff\b|dark|extinguish/.test(primary)?"lights_off":"lights_on";
  else if(/water|thirsty/.test(c)&&/plant|garden|bed/.test(c)) action="water";
  else if(/rest|nap|sleep/.test(primary)) action="rest";
  else if(/send|go|move|head|bring|get|gather|return|charge/.test(primary)) action="move";
  if(/\b(don't|do not|never)\b/.test(primary) || /\bthen\b|\band (?:send|move|water|turn|bring|make)\b/.test(c)) action="unknown";
  let destination:Place|"none"="none";
  if(/inside|indoors|home|cabin/.test(primary)) destination="cabin";
  else if(/garden|plant|bed/.test(primary)) destination="garden";
  else if(/pond|lake/.test(primary)) destination="pond";
  else if(/dock|charg/.test(primary)) destination="charger";
  const exclusion=(r:Robot)=>new RegExp(`\\b${r.id}\\b`).test(excludedClause)||(/charg/.test(excludedClause)&&r.status==="charging")||(/sleep|rest/.test(excludedClause)&&r.status==="resting");
  let selected=world.robots.filter(r=>new RegExp(`\\b${r.id}\\b`).test(primary));
  if(/everyone|everybody|all|whole crew/.test(primary)) selected=world.robots;
  else if(!selected.length&&/someone|anyone|a robot|one robot/.test(primary)) selected=[...world.robots].filter(r=>!["charging","resting"].includes(r.status)&&!exclusion(r)).sort((a,b)=>b.battery-a.battery).slice(0,1);
  selected=selected.filter(r=>!exclusion(r));
  const lightSelected=LIGHTS.filter(l=>(/everything|all|every/.test(primary)||new RegExp(`\\b${l.id}\\b`).test(primary)||(/cozy|cosy/.test(primary)&&!LIGHTS.some(t=>new RegExp(`\\b${t.id}\\b`).test(primary))))&&!new RegExp(`\\b${l.id}\\b`).test(excludedClause));
  const choice=(value:string,options:string[]):ChoiceAnswer=>({type:"choice",choice:value,confidence:1,probabilities:Object.fromEntries(options.map(o=>[o,o===value?1:0]))});
  const answers:Record<string,Answer>={action:choice(action,Object.keys(ACTION_NAMES)),destination:choice(destination,[...Object.keys(PLACES),"none"]),brightness:{type:"score",score:/bright|full/.test(c)?2:/dim|soft|cozy|cosy/.test(c)?0:1,confidence:1,probabilities:{"0":/dim|soft|cozy|cosy/.test(c)?1:0,"1":!(/dim|soft|cozy|cosy|bright|full/.test(c))?1:0,"2":/bright|full/.test(c)?1:0}}};
  for(const r of world.robots) answers[`robot_${r.id}`]={type:"noul",noul:selected.some(s=>s.id===r.id)?1:0};
  for(const l of LIGHTS) answers[`light_${l.id}`]={type:"noul",noul:lightSelected.some(s=>s.id===l.id)?1:0};
  return {answers,mode:"demo",model:"Local rules",latency:Math.max(1,Math.round(performance.now()-started))};
}
