const KEY="concurrency-lab-state";
const DATA={
 semaphore:{title:"Semaphore Playground",intro:"sem_wait decrementa il contatore. Se il valore diventa negativo, il thread si blocca. sem_post incrementa il valore e può risvegliare un thread in attesa.",code:["sem_init(&s, 0, 1);","sem_wait(&s);","// critical section","sem_post(&s);"],steps:[
 ["T0","sem_wait(&s)","wait","T0 decrementa 1 → 0 ed entra nella sezione critica."],
 ["T1","sem_wait(&s)","wait","T1 decrementa 0 → -1 e si blocca. Nel modello teorico del capitolo, il valore negativo indica i thread in attesa."],
 ["T0","sem_post(&s)","post","T0 incrementa -1 → 0 e risveglia T1."],
 ["T1","resume","resume","T1 torna Ready e può proseguire quando viene schedulato."],
 ["T1","sem_post(&s)","post","T1 rilascia il semaforo: il valore torna a 1."]]},
 producer:{title:"Producer / Consumer",intro:"Il bounded buffer usa empty per gli slot liberi, full per gli elementi disponibili e mutex per proteggere gli indici e il buffer.",code:["sem_wait(&empty);","sem_wait(&mutex);","put(value);","sem_post(&mutex);","sem_post(&full);"],steps:[
 ["Consumer","sem_wait(&full)","block","full parte da 0: il consumer si blocca perché il buffer è vuoto."],
 ["Producer","sem_wait(&empty)","run","Esiste uno slot libero: empty diminuisce."],
 ["Producer","sem_wait(&mutex)","lock","Il producer acquisisce il mutex."],
 ["Producer","put(value)","write","Scrive un elemento e aggiorna fill nella sezione critica."],
 ["Producer","sem_post(&mutex)","unlock","Rilascia il mutex."],
 ["Producer","sem_post(&full)","signal","Segnala un elemento disponibile e può risvegliare il consumer."],
 ["Consumer","resume","resume","Il consumer si risveglia e può proseguire."],
 ["Consumer","sem_wait(&mutex)","lock","Acquisisce il mutex per proteggere get/use."],
 ["Consumer","get()","read","Legge l'elemento e aggiorna use."],
 ["Consumer","sem_post(&mutex)","unlock","Rilascia il mutex."],
 ["Consumer","sem_post(&empty)","signal","Segnala che uno slot è nuovamente libero."]]},
 deadlock:{title:"Deadlock: circular wait",intro:"Due thread acquisiscono due lock in ordine opposto. T0 possiede L1 e attende L2; T1 possiede L2 e attende L1.",code:["// T0","lock(L1);","lock(L2);","","// T1","lock(L2);","lock(L1);"],steps:[
 ["T0","lock(L1)","l1","T0 acquisisce L1."],
 ["T1","lock(L2)","l2","T1 acquisisce L2."],
 ["T0","lock(L2)","wait","T0 attende L2, posseduto da T1, mantenendo L1."],
 ["T1","lock(L1)","deadlock","T1 attende L1, posseduto da T0. Si forma un ciclo di attesa: deadlock."]]}}
export function activate(ctx){
 ctx.registerModeRenderer(ctx.manifest.id,"concurrency-lab",{async mount(container,{workspace,storage,signal,setTitle}){
  let saved=await storage.get(KEY); if(signal.aborted)return;
  let scenario=DATA[saved?.scenario]?saved.scenario:"semaphore", index=0, log=[], value=Number.isInteger(saved?.initialValue)?saved.initialValue:1, blocked=false;
  const listeners=[], make=(tag,cls,txt)=>{let n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n};
  const root=make("div","cl-root"),head=make("header",""),tabs=make("nav","cl-tabs"),grid=make("div","cl-grid"),left=make("section","cl-panel"),right=make("section","cl-panel"),history=make("section","cl-panel");
  head.append(make("div","cl-eyebrow","OPERATING SYSTEMS · INTERACTIVE LAB"),make("h2","cl-title","Concurrency Lab"),make("p","cl-muted","Scegli lo scheduling, osserva lo stato e ricostruisci il bug passo dopo passo."));
  grid.append(left,right);root.append(head,tabs,grid,history,make("p","cl-footer","Simulazione didattica deterministica: non vengono creati thread reali e non viene eseguito codice C."));
  container.replaceChildren(root);if(setTitle)await setTitle("Concurrency Lab");
  const save=async()=>storage.set(KEY,{version:1,scenario,initialValue:value,lastVisited:new Date().toISOString()});
  const btn=(txt,fn,cls="")=>{let b=make("button","cl-btn "+cls,txt);b.type="button";b.addEventListener("click",fn);listeners.push([b,fn]);return b};
  const reset=()=>{index=0;log=[];blocked=false;render()};
  const choose=async id=>{scenario=id;value=Number(saved?.initialValue??1);reset();await save()};
  const step=async()=>{let s=DATA[scenario].steps[index];if(!s||blocked)return;log.push(s);index++;if(s[2]==="wait"&&scenario==="semaphore")value--;if(s[2]==="post"&&scenario==="semaphore")value++;if(s[2]==="deadlock")blocked=true;await save();render()};
  const metric=(label,val)=>{let d=make("div","cl-metric");d.append(make("span","cl-muted",label),make("strong","",val));return d};
  function render(){
   tabs.replaceChildren();for(let [id,label] of [["semaphore","Semaforo"],["producer","Producer / Consumer"],["deadlock","Deadlock"]])tabs.append(btn(label,()=>void choose(id),id===scenario?"selected":""));
   let d=DATA[scenario];left.replaceChildren(make("div","cl-eyebrow","SCENARIO"),make("h3","cl-h3",d.title),make("p","cl-muted",d.intro));
   let controls=make("div","cl-controls");controls.append(btn("Step successivo",()=>void step(),"primary"),btn("Auto Run",async()=>{while(index<DATA[scenario].steps.length&&!signal.aborted&&!blocked){await step();await new Promise(r=>setTimeout(r,450))}}),btn("Reset",reset));left.append(controls,make("div","cl-eyebrow","CODICE / SEQUENZA"));
   let code=make("div","cl-code");d.code.forEach((line,i)=>{let row=make("div","cl-line"+(i===Math.min(index,d.code.length-1)?" current":""));row.append(make("span","cl-ln",String(i+1).padStart(2,"0")),make("code","",line||" "));code.append(row)});left.append(code);
   right.replaceChildren(make("div","cl-eyebrow","STATO DEL SISTEMA"));
   let metrics=make("div","cl-metrics");if(scenario==="semaphore"){metrics.append(metric("Valore semaforo",String(value)),metric("Thread in attesa",String(Math.max(0,-value))))}else if(scenario==="producer"){metrics.append(metric("Buffer","1 / 3"),metric("Semafori","empty · full · mutex"))}else{metrics.append(metric("Lock L1","T0"),metric("Lock L2","T1"))}right.append(metrics);
   let threads=make("div","cl-threads");threads.append(metric("Thread T0",scenario==="deadlock"?(index>0?"Possiede L1":"Ready"):"Ready / Running"),metric("Thread T1",blocked?"Waiting · deadlock":index>1?"Ready / Running":"Ready"));right.append(make("div","cl-eyebrow","THREAD"),threads);
   if(blocked)right.append(make("div","cl-alert","DEADLOCK RILEVATO · T0 attende L2 e T1 attende L1. Il grafo delle attese contiene un ciclo."));
   if(index===d.steps.length)right.append(make("div","cl-done","Scenario completato."));
   history.replaceChildren(make("div","cl-eyebrow","EXECUTION LOG"));if(!log.length)history.append(make("p","cl-muted","Nessuna istruzione eseguita."));
   log.forEach((s,i)=>{let item=make("div","cl-event");item.append(make("strong","",`${i+1}. ${s[0]} · ${s[1]}`),make("p","cl-muted",s[3]));history.append(item)});
  }
  render();
  return()=>{for(let [n,f]of listeners)n.removeEventListener("click",f);container.replaceChildren()};
 }});
}
