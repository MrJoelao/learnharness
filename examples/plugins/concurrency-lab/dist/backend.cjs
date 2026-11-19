exports.activate = (ctx) => ctx.registerMode({
  id:"concurrency-lab", name:"Concurrency Lab",
  description:"Laboratori interattivi per semafori, scheduling, bounded buffer e deadlock.",
  category:"Operating Systems", icon:"Code",
  image:"assets/banner.svg",
  tags:["operating-systems","concurrency","semaphores","threads","deadlock"],
  difficulty:"intermediate", activityType:"exploration",
  capabilities:["simulation","manual-scheduling","persistent-workspace"],
  initializeWorkspace({storage}) {
    storage.set("concurrency-lab-state",{version:1,scenario:"semaphore",initialValue:1,lastVisited:new Date().toISOString()});
  }
});
