/* =====================================================================
   PAPER AMONG US — "Funsion" mansion prototype  (v2)
   Vanilla JS. Sections:
     1. MAP DATA (generated grid)   2. UTILS      3. STATE / SETUP
     4. INPUT      5. UPDATE        6. BOT AI     7. TASKS + CONSOLES
     8. SABOTAGE   9. MEETINGS/CHAT 10. RENDER   11. SCORES / UI
   ===================================================================== */

/* ============================= 1. MAP DATA ==========================
   The mansion is a 4x3 grid of big rooms joined by real corridors.
   Everything (doors, waypoints, vents, consoles) is derived from the
   grid so the map can be resized in one place.
   ==================================================================== */
// Room size + the gap between rooms (the gap IS the hallway band, so a bigger
// gap means wider hallways). Everything else is derived from these numbers.
const RW=340, RH=300, GX=130, GY=130, OX=150, OY=150;
const GRID=[
  ["medbay","master","guest","security"],
  ["admin","living","kitchen","back"],
  ["front","reactor","basement","electrical"],
];
const NAMES={medbay:"Medbay",master:"Master Bedroom",guest:"Guest Bedroom",security:"Security",
  admin:"Admin's Office",living:"Living Room",kitchen:"Kitchen",back:"Back Doors",
  front:"Front Doors",reactor:"Reactor",basement:"Basement",electrical:"Electrical"};
const ROOMS={};
GRID.forEach((row,r)=>row.forEach((id,c)=>{
  ROOMS[id]={name:NAMES[id],x:OX+c*(RW+GX),y:OY+r*(RH+GY),w:RW,h:RH};
}));
const ROOM_IDS=Object.keys(ROOMS);

function mkDoor(a,b,rects,wp,lockable){return {a,b,rects,wp,lockable:lockable!==false,locked:0};}

const DOOR_W=120;   // width of a straight doorway corridor
const HALL_W=100;   // width of the long L-shaped hallways

/* Straight corridor between two horizontally / vertically adjacent rooms.
   Rects are padded a few px into each room so the doorway always overlaps
   the wall and never leaves a 1px gap you can get stuck on. */
function hDoor(a,b){
  const A=ROOMS[a],B=ROOMS[b];
  const x=A.x+A.w, w=B.x-x, y=A.y+A.h/2-DOOR_W/2;
  return mkDoor(a,b,[[x-6,y,w+12,DOOR_W]],[[x+w/2,y+DOOR_W/2]]);
}
function vDoor(a,b){
  const A=ROOMS[a],B=ROOMS[b];
  const y=A.y+A.h, h=B.y-y, x=A.x+A.w/2-DOOR_W/2;
  return mkDoor(a,b,[[x,y-6,DOOR_W,h+12]],[[x+DOOR_W/2,y+h/2]]);
}

/* --------------------------------------------------------------------
   pathDoor(): builds an L / Z shaped hallway from a polyline.
   Every consecutive pair of points MUST share an x or a y, so each
   segment is strictly vertical or horizontal — never diagonal.
   Each segment rect is grown by half the hall width at both ends, so
   corners join squarely and the end points poke into the rooms.
   -------------------------------------------------------------------- */
function pathDoor(a,b,pts,T){
  T=T||HALL_W;
  const h=T/2, rects=[];
  for(let i=0;i<pts.length-1;i++){
    const [x1,y1]=pts[i], [x2,y2]=pts[i+1];
    if(y1===y2)      rects.push([Math.min(x1,x2)-h, y1-h, Math.abs(x2-x1)+T, T]); // horizontal
    else if(x1===x2) rects.push([x1-h, Math.min(y1,y2)-h, T, Math.abs(y2-y1)+T]); // vertical
    else console.warn("pathDoor: diagonal segment",a,b,i);
  }
  return mkDoor(a,b,rects,pts.map(p=>[p[0],p[1]]));
}

const DOORS=[
  hDoor("medbay","master"), hDoor("master","guest"), hDoor("guest","security"),
  hDoor("admin","living"),  hDoor("living","kitchen"), hDoor("kitchen","back"),
  hDoor("reactor","basement"), hDoor("basement","electrical"),
  vDoor("master","living"), vDoor("guest","kitchen"), vDoor("kitchen","basement"),
  // Z-hallway: Living Room (top edge) -> UP -> RIGHT -> UP -> Guest Bedroom
  pathDoor("living","guest",[[900,580],[900,515],[1150,515],[1150,450]]),
  // Z-hallway: Front Doors (top edge) -> UP -> RIGHT -> UP -> Living Room
  pathDoor("front","living",[[350,1010],[350,945],[700,945],[700,880]]),
  // Bottom perimeter hallway: Reactor -> DOWN -> RIGHT -> UP -> Electrical
  pathDoor("reactor","electrical",[[750,1310],[750,1385],[1720,1385],[1720,1310]]),
  // Outer perimeter hallway: Security -> UP -> LEFT -> DOWN -> RIGHT -> Admin
  pathDoor("security","admin",[[1620,150],[1620,90],[90,90],[90,700],[150,700]]),
];
const MAP_BOUNDS={x0:20,y0:20,x1:1980,y1:1450};

// adjacency graph for bot pathing
const ADJ={}; ROOM_IDS.forEach(r=>ADJ[r]=[]);
DOORS.forEach(d=>{ADJ[d.a].push({room:d.b,door:d});ADJ[d.b].push({room:d.a,door:d});});

// all walkable rects
const WALK=[];
ROOM_IDS.forEach(id=>{const r=ROOMS[id];WALK.push([r.x,r.y,r.w,r.h]);});
DOORS.forEach(d=>d.rects.forEach(r=>WALK.push(r)));

/* -------- vents: named network, each vent knows its neighbours -------- */
const VENT_GROUPS=[
  ["medbay","security","admin"],
  ["kitchen","living"],
  ["front","back"],
  ["master","guest"],
  ["reactor","electrical"],
];
const VENTS=[];
VENT_GROUPS.forEach((g,gi)=>g.forEach(rid=>{
  const r=ROOMS[rid];
  VENTS.push({room:rid,x:r.x+r.w-56,y:r.y+r.h-56,group:gi,open:0});
}));
function ventLinks(v){return VENTS.filter(o=>o.group===v.group&&o!==v);}

const CAM_SPOTS=["front","living","basement","reactor"];

/* ---------------------------- ROOM DECOR ----------------------------
   Purely visual paper furniture so each room reads at a glance.
   Coordinates are fractions of the room, so they scale with the grid.
   type: bed | table | rug | plant | box | screen | pipe | door | counter
   -------------------------------------------------------------------- */
const DECOR={
  medbay:  [["bed",.22,.30,.30,.26],["bed",.22,.62,.30,.26],["screen",.76,.30,.30,.20]],
  master:  [["bed",.30,.34,.44,.34],["table",.80,.30,.22,.18],["rug",.35,.78,.42,.16]],
  guest:   [["bed",.28,.32,.38,.30],["box",.78,.72,.20,.18],["plant",.82,.30,.14,.20]],
  security:[["screen",.30,.28,.34,.22],["screen",.68,.28,.26,.22],["table",.50,.70,.34,.16]],
  admin:   [["table",.50,.62,.52,.28],["screen",.24,.26,.28,.18],["box",.80,.78,.18,.16]],
  living:  [["rug",.50,.62,.56,.30],["table",.24,.30,.26,.18],["plant",.84,.28,.14,.22],
            ["counter",.78,.74,.24,.14]],
  kitchen: [["counter",.50,.26,.66,.16],["table",.32,.66,.32,.22],["box",.80,.68,.18,.18]],
  back:    [["door",.50,.20,.44,.12],["box",.26,.70,.22,.20],["box",.72,.72,.18,.16]],
  front:   [["door",.50,.20,.44,.12],["rug",.50,.66,.44,.18],["plant",.20,.36,.14,.22]],
  reactor: [["pipe",.50,.26,.70,.12],["screen",.24,.62,.26,.20],["screen",.76,.62,.26,.20]],
  basement:[["box",.26,.34,.22,.20],["box",.30,.70,.26,.22],["pipe",.72,.30,.36,.10],
            ["box",.78,.72,.20,.18]],
  electrical:[["screen",.28,.30,.28,.22],["pipe",.50,.66,.62,.12],["box",.80,.32,.18,.18]],
};

const SYSTEMS=[
  {id:"admin",room:"admin",label:"ADMIN TABLE",x:0.5,y:0.42},
  {id:"cams",room:"security",label:"CAMERAS",x:0.5,y:0.42},
  {id:"vitals",room:"medbay",label:"VITALS",x:0.5,y:0.42},
  {id:"emerg",room:"living",label:"EMERGENCY",x:0.5,y:0.40},
];

/* -------- tasks: each has a physical console you must walk to -------- */
const TASK_DEFS=[
  {name:"Medbay Scan",room:"medbay",type:"hold",visual:"scan"},
  {name:"Get the Mail",room:"front",type:"clicks"},
  {name:"Deliver Package",room:"front",type:"hold",visual:"package"},
  {name:"Throw the Trash Out",room:"back",type:"hold",visual:"trash"},
  {name:"Make Breakfast",room:"kitchen",type:"seq",visual:"cook"},
  {name:"Wash the Dishes",room:"kitchen",type:"clicks"},
  {name:"Fix the Fuse Box",room:"electrical",type:"toggle"},
  {name:"Start the Generator",room:"electrical",type:"hold",visual:"gen"},
  {name:"Sort Documents",room:"admin",type:"seq"},
  {name:"Check Security Cameras",room:"security",type:"hold"},
  {name:"Reboot Security System",room:"security",type:"toggle"},
  {name:"Stabilize Reactor",room:"reactor",type:"seq"},
  {name:"Replace Reactor Rod",room:"reactor",type:"clicks"},
  {name:"Change Bed Sheets",room:"master",type:"toggle"},
  {name:"Clean Guest Room",room:"guest",type:"clicks"},
  {name:"Water Plants",room:"living",type:"hold",visual:"water"},
  {name:"Repair the Door Lock",room:"basement",type:"seq"},
];
// place consoles on fixed slots inside each room so nothing overlaps
(function placeConsoles(){
  const slots=[[0.20,0.72],[0.50,0.80],[0.80,0.72],[0.20,0.35],[0.80,0.35]];
  const used={};
  TASK_DEFS.forEach((t,i)=>{
    const n=used[t.room]=(used[t.room]||0);
    used[t.room]++;
    const s=slots[n%slots.length],r=ROOMS[t.room];
    t.x=r.x+r.w*s[0];t.y=r.y+r.h*s[1];t.i=i;
  });
})();

const COLORS=[
  ["Red","#e0554a"],["Blue","#4a7fd9"],["Green","#4c9c54"],["Pink","#ea86bd"],
  ["Orange","#e9913c"],["Yellow","#e9d24a"],["Black","#4b4741"],["White","#f2eee2"],
  ["Purple","#8c62c4"],["Brown","#8a6244"],["Cyan","#5fc9cf"],["Lime","#a4d84a"],
];

/* ============================== 2. UTILS ============================ */
const $=s=>document.querySelector(s);
const rnd=(a,b)=>a+Math.random()*(b-a);
const ri=(a,b)=>Math.floor(rnd(a,b+1));
const pick=a=>a[Math.floor(Math.random()*a.length)];
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=ri(0,i);[a[i],a[j]]=[a[j],a[i]];}return a;}
function inRect(x,y,r){return x>=r[0]&&x<=r[0]+r[2]&&y>=r[1]&&y<=r[1]+r[3];}
function walkableP(x,y){for(const r of WALK) if(inRect(x,y,r)) return true; return false;}
function canStand(x,y){const r=12;
  return walkableP(x,y)&&walkableP(x-r,y)&&walkableP(x+r,y)&&walkableP(x,y-r)&&walkableP(x,y+r);}
function roomAt(x,y){for(const id of ROOM_IDS){const r=ROOMS[id];
  if(inRect(x,y,[r.x,r.y,r.w,r.h]))return id;} return null;}
function roomCenter(id){const r=ROOMS[id];return{x:r.x+r.w/2,y:r.y+r.h/2};}
function randPointIn(id){const r=ROOMS[id];return{x:rnd(r.x+45,r.x+r.w-45),y:rnd(r.y+45,r.y+r.h-45)};}
function roomName(id){return id?ROOMS[id].name:"the hallway";}
function wob(seed){const s=Math.sin(seed*127.1)*43758.5453;return (s-Math.floor(s))*2-1;}

/* ========================= 3. STATE / SETUP ========================= */
const cv=$("#game"),ctx=cv.getContext("2d");
let W=0,H=0,DPR=1;
function resize(){DPR=Math.min(window.devicePixelRatio||1,2);
  W=innerWidth;H=innerHeight;cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);}
addEventListener("resize",resize);resize();

const S={
  phase:"menu",paused:false,
  settings:{players:9,imps:2,killCd:20,roleCd:25,uses:2,tasks:4,speed:165,meetings:1,sabCd:20,role:"random",name:"YOU"},
  players:[],me:null,bodies:[],particles:[],visuals:[],
  cam:{x:790,y:730},shake:0,t:0,score:0,
  sabotage:null,meeting:null,hauntedBy:null,inVent:null,
  killCd:0,sabCd:0,abilityCd:0,abilityUses:0,
  meetingsLeft:1,invisible:0,extraCams:[],
  totalTasks:0,doneTasks:0,traitorKills:0,statKills:0,statTasks:0,
  myMemory:[],myRooms:[],myVents:[],ventAnim:0,ventCd:0,
};

function makePlayer(i,color,name,isBot){
  return {id:i,color:color[1],cname:color[0],name,isBot,
    x:0,y:0,alive:true,role:"Crewmate",team:"crew",tasks:[],room:"living",face:1,bob:rnd(0,6),
    inVent:null,
    bot:{wps:[],goal:null,think:0,killCd:8,work:0,workTask:null,ventCd:14,selfReport:0,
         memory:[],susp:{},trust:{},stuck:0,lx:0,ly:0,lastRoom:"living",
         seenSet:new Set(),alibi:null,accusedBy:{},saidCount:0,witness:null,
         shock:0,avoidBody:null,fleeing:0,buddy:null,selfReported:false,lastKillRoom:null},
    haunt:0,hauntTarget:null,ejected:false};
}
function roleTeam(role){
  if(["Impostor","Swapper","Hacker"].includes(role))return "imp";
  if(role==="Traitor")return "neutral";
  return "crew";
}
/* ------------------------- GHOST ROLES -------------------------------
   When you die your team decides which kind of ghost you become:
     Impostor team -> WRAITH  : can haunt a living crewmate (timed kill)
     Crewmate team -> SPIRIT  : can still do tasks and fix sabotages
     Neutral       -> GHOST   : a plain ghost, no powers at all
   -------------------------------------------------------------------- */
const GHOST_ROLES={
  imp:{name:"Wraith",desc:"Haunt a crewmate — if no meeting is called, they die.",
       color:"#8c62c4",canHaunt:true,canTask:false,canFix:false},
  crew:{name:"Spirit",desc:"Keep doing your tasks and fix sabotages for the crew.",
       color:"#5fc9cf",canHaunt:false,canTask:true,canFix:true},
  neutral:{name:"Ghost",desc:"You have no powers. Drift and watch.",
       color:"#b8ab90",canHaunt:false,canTask:false,canFix:false},
};
// the ghost profile for a player (only meaningful once they're dead)
function ghostRole(p){return GHOST_ROLES[p.team]||GHOST_ROLES.neutral;}
// called the moment a player dies / is ejected
function becomeGhost(p){
  if(p.ghost)return;
  p.ghost=ghostRole(p);
  if(p===S.me){
    // fresh ability budget for the ghost power (Wraith haunts, others none)
    S.abilityUses=p.ghost.canHaunt?Math.max(1,S.settings.uses):0;
    S.abilityCd=p.ghost.canHaunt?S.settings.roleCd*0.5:0;
    setTimeout(()=>{banner("YOU ARE NOW A "+p.ghost.name.toUpperCase(),2200);
      toast(p.ghost.desc);},1500);
    updateHUD();refreshTaskList();
  }
}

function setupGame(){
  const st=S.settings;
  Object.assign(S,{players:[],bodies:[],particles:[],visuals:[],sabotage:null,meeting:null,
    score:0,killCd:st.killCd,sabCd:st.sabCd,abilityCd:st.roleCd,abilityUses:st.uses,
    meetingsLeft:st.meetings,invisible:0,extraCams:[],traitorKills:0,statKills:0,statTasks:0,
    hauntedBy:null,inVent:null,myMemory:[],myRooms:[],myVents:[],ventAnim:0,ventCd:0,
    roomLabel:null,_lastRoomShown:null,bodiesFoundCount:0,lastReport:null});
  DOORS.forEach(d=>d.locked=0);
  const cols=shuffle(COLORS.slice()).slice(0,st.players);
  for(let i=0;i<st.players;i++)
    S.players.push(makePlayer(i,cols[i],i===0?(st.name||"YOU").toUpperCase():cols[i][0].toUpperCase(),i!==0));
  S.me=S.players[0];

  // ---- roles (bots only ever get Crewmate / Impostor) ----
  let impNeeded=st.imps;
  if(st.role!=="random"){S.me.role=st.role;if(roleTeam(st.role)==="imp")impNeeded--;}
  else{
    const roll=Math.random();
    if(roll<st.imps/st.players){S.me.role=pick(["Impostor","Swapper","Hacker"]);impNeeded--;}
    else if(roll<0.16+st.imps/st.players)S.me.role="Traitor";
    else S.me.role=pick(["Crewmate","Crewmate","Security","Spy"]);
  }
  const others=shuffle(S.players.slice(1));
  for(let i=0;i<Math.max(0,impNeeded)&&i<others.length;i++)others[i].role="Impostor";
  S.players.forEach(p=>p.team=roleTeam(p.role));

  // ---- tasks ----
  S.totalTasks=0;S.doneTasks=0;
  S.players.forEach(p=>{
    const defs=shuffle(TASK_DEFS.slice()).slice(0,st.tasks);
    p.tasks=defs.map(d=>({def:d,name:d.name,room:d.room,type:d.type,visual:d.visual,
                          x:d.x,y:d.y,done:false,fake:p.team==="imp"}));
    if(p.team==="crew")S.totalTasks+=p.tasks.length;
  });

  // ---- spawn: bots pick an entrance now, the human picks on the spawn screen ----
  S.players.forEach(p=>{
    p.alive=true;p.ejected=false;p.inVent=null;p.ghost=null;
    p.bot.killCd=8;p.bot.memory=[];p.bot.susp={};p.bot.trust={};
    p.spawnRoom=p.isBot?(Math.random()<0.5?"front":"back"):"front";
  });
  placeAtSpawn();
  S.cam.x=S.me.x;S.cam.y=S.me.y;
  S.phase="play";S.paused=true;      // frozen until the reveal is dismissed
  hideAll();$("#hud").classList.remove("hidden");
  updateHUD();refreshTaskList();
  showReveal();
}

/* Arrange everyone in a neat ring inside whichever entrance they chose. */
function placeAtSpawn(){
  ["front","back"].forEach(rid=>{
    const group=S.players.filter(p=>p.spawnRoom===rid);
    const c=roomCenter(rid);
    group.forEach((p,i)=>{
      const a=i/Math.max(1,group.length)*Math.PI*2;
      const rad=group.length<=1?0:70+group.length*4;
      p.x=c.x+Math.cos(a)*rad;p.y=c.y+Math.sin(a)*rad*0.75;
      p.room=rid;p.bot.lastRoom=rid;p.bot.wps=[];
    });
  });
  S.cam.x=S.me.x;S.cam.y=S.me.y;
}

/* -------------------------- SPAWN SELECT --------------------------- */
function showSpawnSelect(){
  const cnt=r=>S.players.filter(p=>p.isBot&&p.spawnRoom===r).length;
  $("#spawnFrontCount").textContent=cnt("front")+" others here";
  $("#spawnBackCount").textContent=cnt("back")+" others here";
  $("#spawn").classList.remove("hidden");
  document.querySelectorAll(".spawn-opt").forEach(b=>b.onclick=()=>{
    S.me.spawnRoom=b.dataset.r;
    placeAtSpawn();
    $("#spawn").classList.add("hidden");
    S.paused=false;
    banner("GO!",900);toast(roleBlurb(S.me.role));
    puff(S.me.x,S.me.y,S.me.color,14);shakeIt(.4);
  });
}

/* --------------------------- ROLE REVEAL ----------------------------
   Shows "TEAM / [ROLE]" plus a lineup that depends on the team:
     Crewmate -> the whole crew (you can't know who's who)
     Neutral  -> only yourself (you're on your own)
     Impostor -> your fellow impostors, with YOU in the middle
   -------------------------------------------------------------------- */
function showReveal(){
  const me=S.me;
  const teamLabel={crew:"CREWMATE",imp:"IMPOSTOR",neutral:"NEUTRAL"}[me.team];
  const teamEl=$("#revealTeam");
  teamEl.textContent=teamLabel;
  teamEl.className=me.team==="imp"?"imp":me.team==="neutral"?"neutral":"";
  $("#revealRole").textContent=me.role;
  $("#revealDesc").textContent=roleBlurb(me.role)+"  "+
    (me.team==="imp"?"Kill the crew or sabotage them into oblivion."
     :me.team==="neutral"?"You win alone."
     :"Finish the tasks or vote out every impostor.");

  // ---- build the lineup ----
  let line;
  if(me.team==="crew")      line=S.players.slice();                     // everyone
  else if(me.team==="neutral")line=[me];                                // just you
  else{                                                                  // impostors, you centred
    const mates=S.players.filter(p=>p.team==="imp"&&p!==me);
    line=[];
    mates.forEach((m,i)=>{ i%2===0 ? line.unshift(m) : line.push(m); });
    line.splice(Math.floor(line.length/2),0,me);
  }
  $("#revealCrew").innerHTML=line.map((p,i)=>
    `<div class="rvp ${p===me?"me":""}" style="animation-delay:${0.18+i*0.07}s">
       <div class="sheet" style="background:${p.color}"></div>
       <span>${p===me?"YOU":p.name}</span>
     </div>`).join("");
  $("#revealHint").textContent=
    (me.team==="imp"&&line.length>1?"These are your fellow impostors. ":"")+
    "tap / press any key to begin";

  $("#reveal").classList.remove("hidden");
  // dismiss on any input (small delay stops an accidental instant skip)
  setTimeout(()=>{
    const go=()=>{
      $("#reveal").classList.add("hidden");
      removeEventListener("keydown",go);removeEventListener("pointerdown",go);
      S._revealGo=null;
      showSpawnSelect();          // stays paused until an entrance is chosen
    };
    addEventListener("keydown",go);addEventListener("pointerdown",go);
    S._revealGo=go;
    setTimeout(()=>{if(!$("#reveal").classList.contains("hidden"))go();},9000);
  },500);
}
function roleBlurb(r){return{
  Crewmate:"Walk to the yellow consoles to do tasks.",
  Impostor:"Kill, vent, sabotage.",
  Swapper:"Ability: swap two players' positions.",
  Hacker:"Comms sabotage greys everyone out.",
  Traitor:"Finish tasks OR get 3 kills to win.",
  Security:"Ability: mount extra cameras.",
  Spy:"Ability: go invisible (can't act while invisible).",
}[r]||"";}

/* ============================== 4. INPUT ============================ */
const keys={};
addEventListener("keydown",e=>{
  keys[e.key.toLowerCase()]=true;
  if(!$("#reveal").classList.contains("hidden"))return;   // reveal eats input
  if(e.key==="Escape"&&S.phase==="play")togglePause();
  if(S.phase==="play"&&!S.paused&&!panelOpen){
    const k=e.key.toLowerCase();
    if(k==="e")doAction("use"); if(k==="q")doAction("kill");
    if(k==="r")doAction("report"); if(k==="f")doAction("vent");
    if(k==="c")doAction("ability"); if(k==="x")doAction("sabotage");
  }
  if(S.phase==="over"&&e.key.toLowerCase()==="r")setupGame();
  if([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(e.key.toLowerCase()))e.preventDefault();
});
addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);

let stick={on:false,id:null,ox:0,oy:0,dx:0,dy:0};
const stickEl=$("#stick"),nubEl=$("#stickNub");
cv.addEventListener("pointerdown",e=>{
  if(S.phase==="play"&&S.inVent&&ventClick(e.clientX,e.clientY))return;
  if(e.clientX>W*0.62)return;
  stick.on=true;stick.id=e.pointerId;stick.ox=e.clientX;stick.oy=e.clientY;
  stickEl.style.left=(e.clientX-60)+"px";stickEl.style.top=(e.clientY-60)+"px";
  stickEl.style.bottom="auto";stickEl.classList.add("on");
});
addEventListener("pointermove",e=>{
  if(!stick.on||e.pointerId!==stick.id)return;
  let dx=e.clientX-stick.ox,dy=e.clientY-stick.oy;
  const m=Math.hypot(dx,dy),max=48;
  if(m>max){dx=dx/m*max;dy=dy/m*max;}
  stick.dx=dx/max;stick.dy=dy/max;
  nubEl.style.left=(35+dx)+"px";nubEl.style.top=(35+dy)+"px";
});
addEventListener("pointerup",e=>{
  if(e.pointerId!==stick.id)return;
  stick.on=false;stick.dx=stick.dy=0;stickEl.classList.remove("on");
  nubEl.style.left="35px";nubEl.style.top="35px";
});
document.querySelectorAll(".act").forEach(b=>b.addEventListener("click",()=>doAction(b.dataset.a)));

/* ============================== 5. UPDATE =========================== */
let last=performance.now();
function loop(now){
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  if(S.phase==="play"&&!S.paused&&!S.meeting)update(dt);
  render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function update(dt){
  S.t+=dt;
  S.killCd=Math.max(0,S.killCd-dt);
  S.sabCd=Math.max(0,S.sabCd-dt);
  S.abilityCd=Math.max(0,S.abilityCd-dt);
  if(S.invisible>0){S.invisible-=dt;if(S.invisible<=0)toast("You are visible again");}
  DOORS.forEach(d=>{if(d.locked>0)d.locked-=dt;});

  // ---- human movement (inside a vent the stick steers between vents) ----
  const me=S.me;
  S.ventCd=Math.max(0,(S.ventCd||0)-dt);
  S.ventAnim=Math.max(0,(S.ventAnim||0)-dt);
  let ix=(keys.a||keys.arrowleft?-1:0)+(keys.d||keys.arrowright?1:0);
  let iy=(keys.w||keys.arrowup?-1:0)+(keys.s||keys.arrowdown?1:0);
  ix+=stick.dx;iy+=stick.dy;
  const m=Math.hypot(ix,iy);if(m>1){ix/=m;iy/=m;}
  if(S.inVent){ ventSteer(ix,iy); }
  else{
    const spd=S.settings.speed*(me.alive?1:1.35)*(panelOpen?0:1);
    moveEntity(me,ix*spd*dt,iy*spd*dt,!me.alive);
    if(ix!==0)me.face=ix>0?1:-1;
    if(m>0.1)me.bob+=dt*12;
  }
  // remember what *I* see, for the chat menu
  if(me.alive&&!S.inVent){
    S.players.forEach(p=>{
      if(p===me||!p.alive||p.inVent)return;
      if(p.room===me.room&&dist(p,me)<260){
        const old=S.myMemory.find(m=>m.id===p.id&&m.room===p.room);
        if(old)old.t=S.t; else S.myMemory.push({id:p.id,room:p.room,t:S.t});
      }
    });
    if(S.myRooms[0]!==me.room&&me.room)S.myRooms.unshift(me.room);
    if(S.myRooms.length>4)S.myRooms.length=4;
    if(S.myMemory.length>18)S.myMemory.splice(0,S.myMemory.length-18);
  }

  S.players.forEach(p=>{if(p.isBot)botUpdate(p,dt);});

  // ---- Wraith haunt ----
  if(me.hauntTarget){
    me.haunt-=dt;
    if(me.haunt<=0){
      const t=S.players.find(p=>p.id===me.hauntTarget);
      if(t&&t.alive){killPlayer(t,me,true);toast("Your haunt claimed "+t.name+"!");}
      me.hauntTarget=null;S.hauntedBy=null;
    }
  }

  // ---- sabotage ----
  if(S.sabotage&&S.sabotage.timer!==undefined){
    S.sabotage.timer-=dt;
    if(S.sabotage.timer<=0)return endGame("imp","The reactor melted down.");
    if(S.sabotage.type==="reactor"){
      const rc=ROOMS.reactor;
      const padA={x:rc.x+70,y:rc.y+rc.h/2+20},padB={x:rc.x+rc.w-70,y:rc.y+rc.h/2+20};
      // a dead Spirit can hold a reactor pad; Wraiths and plain Ghosts cannot
      const on=p=>p.alive||(p===S.me&&(S.me.ghost||ghostRole(S.me)).canFix);
      S.sabotage.fixA=S.players.some(p=>on(p)&&dist(p,padA)<44);
      S.sabotage.fixB=S.players.some(p=>on(p)&&dist(p,padB)<44);
      if(S.sabotage.fixA&&S.sabotage.fixB)fixSabotage();
    }
  }

  // ---- particles / visual task fx ----
  for(let i=S.particles.length-1;i>=0;i--){
    const q=S.particles[i];q.x+=q.vx*dt;q.y+=q.vy*dt;q.vy+=260*dt;q.rot+=q.vr*dt;q.life-=dt;
    if(q.life<=0)S.particles.splice(i,1);
  }
  for(let i=S.visuals.length-1;i>=0;i--){
    const v=S.visuals[i];v.t-=dt;if(v.t<=0)S.visuals.splice(i,1);
  }
  if(S.shake>0)S.shake=Math.max(0,S.shake-dt*2.6);

  S.cam.x+=(me.x-S.cam.x)*Math.min(1,dt*6);
  S.cam.y+=(me.y-S.cam.y)*Math.min(1,dt*6);
  S.players.forEach(p=>{const r=roomAt(p.x,p.y);if(r)p.room=r;});

  // show the room name briefly whenever you walk into a new room
  if(me.room!==S._lastRoomShown){
    S._lastRoomShown=me.room;
    S.roomLabel={name:roomName(me.room),t:2.2};
  }
  if(S.roomLabel)S.roomLabel.t-=dt;

  updateActionButtons();
  checkWin();
}

function moveEntity(p,dx,dy,ghost){
  if(ghost){p.x=clamp(p.x+dx,MAP_BOUNDS.x0,MAP_BOUNDS.x1);
            p.y=clamp(p.y+dy,MAP_BOUNDS.y0,MAP_BOUNDS.y1);return;}
  if(dx&&canStand(p.x+dx,p.y)&&!doorBlocked(p.x+dx,p.y))p.x+=dx;
  if(dy&&canStand(p.x,p.y+dy)&&!doorBlocked(p.x,p.y+dy))p.y+=dy;
}
function doorBlocked(x,y){
  for(const d of DOORS) if(d.locked>0) for(const r of d.rects) if(inRect(x,y,r)) return true;
  return false;
}

function checkWin(){
  const alive=S.players.filter(p=>p.alive);
  const imps=alive.filter(p=>p.team==="imp"),crew=alive.filter(p=>p.team!=="imp");
  if(S.doneTasks>=S.totalTasks&&S.totalTasks>0)return endGame("crew","All tasks complete!");
  if(!imps.length)return endGame("crew","All impostors are gone.");
  if(imps.length>=crew.length)return endGame("imp","Impostors outnumber the crew.");
  const tr=S.players.find(p=>p.role==="Traitor"&&p.alive);
  if(tr){
    if(S.traitorKills>=3)return endGame("neutral","The Traitor got 3 kills.");
    if(tr.tasks.length&&tr.tasks.every(t=>t.done))return endGame("neutral","The Traitor finished every task.");
  }
}
function endGame(who,why){
  if(S.phase==="over")return;
  S.phase="over";
  const won=(who===S.me.team);
  if(won)S.score+=1000;
  hideAll();$("#hud").classList.add("hidden");
  $("#overTitle").textContent=who==="crew"?"CREWMATES WIN":who==="imp"?"IMPOSTORS WIN":"TRAITOR WINS";
  $("#overTitle").style.color=who==="crew"?"#4c9c54":who==="imp"?"#e0554a":"#8c62c4";
  $("#overSub").textContent=why+"  You were the "+S.me.role+" — "+(won?"VICTORY!":"defeat.");
  $("#overScore").innerHTML=`<div class="row"><b>SCORE ${S.score}</b></div>
    <div class="tiny-note">tasks ${S.statTasks} · kills ${S.statKills}</div>`;
  saveScore(S.score,S.me.role,won);
  $("#over").classList.remove("hidden");confetti(won);
}

/* ============================== 6. BOT AI ===========================
   Still simple, but a bit sharper than v1:
   · bots walk to real task consoles and "work" there (visual tasks show)
   · they only perceive their own room (no wall-hacks, no invisible Spy,
     no players hiding in vents)
   · they keep TRUST (people they stood next to / saw doing a visual task)
     and SUSP (people standing over a body, seen killing, or accused a lot)
   · impostor bots hunt isolated crew, flee & vent after a kill, and will
     sabotage lights right before hunting
   · they answer accusations in meetings and can back each other up
   ==================================================================== */
function botUpdate(b,dt){
  if(!b.alive)return;
  const B=b.bot;
  B.think-=dt;B.killCd=Math.max(0,B.killCd-dt);B.ventCd=Math.max(0,B.ventCd-dt);

  /* ---------------- perception (own room only) ----------------
     Invisible Spy: fully hidden from EVERY bot. They are dropped from the
     visible set AND purged from memory / suspicion, so no bot can know an
     invisible player exists (unlike vents, where the hatch click is heard). */
  const visible=S.players.filter(p=>p!==b&&p.alive&&p.room===b.room&&!p.inVent
    &&!(p===S.me&&(S.invisible>0||S.inVent))&&dist(p,b)<260);
  const nowSet=new Set(visible.map(p=>p.id));
  // who just walked in / walked out of my room? (basic, fair information)
  B.seenSet=B.seenSet||new Set();
  nowSet.forEach(id=>{if(!B.seenSet.has(id)){
    const m=B.memory.find(m=>m.id===id);
    if(m)m.entered=S.t; else B.memory.push({id,room:b.room,t:S.t,secs:0,entered:S.t});
  }});
  B.seenSet.forEach(id=>{if(!nowSet.has(id)){
    const m=B.memory.find(m=>m.id===id);
    if(m){m.left=S.t;m.leftRoom=b.room;}
  }});
  B.seenSet=nowSet;
  visible.forEach(p=>{
    const m=B.memory.find(m=>m.id===p.id);
    if(m){m.room=b.room;m.t=S.t;m.secs=(m.secs||0)+dt;m.left=undefined;}
    else B.memory.push({id:p.id,room:b.room,t:S.t,secs:0});
    // standing together for a while builds a little trust (an alibi)
    if(dist(p,b)<120)B.trust[p.id]=Math.min(6,(B.trust[p.id]||0)+dt*0.7);
    // being alone with exactly one person is remembered as a mutual alibi
    if(visible.length===1)B.alibi=p.id;
  });
  if(!visible.length)B.alibi=null;

  // ---- INVISIBILITY: the spy leaves no trace in ANY bot's records ----
  // While the human is invisible they are erased from what bots remember or
  // suspect, so nothing they did while invisible can be brought up later,
  // and they never count as a witness / hover-over-a-body etc.
  if(S.invisible>0){
    B.memory=B.memory.filter(m=>m.id!==S.me.id);
    B.seenSet.delete(S.me.id);
    delete B.susp[S.me.id];
    delete B.trust[S.me.id];
    if(B.witness&&B.witness.saw===S.me.id)B.witness=null;
    if(B.alibi===S.me.id)B.alibi=null;
    if(B.buddy===S.me.id)B.buddy=null;
    // bots can't target a player they literally cannot see or hear
    B.killTgt=null;
  }

  // seeing someone perform a visual task clears them
  S.visuals.forEach(v=>{
    const p=S.players.find(x=>x.id===v.id);
    if(p&&p!==b&&p.room===b.room&&dist(p,b)<260){
      B.trust[p.id]=6;B.susp[p.id]=Math.max(0,(B.susp[p.id]||0)-3);
    }
  });
  /* ---------------- bodies ----------------
     IMPOSTOR BOTS NEVER AUTO-REPORT. A crewmate bot reports after a short
     "shock" delay (so you can actually see it find the body), and only if
     it is not the killer. Impostors instead walk away from corpses, and
     only ever report deliberately via the self-report gambit below.       */
  const body=S.bodies.find(bd=>!bd.reported&&bd.room===b.room&&dist(bd,b)<190);
  if(body){
    if(b.team==="imp"){
      // an impostor pretends it didn't see anything and leaves the scene
      if(!B.avoidBody){
        B.avoidBody=body.id;
        const away=ADJ[b.room].filter(e=>!S.bodies.some(bd=>!bd.reported&&bd.room===e.room));
        if(away.length){B.wps=route(b.room,pick(away).room);B.work=0;B.workTask=null;}
      }
    }else{
      // anyone lingering over the corpse looks very bad
      S.players.forEach(p=>{if(p!==b&&p.alive&&!p.inVent&&p.id!==S.me.id
        &&!(p===S.me&&S.invisible>0)&&dist(p,body)<70)
        B.susp[p.id]=(B.susp[p.id]||0)+5;});
      // the last person this bot saw in this room is mildly suspicious
      const lastHere=B.memory.filter(m=>m.room===body.room&&S.t-m.t<20)
                             .sort((x,y)=>y.t-x.t)[0];
      if(lastHere)B.susp[lastHere.id]=(B.susp[lastHere.id]||0)+2;
      B.witness={body:body.id,room:body.room};
      // shock pause, then report
      B.shock=(B.shock||0)+dt;
      if(B.shock>0.9){reportBody(body,b);return;}
      return;   // stand still, stunned, while the shock timer runs
    }
  }else{B.shock=0;B.avoidBody=null;}

  /* ---------------- impostor hunting ---------------- */
  if(b.team==="imp"){
    const witnesses=S.players.filter(p=>p!==b&&p.alive&&p.team!=="imp"&&p.room===b.room&&!p.inVent
      &&!(p===S.me&&S.invisible>0));
    const prey=witnesses.filter(p=>dist(p,b)<70);
    const freshBody=S.bodies.some(bd=>!bd.reported&&bd.room===b.room);
    // is anyone about to walk in on me? (someone in a directly-linked room)
    const neighbours=ADJ[b.room].reduce((n,e)=>n+S.players.filter(p=>
      p.alive&&p.team!=="imp"&&p.room===e.room).length,0);
    // safer rooms have a vent to escape through
    const escapeVent=VENTS.find(v=>v.room===b.room);
    const risky=neighbours>1&&!escapeVent;

    if(B.killCd<=0&&prey.length&&witnesses.length<=1&&!freshBody&&!risky){
      const victim=prey[0];
      killPlayer(victim,b);B.killCd=S.settings.killCd;
      B.lastKillRoom=b.room;
      // escape plan: vent out, or walk away, or set up a self-report
      if(escapeVent&&B.ventCd<=0&&Math.random()<0.7){
        const to=pick(ventLinks(escapeVent));
        puff(escapeVent.x,escapeVent.y,"#8a8375",12);
        b.x=to.x;b.y=to.y;b.room=to.room;B.ventCd=14;
        puff(to.x,to.y,"#8a8375",12);witnessVent(to,b);
        B.wps=route(b.room,pick(ADJ[b.room]).room);
      }else if(neighbours>0&&Math.random()<0.45){
        // someone is about to walk in anyway — beat them to the punch
        B.selfReport=1.2+Math.random()*1.2;
      }else{
        // flee two rooms away so the corpse isn't found next to me
        const far=ADJ[b.room].map(e=>e.room);
        const step=pick(far);
        const step2=pick(ADJ[step].map(e=>e.room).filter(r=>r!==b.room))||step;
        B.wps=route(b.room,step).concat(route(step,step2));
      }
      return;
    }
    // self-report timer: reporting your own kill looks innocent
    if(B.selfReport>0){
      B.selfReport-=dt;
      const own=S.bodies.find(bd=>!bd.reported&&bd.killer===b.id&&bd.room===b.room);
      if(B.selfReport<=0&&own){B.selfReport=0;B.selfReported=true;reportBody(own,b);return;}
    }
    // stalk: shadow a lone crewmate, but hang back so it isn't obvious
    if(B.killCd<4&&witnesses.length===1&&!freshBody){
      const t=witnesses[0],d=dist(t,b);
      // cut the lights first to make the kill deniable
      if(!S.sabotage&&S.sabCd<=0&&Math.random()<0.005)startSabotage("lights",b);
      const want=B.killCd<=0?36:110;      // close in only when the kill is ready
      if(Math.abs(d-want)>18){
        const dir=d>want?1:-1, sp=S.settings.speed*(d>want?0.98:0.7)*dt*dir;
        moveEntity(b,(t.x-b.x)/d*sp,(t.y-b.y)/d*sp,false);
        b.bob+=dt*11;b.face=t.x>b.x?1:-1;
      }
      return;
    }
    // pack behaviour: don't crowd the other impostor, split the map up
    const mate=S.players.find(p=>p!==b&&p.alive&&p.team==="imp"&&p.room===b.room);
    if(mate&&!witnesses.length&&Math.random()<0.01){
      const away=ADJ[b.room].map(e=>e.room);
      if(away.length)B.wps=route(b.room,pick(away));
    }
    // sabotage with intent: reactor/doors when crew are winning on tasks
    if(!S.sabotage&&S.sabCd<=0){
      const taskPressure=S.totalTasks?S.doneTasks/S.totalTasks:0;
      const chance=0.0008+taskPressure*0.004;
      if(Math.random()<chance)
        startSabotage(taskPressure>0.6?pick(["reactor","reactor","comms"])
                                      :pick(["comms","doors","lights"]),b);
    }
  }

  /* ------ crew reaction: buddy up, shadow a suspect, or run ------ */
  if(b.team!=="imp"){
    const scary=visible.filter(p=>(B.susp[p.id]||0)>=8);
    if(scary.length&&visible.length===1){
      // alone with someone I watched vent / kill: get out of this room
      const away=ADJ[b.room].filter(e=>!scary.some(s=>s.room===e.room));
      if(away.length&&(!B.wps.length||Math.random()<0.03)){
        B.wps=route(b.room,pick(away).room);B.work=0;B.workTask=null;B.fleeing=1.5;}
    }else if(scary.length&&visible.length>1&&Math.random()<0.004){
      // in a crowd: tail the suspect instead of wandering off
      const s=scary[0];if(dist(s,b)>90)B.wps=[{x:s.x,y:s.y}];
    }
    // BUDDY SYSTEM: after a body is found, nervous crew stick with someone
    // they already trust rather than wandering off alone.
    if(S.bodiesFoundCount>0&&!visible.length&&Math.random()<0.006){
      const buddy=Object.entries(B.trust).filter(([id,v])=>v>3)
        .map(([id])=>S.players.find(p=>p.id==id))
        .filter(p=>p&&p.alive&&(B.susp[p.id]||0)<4)[0];
      if(buddy&&buddy.room!==b.room){B.wps=route(b.room,buddy.room);B.buddy=buddy.id;}
    }
    if(B.fleeing>0)B.fleeing-=dt;
  }

  /* ---------------- "working" pause at a console ---------------- */
  if(B.work>0){
    B.work-=dt;
    if(B.work<=0&&B.workTask){
      B.workTask.done=true;
      if(b.team==="crew"&&!B.workTask.fake){S.doneTasks++;updateHUD();checkWin();}
      B.workTask=null;
    }
    return;
  }

  /* ---------------- pick a destination ---------------- */
  if(B.think<=0||!B.wps.length){
    B.think=rnd(1.0,2.2);
    if(!B.wps.length){
      // already standing at one of my consoles? work on it
      const here=b.tasks.find(t=>!t.done&&t.room===b.room&&dist(t,b)<70);
      if(here){B.work=rnd(2.5,5);B.workTask=here;
        if(here.visual)S.visuals.push({id:b.id,type:here.visual,t:B.work,x:b.x,y:b.y});
        return;}
      let goal=null,gx=null;
      if(S.sabotage&&S.sabotage.type==="reactor"&&b.team!=="imp"){
        const rc=ROOMS.reactor;goal="reactor";
        gx=Math.random()<0.5?{x:rc.x+70,y:rc.y+rc.h/2+20}:{x:rc.x+rc.w-70,y:rc.y+rc.h/2+20};
      }else if(S.sabotage&&S.sabotage.type==="lights"&&b.team!=="imp"&&Math.random()<0.6){
        goal="electrical";
      }else if(b.team!=="imp"&&b.tasks.some(t=>!t.done)){
        // go to the CLOSEST unfinished task (mild improvement over random)
        const opts=b.tasks.filter(t=>!t.done);
        opts.sort((p,q)=>dist(p,b)-dist(q,b));
        const t=Math.random()<0.7?opts[0]:pick(opts);
        goal=t.room;gx={x:t.x,y:t.y};
      }else if(b.team==="imp"){
        /* Impostor target selection:
           1) hunt an ISOLATED crewmate in an adjacent room (best odds)
           2) otherwise drift toward any adjacent room with crew in it
           3) otherwise patrol somewhere with a vent so an escape exists   */
        const nearRooms=ADJ[b.room].map(e=>e.room);
        const count=r=>S.players.filter(p=>p.alive&&p.team!=="imp"&&p.room===r).length;
        const lone=nearRooms.filter(r=>count(r)===1);
        const busy=nearRooms.filter(r=>count(r)>0);
        if(lone.length&&B.killCd<8)goal=pick(lone);
        else if(busy.length&&Math.random()<0.65)goal=pick(busy);
        else{
          const vented=ROOM_IDS.filter(r=>VENTS.some(v=>v.room===r));
          goal=Math.random()<0.6?pick(vented):pick(ROOM_IDS);
        }
        // stand at a console so it looks like they're doing a task
        const ft=b.tasks.find(t=>!t.done&&t.room===goal);if(ft)gx={x:ft.x,y:ft.y};
      }else goal=pick(ROOM_IDS);
      B.goal=goal;B.wps=route(b.room,goal);
      if(gx)B.wps[B.wps.length-1]=gx;
    }
  }

  /* ---------------- follow waypoints ---------------- */
  if(B.wps.length){
    const wp=B.wps[0],dx=wp.x-b.x,dy=wp.y-b.y,d=Math.hypot(dx,dy);
    if(d<20)B.wps.shift();
    else{
      const sp=S.settings.speed*0.9*dt;
      moveEntity(b,dx/d*sp,dy/d*sp,false);
      if(Math.abs(dx)>4)b.face=dx>0?1:-1;
      b.bob+=dt*11;
    }
  }
  // unstick
  if(Math.hypot(b.x-B.lx,b.y-B.ly)<1.2){B.stuck+=dt;
    if(B.stuck>1.0){B.wps=[];B.stuck=0;moveEntity(b,rnd(-10,10),rnd(-10,10),false);}}
  else B.stuck=0;
  B.lx=b.x;B.ly=b.y;
  B.lastRoom=b.room;

  // crew bots fix sabotages they walk into
  if(S.sabotage&&b.team!=="imp"){
    const rm={lights:"electrical",comms:"admin"}[S.sabotage.type];
    if(rm&&b.room===rm&&Math.random()<0.02)fixSabotage(b);
  }
}

// BFS over the room graph -> waypoint list
function route(from,to){
  if(!from||!to)return [randPointIn(to||"living")];
  if(from===to)return [randPointIn(to)];
  const prev={},q=[from],seen={[from]:1};
  while(q.length){
    const cur=q.shift();if(cur===to)break;
    for(const e of ADJ[cur]) if(!seen[e.room]){seen[e.room]=1;prev[e.room]={room:cur,door:e.door};q.push(e.room);}
  }
  if(!prev[to])return [randPointIn(from)];
  const chain=[];let cur=to;
  while(cur!==from){const p=prev[cur];chain.unshift({from:p.room,door:p.door});cur=p.room;}
  const wps=[];
  chain.forEach(step=>{
    let pts=step.door.wp.map(p=>({x:p[0],y:p[1]}));
    if(step.door.a!==step.from)pts=pts.slice().reverse();
    pts.forEach(p=>wps.push(p));
  });
  wps.push(randPointIn(to));
  return wps;
}

/* ====================== 7. ACTIONS / TASKS / UI ===================== */
let panelOpen=false;
function toast(msg){const d=document.createElement("div");d.className="toast-item";d.textContent=msg;
  $("#toast").appendChild(d);setTimeout(()=>d.remove(),2600);}
function banner(msg,ms){const b=$("#alertBanner");b.textContent=msg;b.classList.remove("hidden");
  clearTimeout(b._t);b._t=setTimeout(()=>b.classList.add("hidden"),ms||1800);}
function updateHUD(){
  const me=S.me;
  const gr=me.ghost||ghostRole(me);
  $("#roleChip").textContent=me.alive?me.role:("👻 "+gr.name+" — "+me.role);
  $("#roleChip").style.borderColor=me.alive?"":gr.color;
  const mine=me.tasks.filter(t=>!t.fake);
  $("#taskChip").textContent="My tasks "+mine.filter(t=>t.done).length+"/"+mine.length;
  $("#scoreChip").textContent="Score "+S.score;
  const pct=S.totalTasks?S.doneTasks/S.totalTasks*100:0;
  $("#taskbarFill").style.width=pct+"%";
  $("#taskbarLbl").textContent="CREW TASKS "+Math.round(pct)+"%";
}
function refreshTaskList(){
  const me=S.me,g=me.ghost;
  let head="";
  if(g)head=`<div style="color:${g.color};border-bottom:1px dashed rgba(0,0,0,.3);margin-bottom:3px">
    👻 ${g.name.toUpperCase()} — ${g.desc}</div>`;
  const body=(g&&!g.canTask)
    ? `<div class="tdone">Your tasks no longer count.</div>`
    : me.tasks.map(t=>
        `<div class="${t.done?'tdone':''}">${t.done?"✔":"▸"} ${t.fake?"(fake) ":""}${t.name} — ${ROOMS[t.room].name}</div>`
      ).join("")||"<div>No tasks</div>";
  $("#tasklist").innerHTML=head+body;
}
function nextTask(){return S.me.tasks.filter(t=>!t.done).sort((a,b)=>dist(a,S.me)-dist(b,S.me))[0];}

function context(){
  const me=S.me,c={};
  if(S.inVent){c.vent=S.inVent;return c;}
  if(!me.alive){
    const g=me.ghost||ghostRole(me);
    // Spirit (crew ghost) can still work; Wraith and plain Ghost cannot
    c.task=g.canTask?me.tasks.find(t=>!t.done&&dist(t,me)<70):null;
    if(g.canFix&&S.sabotage){const rm={lights:"electrical",comms:"admin"}[S.sabotage.type];
      if(rm&&me.room===rm)c.fix=S.sabotage.type;}
    return c;
  }
  if(S.invisible>0)return c;
  c.task=me.tasks.find(t=>!t.done&&dist(t,me)<70);
  c.body=S.bodies.find(b=>!b.reported&&dist(b,me)<80);
  c.vent=(me.team==="imp")?VENTS.find(v=>dist(v,me)<48):null;
  c.sys=SYSTEMS.find(s=>{const r=ROOMS[s.room];
    return me.room===s.room&&dist(me,{x:r.x+r.w*s.x,y:r.y+r.h*s.y})<80;});
  if(me.team==="imp"||me.role==="Traitor"){
    const foes=S.players.filter(p=>p.alive&&p!==me&&!p.inVent&&dist(p,me)<70
      &&(me.role==="Traitor"||p.team!==me.team));
    c.kill=foes.sort((a,b)=>dist(a,me)-dist(b,me))[0];
  }
  if(S.sabotage){const rm={lights:"electrical",comms:"admin",reactor:"reactor"}[S.sabotage.type];
    if(rm&&me.room===rm)c.fix=S.sabotage.type;}
  return c;
}
function updateActionButtons(){
  const c=context(),me=S.me;
  const set=(id,on,label,cd)=>{
    const b=$(id);b.disabled=!on;b.querySelector("span").textContent=label;
    let e=b.querySelector(".cd");
    if(cd>0){if(!e){e=document.createElement("div");e.className="cd";b.appendChild(e);}e.textContent=Math.ceil(cd);}
    else if(e)e.remove();
  };
  set("#btnUse",!!(c.task||c.sys||c.fix),c.fix?"FIX":c.sys?"USE":"TASK",0);
  set("#btnReport",!!c.body&&me.alive,"REPORT",0);
  set("#btnKill",!!c.kill&&S.killCd<=0&&me.alive&&!S.inVent,"KILL",S.killCd);
  set("#btnVent",(!!c.vent||S.inVent)&&me.alive,S.inVent?"EXIT":"VENT",0);
  set("#btnSabotage",me.team==="imp"&&me.alive&&S.sabCd<=0&&!S.sabotage,"SABO",S.sabCd);
  const g=me.ghost||ghostRole(me);
  const hasAb=me.alive?["Swapper","Security","Spy"].includes(me.role):g.canHaunt;
  set("#btnAbility",hasAb&&S.abilityCd<=0&&S.abilityUses>0&&!S.inVent,
    !me.alive?(g.canHaunt?"HAUNT":"—"):
      me.role==="Swapper"?"SWAP":me.role==="Security"?"CAM":me.role==="Spy"?"HIDE":"—",S.abilityCd);
}

function doAction(a){
  if(S.phase!=="play"||S.paused||panelOpen)return;
  const c=context(),me=S.me;
  if(a==="use"){
    if(c.fix)return openFix(c.fix);
    if(c.sys)return openSystem(c.sys.id);
    if(c.task)return openTask(c.task);
  }
  if(a==="report"&&c.body)return reportBody(c.body,me);
  if(a==="kill"&&c.kill&&S.killCd<=0){
    killPlayer(c.kill,me);S.killCd=S.settings.killCd;S.score+=200;S.statKills++;updateHUD();return;}
  if(a==="vent"){ if(S.inVent)return exitVent(); if(c.vent)return enterVent(c.vent); }
  if(a==="sabotage"&&me.team==="imp"&&!S.sabotage&&S.sabCd<=0)return openSabotageMenu();
  if(a==="ability")return useAbility();
}

/* ------------------------ VENT SYSTEM (v3) -------------------------
   Among Us style: you drop INTO the vent (hidden, movement locked) and
   floating directional arrows appear around you pointing at every
   connected vent. Tap an arrow or push that direction on the keyboard
   to whoosh across the map; press F / VENT again to climb out.
   ------------------------------------------------------------------ */
function ventArrows(){
  if(!S.inVent)return [];
  return ventLinks(S.inVent).map(v=>{
    const a=Math.atan2(v.y-S.inVent.y,v.x-S.inVent.x);
    return {vent:v,ang:a,dx:Math.cos(a),dy:Math.sin(a)};
  });
}
/* Anyone standing in the room watches you climb in or out of a vent — that is
   fair, directly-observed information, so bots that see it get very suspicious. */
function witnessVent(vent,who){
  S.players.forEach(p=>{
    if(!p.isBot||!p.alive||p===who)return;
    if(p.room!==vent.room||dist(p,vent)>270)return;
    p.bot.susp[who.id]=(p.bot.susp[who.id]||0)+12;
    p.bot.witness={vented:who.id,room:vent.room};
  });
  if(S.me.alive&&S.me!==who&&S.me.room===vent.room&&dist(S.me,vent)<270&&!S.inVent){
    toast("You saw "+who.name+" use a vent!");shakeIt(.3);
    S.myVents.push({id:who.id,room:vent.room,t:S.t});
  }
}
function enterVent(v){
  witnessVent(v,S.me);
  S.inVent=v;S.me.inVent=v;S.me.x=v.x;S.me.y=v.y;S.me.room=v.room;
  S.ventAnim=0.35;S.ventCd=0.25;
  puff(v.x,v.y,"#8a8375",16);shakeIt(.4);
  toast("In vent — arrows/tap to travel, F to exit");
}
function ventTravel(to){
  if(!S.inVent||S.ventCd>0)return;
  puff(S.inVent.x,S.inVent.y,"#8a8375",12);
  witnessVent(to,S.me);   // people in the destination room hear/see the hatch pop
  S.inVent=to;S.me.inVent=to;S.me.x=to.x;S.me.y=to.y;S.me.room=to.room;
  S.cam.x=to.x;S.cam.y=to.y;
  S.ventAnim=0.3;S.ventCd=0.35;
  puff(to.x,to.y,"#8a8375",12);shakeIt(.45);
}
function exitVent(){
  if(!S.inVent)return;
  witnessVent(S.inVent,S.me);
  puff(S.inVent.x,S.inVent.y,"#8a8375",18);
  S.inVent=null;S.me.inVent=null;S.ventAnim=0.3;shakeIt(.3);
}
// steering inside a vent: pick the arrow closest to the pushed direction
function ventSteer(ix,iy){
  if(!S.inVent||S.ventCd>0)return;
  const m=Math.hypot(ix,iy);if(m<0.6)return;
  ix/=m;iy/=m;
  let best=null,bestDot=0.35; // require a reasonably matching direction
  ventArrows().forEach(a=>{const d=a.dx*ix+a.dy*iy;if(d>bestDot){bestDot=d;best=a;}});
  if(best)ventTravel(best.vent);
}
// tapping an arrow on screen
function ventClick(cx,cy){
  if(!S.inVent)return false;
  const zoom=viewZoom();
  const arrows=ventArrows();
  for(const a of arrows){
    const px=W/2+a.dx*88*zoom, py=H/2+a.dy*88*zoom;
    if(Math.hypot(cx-px,cy-py)<40){ventTravel(a.vent);return true;}
  }
  return false;
}

function killPlayer(victim,killer,silent){
  if(!victim.alive)return;
  victim.alive=false;victim.inVent=null;
  becomeGhost(victim);
  S.bodies.push({x:victim.x,y:victim.y,room:victim.room,color:victim.color,name:victim.name,
    id:victim.id,reported:false,killer:killer?killer.id:null,t:S.t});
  blood(victim.x,victim.y,victim.color);
  if(killer&&killer.role==="Traitor")S.traitorKills++;
  if(victim===S.me){banner("YOU WERE KILLED",2200);S.inVent=null;updateHUD();}
  if(killer&&!silent){
    S.players.forEach(p=>{ // eye-witnesses in the same room get strong suspicion
      if(p.isBot&&p.alive&&p!==killer&&p.room===victim.room&&dist(p,victim)<260)
        {p.bot.susp[killer.id]=(p.bot.susp[killer.id]||0)+10;p.bot.witness={saw:killer.id,room:victim.room};}
    });
  }
  checkWin();
}
function reportBody(body,reporter){
  S.bodies.forEach(b=>b.reported=true);
  S.bodiesFoundCount=(S.bodiesFoundCount||0)+1;
  if(reporter===S.me){S.score+=80;updateHUD();}
  // remember whether the reporter was actually the killer (used by bot logic
  // in the meeting: a self-report is a classic impostor play, so crew bots
  // give the reporter a small amount of doubt if the body was very fresh)
  S.lastReport={by:reporter.id,room:body?body.room:null,
    selfReport:!!(body&&body.killer===reporter.id),
    fresh:body?(S.t-body.t)<3:false};
  startMeeting(reporter,body);
}

/* ---------------------------- minigames ---------------------------- */
function openPanel(title,html,onClose){
  panelOpen=true;$("#panelTitle").textContent=title;$("#panelBody").innerHTML=html;
  $("#panel").classList.remove("hidden");
  $("#panelClose").onclick=()=>{closePanel();if(onClose)onClose();};
}
function closePanel(){panelOpen=false;$("#panel").classList.add("hidden");}

function completeTask(task){
  if(task.done)return;
  task.done=true;
  if(!task.fake&&S.me.team==="crew")S.doneTasks++;
  if(!task.fake){S.score+=120;S.statTasks++;}
  confettiAt(S.me.x,S.me.y);shakeIt(.35);
  toast("Task complete: "+task.name);
  updateHUD();refreshTaskList();checkWin();
}
function openTask(task){
  // visual tasks show an animation over your head that other players can see
  if(task.visual)S.visuals.push({id:S.me.id,type:task.visual,t:4.5,x:S.me.x,y:S.me.y});
  ({hold:mgHold,clicks:mgClicks,seq:mgSeq,toggle:mgToggle}[task.type]||mgToggle)(task);
}
function mgHold(task,title,onDone){
  openPanel(title||task.name,
   `<div class="mg-wrap"><p style="margin-top:0">Hold the button until the bar fills.</p>
    <div class="mg-bar"><div id="hb"></div></div>
    <div class="mg-btns"><button id="holdBtn" style="width:160px">HOLD</button></div></div>`);
  let v=0,held=false;const bar=$("#hb"),btn=$("#holdBtn");
  const up=()=>held=false;
  btn.addEventListener("pointerdown",()=>held=true);addEventListener("pointerup",up);
  let lt=performance.now();
  (function tick(now){
    const dt=(now-lt)/1000;lt=now;
    if(!panelOpen){removeEventListener("pointerup",up);return;}
    v=clamp(v+(held?dt*58:-dt*20),0,100);bar.style.width=v+"%";
    if(v>=100){removeEventListener("pointerup",up);closePanel();onDone?onDone():completeTask(task);return;}
    requestAnimationFrame(tick);
  })(lt);
}
function mgClicks(task){
  openPanel(task.name,`<div class="mg-wrap"><p style="margin-top:0">Tap all 6 spots.</p>
    <div class="mg-field" id="fld"></div></div>`);
  const f=$("#fld");let left=6;
  for(let i=0;i<6;i++){
    const d=document.createElement("div");d.className="dot";
    d.style.left=rnd(5,80)+"%";d.style.top=rnd(8,72)+"%";
    d.onclick=()=>{d.remove();puffScreen();if(--left<=0){closePanel();completeTask(task);}};
    f.appendChild(d);
  }
}
function mgSeq(task){
  const seq=shuffle([1,2,3,4,5]).slice(0,4);
  openPanel(task.name,`<div class="mg-wrap"><p style="margin-top:0">Press in order: <b>${seq.join(" → ")}</b></p>
   <div class="mg-btns" id="sq">${[1,2,3,4,5].map(n=>`<button data-n="${n}">${n}</button>`).join("")}</div></div>`);
  let i=0;
  $("#sq").querySelectorAll("button").forEach(b=>b.onclick=()=>{
    if(+b.dataset.n===seq[i]){b.classList.add("on");if(++i>=seq.length){closePanel();completeTask(task);}}
    else{i=0;$("#sq").querySelectorAll("button").forEach(x=>x.classList.remove("on"));
      b.classList.add("hit");setTimeout(()=>b.classList.remove("hit"),200);}
  });
}
function mgToggle(task,title,onDone){
  openPanel(title||task.name,`<div class="mg-wrap"><p style="margin-top:0">Flip every switch UP.</p>
    <div class="mg-btns" id="tg">${[0,1,2,3,4].map(n=>`<button data-n="${n}">↓</button>`).join("")}</div></div>`);
  const st=[0,0,0,0,0];
  $("#tg").querySelectorAll("button").forEach(b=>b.onclick=()=>{
    st[+b.dataset.n]=1;b.classList.add("on");b.textContent="↑";
    if(st.every(x=>x)){closePanel();onDone?onDone():completeTask(task);}
  });
}
function puffScreen(){/* tiny hook for feedback inside DOM minigames */}

/* ------------------------- systems / panels ------------------------ */
function openSystem(id){
  if(id==="admin"){
    if(S.sabotage&&S.sabotage.type==="comms")return toast("Comms are down — admin table offline");
    const counts={};ROOM_IDS.forEach(r=>counts[r]=0);
    S.players.forEach(p=>{if(p.alive&&p.room&&!p.inVent)counts[p.room]++;});
    openPanel("ADMIN TABLE",`<div class="gridrooms">${ROOM_IDS.map(r=>
      `<div><b>${ROOMS[r].name}</b>${"●".repeat(counts[r])||"—"}</div>`).join("")}</div>
      <p class="tiny-note">Approximate positions only.</p>`);
  }
  if(id==="cams"){
    const spots=CAM_SPOTS.concat(S.extraCams);
    const grey=S.sabotage&&S.sabotage.type==="comms"&&S.sabotage.hacker;
    openPanel("CAMERAS",`<div class="gridrooms">${spots.map(r=>{
      const ppl=S.players.filter(p=>p.alive&&p.room===r&&!p.inVent);
      return `<div><b>CAM · ${ROOMS[r].name}</b>${ppl.length?ppl.map(p=>
        `<span style="display:inline-block;width:12px;height:15px;border:1.5px solid #333;background:${
          grey?"#999":p.color}"></span>`).join(" "):"<i>empty</i>"}</div>`;}).join("")}
      </div><p class="tiny-note">Live paper feed.</p>`);
  }
  if(id==="vitals"){
    openPanel("VITALS",S.players.map(p=>
      `<div class="vit"><span><span style="display:inline-block;width:12px;height:15px;border:1.5px solid #333;background:${p.color}"></span> ${p.name}</span>
       <b style="color:${p.alive?"#4c9c54":"#e0554a"}">${p.alive?"ALIVE":p.ejected?"EJECTED":"DEAD"}</b></div>`).join(""));
  }
  if(id==="emerg"){
    if(!S.me.alive)return toast("Ghosts can't call meetings");
    if(S.meetingsLeft<=0)return toast("No emergency meetings left");
    if(S.sabotage)return toast("Fix the sabotage first!");
    S.meetingsLeft--;startMeeting(S.me,null);
  }
}

/* ============================ 8. SABOTAGE =========================== */
function openSabotageMenu(){
  const opts=[["lights","Lights (Electrical)"],["comms","Comms (Admin)"],
              ["reactor","Reactor meltdown"],["doors","Lock doors"]];
  openPanel("SABOTAGE",`<div class="mg-btns" style="flex-direction:column">${opts.map(o=>
    `<button style="width:100%;height:auto;padding:10px" data-s="${o[0]}">${o[1]}</button>`).join("")}</div>`);
  $("#panelBody").querySelectorAll("button").forEach(b=>b.onclick=()=>{closePanel();startSabotage(b.dataset.s,S.me);});
}
function startSabotage(type,by){
  if(S.sabotage)return;
  S.sabCd=S.settings.sabCd;
  const hacker=by&&by.role==="Hacker"&&type==="comms";
  S.sabotage={type,hacker,by:by?by.id:null};
  if(type==="reactor")S.sabotage.timer=45;
  if(type==="doors"){
    shuffle(DOORS.filter(d=>d.lockable)).slice(0,4).forEach(d=>d.locked=14);
    setTimeout(()=>{if(S.sabotage&&S.sabotage.type==="doors")S.sabotage=null;},14000);
  }
  banner({lights:"LIGHTS SABOTAGED",comms:"COMMUNICATIONS DOWN",
          reactor:"REACTOR MELTDOWN",doors:"DOORS LOCKED"}[type],2200);
  shakeIt(.8);
  if(hacker)toast("Hacker: everyone is grey and nameless");
}
function fixSabotage(who){
  if(!S.sabotage)return;
  const t=S.sabotage.type;S.sabotage=null;
  toast("Sabotage fixed: "+t);
  if(!who||who===S.me){S.score+=100;confettiAt(S.me.x,S.me.y);updateHUD();}
}
function openFix(type){
  if(!S.me.alive&&!(S.me.ghost||ghostRole(S.me)).canFix)
    return toast("Only a Spirit can fix sabotages");
  if(type==="lights")mgToggle(null,"FIX LIGHTS",()=>fixSabotage(S.me));
  else if(type==="comms")mgHold(null,"RESTORE COMMS",()=>fixSabotage(S.me));
  else toast("Two people must stand on both reactor pads!");
}

/* ---------------------------- abilities ---------------------------- */
function useAbility(){
  const me=S.me;
  if(!me.alive){
    const g=me.ghost||ghostRole(me);
    if(!g.canHaunt)return toast(g.name+": "+g.desc);
    if(me.hauntTarget)return toast("Already haunting");
    const targets=S.players.filter(p=>p.alive&&p.team!=="imp");
    if(!targets.length)return;
    openPanel("HAUNT A CREWMATE",targets.map(p=>`<button class="paper-btn" data-i="${p.id}">${p.name}</button>`).join(""));
    $("#panelBody").querySelectorAll("button").forEach(b=>b.onclick=()=>{
      closePanel();me.hauntTarget=+b.dataset.i;me.haunt=S.settings.roleCd;
      S.abilityUses--;S.abilityCd=S.settings.roleCd;S.hauntedBy=me.hauntTarget;
      toast("Haunting "+S.players.find(p=>p.id===me.hauntTarget).name+" — a meeting can save them");
    });return;
  }
  if(me.role==="Swapper"){
    let sel=[];
    openPanel("SWAP TWO PLAYERS",S.players.filter(p=>p.alive).map(p=>
      `<button class="paper-btn" data-i="${p.id}">${p.name}</button>`).join("")+
      `<p class="tiny-note">Choose two players to exchange positions.</p>`);
    $("#panelBody").querySelectorAll("button").forEach(b=>b.onclick=()=>{
      b.classList.add("accent");sel.push(+b.dataset.i);
      if(sel.length===2){
        const A=S.players.find(p=>p.id===sel[0]),B=S.players.find(p=>p.id===sel[1]);
        [A.x,B.x]=[B.x,A.x];[A.y,B.y]=[B.y,A.y];
        puff(A.x,A.y,A.color,14);puff(B.x,B.y,B.color,14);shakeIt(.6);
        S.abilityUses--;S.abilityCd=S.settings.roleCd;closePanel();
        toast("Swapped "+A.name+" and "+B.name);
      }});return;
  }
  if(me.role==="Security"){
    const placeable=ROOM_IDS.filter(r=>!CAM_SPOTS.includes(r)&&!S.extraCams.includes(r));
    openPanel("PLACE A CAMERA",placeable.map(r=>
      `<button class="paper-btn" data-r="${r}">${ROOMS[r].name}</button>`).join("")+
      `<p class="tiny-note">Cameras only mount at fixed wall brackets.</p>`);
    $("#panelBody").querySelectorAll("button").forEach(b=>b.onclick=()=>{
      S.extraCams.push(b.dataset.r);S.abilityUses--;S.abilityCd=S.settings.roleCd;
      closePanel();toast("Camera installed in "+ROOMS[b.dataset.r].name);});
    return;
  }
  if(me.role==="Spy"){
    S.invisible=8;S.abilityUses--;S.abilityCd=S.settings.roleCd;
    puff(me.x,me.y,"#ffffff",18);toast("Invisible for 8s — you cannot act");return;
  }
  toast("No ability");
}

/* ====================== 9. MEETINGS + CHAT (v2) =====================
   Chat is still multiple-choice, but the choices are now generated from
   what you actually know, and bots reply to accusations / vouch for
   people they were standing next to.
   ==================================================================== */
function startMeeting(caller,body){
  if(S.meeting)return;
  S.inVent=null;S.players.forEach(p=>p.inVent=null);
  S.players.forEach((p,i)=>{
    const a=i/S.players.length*Math.PI*2,c=roomCenter("living");
    p.x=c.x+Math.cos(a)*95;p.y=c.y+Math.sin(a)*75;p.room="living";
    p.bot.wps=[];p.bot.work=0;p.bot.saidCount=0;p.bot.accusedBy={};
  });
  S.bodies=[];S.visuals=[];
  if(S.me.hauntTarget){S.me.hauntTarget=null;S.hauntedBy=null;toast("Meeting broke your haunt");}
  S.meeting={t:36,votes:{},resolved:false,body:body?{...body}:null,accusations:{},saidByMe:0};
  $("#meetTitle").textContent=body?"DEAD BODY REPORTED":"EMERGENCY MEETING";
  $("#chatLog").innerHTML="";
  addChat("SYSTEM",body?`${caller.name} found ${body.name}'s body in ${roomName(body.room)}.`
    :`${caller.name} called an emergency meeting.`,"#7a6a55");
  buildVoteList();buildChatChoices();
  $("#meeting").classList.remove("hidden");shakeIt(1);
  // staggered bot statements
  S.players.filter(p=>p.isBot&&p.alive).forEach((b,i)=>
    setTimeout(()=>{if(S.meeting&&!S.meeting.resolved)botSpeak(b);},1000+i*1300));
  setTimeout(()=>{if(S.meeting&&!S.meeting.resolved)
    S.players.filter(p=>p.isBot&&p.alive).forEach((b,i)=>setTimeout(()=>botVote(b),i*300));},13000);
  meetingTick();
}
function meetingTick(){
  if(!S.meeting)return;
  S.meeting.t-=0.25;
  $("#meetTimer").textContent=Math.max(0,Math.ceil(S.meeting.t));
  const alive=S.players.filter(p=>p.alive);
  if(S.meeting.t<=0||alive.every(p=>S.meeting.votes[p.id]!==undefined))return resolveMeeting();
  setTimeout(meetingTick,250);
}
function addChat(who,text,color){
  const d=document.createElement("div");
  d.innerHTML=`<b style="color:${color||"#2f2a24"}">${who}:</b> ${text}`;
  $("#chatLog").appendChild(d);$("#chatLog").scrollTop=1e6;
}
function buildVoteList(){
  const el=$("#voteList");el.innerHTML="";
  S.players.forEach(p=>{
    const row=document.createElement("div");
    row.className="vrow"+(p.alive?"":" dead");
    row.innerHTML=`<span class="pw" style="background:${p.color}"></span>${p.name}${p.alive?"":" ☠"}<span class="vtally"></span>`;
    row.onclick=()=>castVote(S.me,p.id,row);
    el.appendChild(row);
  });
  const skip=document.createElement("div");
  skip.className="vrow";skip.innerHTML=`<span class="pw" style="background:#ddd"></span>SKIP VOTE<span class="vtally"></span>`;
  skip.onclick=()=>castVote(S.me,"skip",skip);
  el.appendChild(skip);
}

/* ---- contextual chat menu built from the player's own knowledge ---- */
function buildChatChoices(){
  const el=$("#chatChoices");el.innerHTML="";
  const me=S.me;
  if(!me.alive){el.innerHTML='<p class="tiny-note">Ghosts cannot speak or vote.</p>';return;}
  const seen=S.myMemory.filter(m=>S.t-m.t<70).sort((a,b)=>b.t-a.t).slice(0,4);
  const alive=S.players.filter(p=>p.alive&&p!==me);
  const groups=[];

  groups.push(["WHERE I WAS",[
    ...S.myRooms.slice(0,2).map(r=>({t:`I was in ${roomName(r)}.`})),
    {t:"I was doing a task."},{t:"I was alone."},
  ]]);

  groups.push(["WHAT I SAW",[
    ...seen.map(m=>{const p=S.players.find(x=>x.id===m.id);
      return {t:`I saw ${p.name} in ${roomName(m.room)}.`};}),
    ...seen.slice(0,2).map(m=>{const p=S.players.find(x=>x.id===m.id);
      return {t:`I was with ${p.name}.`,vouch:m.id};}),
    ...S.myVents.slice(-2).map(v=>{const p=S.players.find(x=>x.id===v.id);
      return {t:`${p.name} used a VENT in ${roomName(v.room)}!`,accuse:v.id};}),
    {t:"I saw nobody."},{t:"I saw someone running away."},
    ...(S.meeting.body?[{t:"I found the body."},{t:"I saw someone near the body."}]:[]),
  ]]);

  groups.push(["ACCUSE",alive.map(p=>({t:`I think ${p.name} is suspicious.`,accuse:p.id}))]);

  // call out a suspicious self-report
  const sr=(S.lastReport&&S.lastReport.fresh&&S.lastReport.by!==me.id)
    ? S.players.find(p=>p.id===S.lastReport.by):null;
  groups.push(["DEFEND / END",[
    {t:"It wasn't me."},{t:"Why are you accusing me?"},
    ...(sr?[{t:`${sr.name} reported that body awfully fast.`,accuse:sr.id}]:[]),
    {t:"I don't know."},{t:"Skip."},{t:"Let's vote."},
  ]]);

  groups.forEach(([title,items])=>{
    if(!items.length)return;
    const h=document.createElement("div");h.className="chat-h";h.textContent=title;el.appendChild(h);
    items.forEach(it=>{
      const b=document.createElement("button");b.textContent=it.t;
      if(it.accuse!==undefined)b.classList.add("accuse");
      b.onclick=()=>{
        if(S.meeting.saidByMe>=4)return toast("You've said enough!");
        S.meeting.saidByMe++;
        addChat(me.name,it.t,me.color);b.disabled=true;
        reactToStatement(me,it);
      };
      el.appendChild(b);
    });
  });
}

// bots react to the human's (or another bot's) statement
function reactToStatement(speaker,it){
  if(!S.meeting)return;
  if(it.accuse!==undefined){
    const target=S.players.find(p=>p.id===it.accuse);
    S.meeting.accusations[target.id]=(S.meeting.accusations[target.id]||0)+1;
    if(target.isBot&&target.alive){
      setTimeout(()=>{
        if(!S.meeting||S.meeting.resolved)return;
        const B=target.bot;
        B.accusedBy[speaker.id]=1;
        // defend with a real alibi if it has one, otherwise deny / counter-accuse
        const ally=Object.entries(B.trust).filter(([id,v])=>v>2.5)
          .map(([id])=>S.players.find(p=>p.id==id)).filter(p=>p&&p.alive)[0];
        let line;
        if(ally&&Math.random()<0.7)line=`It wasn't me — I was with ${ally.name} in ${roomName(B.lastRoom)}.`;
        else if(Math.random()<0.5)line=`It wasn't me, I was in ${roomName(B.lastRoom)} doing a task.`;
        else{
          const sus=bestSuspect(target);
          line=sus?`Why me? I think ${sus.name} is suspicious.`:"It wasn't me. I don't know.";
          if(sus)S.meeting.accusations[sus.id]=(S.meeting.accusations[sus.id]||0)+1;
        }
        addChat(target.name,line,target.color);
        // the accused remembers who pointed at them
        B.susp[speaker.id]=(B.susp[speaker.id]||0)+2;
        // an ally may back them up
        if(ally&&ally.isBot&&Math.random()<0.6)
          setTimeout(()=>{if(S.meeting&&!S.meeting.resolved)
            addChat(ally.name,`I was with ${target.name}.`,ally.color);},1200);
      },900+Math.random()*700);
    }
  }
  if(it.vouch!==undefined){
    const p=S.players.find(x=>x.id===it.vouch);
    if(p&&p.isBot&&p.alive&&Math.random()<0.6)
      setTimeout(()=>{if(S.meeting&&!S.meeting.resolved)
        addChat(p.name,`Yes, I was with ${speaker.name}.`,p.color);},1000);
  }
}
function bestSuspect(b){
  const e=Object.entries(b.bot.susp).map(([id,v])=>[S.players.find(p=>p.id==id),v])
    .filter(([p,v])=>p&&p.alive&&p!==b).sort((a,c)=>c[1]-a[1])[0];
  return e&&e[1]>=3?e[0]:null;
}

function botSpeak(b){
  const B=b.bot,recent=B.memory.filter(m=>S.t-m.t<70).sort((x,y)=>y.t-x.t);
  const sus=bestSuspect(b);
  let line,meta={};
  if(b.team==="imp"&&B.selfReported){
    // an impostor that self-reported plays the concerned finder
    B.selfReported=false;
    line=`I found the body in ${roomName(S.lastReport&&S.lastReport.room||B.lastRoom)}.`;
  }else if(b.team==="imp"){
    // impostors: bland alibi, or pile onto whoever is already accused
    const hot=Object.entries(S.meeting.accusations).sort((a,c)=>c[1]-a[1])[0];
    if(hot&&Math.random()<0.55){
      const p=S.players.find(x=>x.id==hot[0]);
      if(p&&p.alive&&p!==b){line=`I think ${p.name} is suspicious too.`;meta.accuse=p.id;}
    }
    if(!line){
      const ally=recent.find(m=>{const p=S.players.find(x=>x.id===m.id);return p&&p.team!=="imp";});
      line=ally&&Math.random()<0.5?`I was with ${S.players.find(p=>p.id===ally.id).name}.`
        :pick([`I was in ${roomName(B.lastRoom)}.`,"I was doing a task.","I saw nobody.","I don't know."]);
    }
  }else if(B.witness&&B.witness.vented!==undefined&&Math.random()<0.95){
    const k=S.players.find(p=>p.id===B.witness.vented);
    line=`${k.name} used a VENT in ${roomName(B.witness.room)}!`;meta.accuse=k.id;
  }else if(B.witness&&B.witness.saw!==undefined&&Math.random()<0.9){
    const k=S.players.find(p=>p.id===B.witness.saw);
    line=`I saw ${k.name} near the body in ${roomName(B.witness.room)}.`;meta.accuse=k.id;
  }else if(B.alibi!==null&&B.alibi!==undefined&&Math.random()<0.5){
    const a=S.players.find(p=>p.id===B.alibi);
    line=a?`I was with ${a.name} in ${roomName(B.lastRoom)}.`:"I was alone.";
    if(a)meta.vouch=a.id;
  }else if(sus&&Math.random()<0.8){
    line=`I think ${sus.name} is suspicious.`;meta.accuse=sus.id;
  }else if(recent.length&&Math.random()<0.7){
    const m=recent[0],who=S.players.find(p=>p.id===m.id);
    line=Math.random()<0.5?`I saw ${who.name} in ${roomName(m.room)}.`:`I was with ${who.name}.`;
    if(Math.random()<0.5)meta.vouch=m.id;
  }else line=pick([`I was in ${roomName(B.lastRoom)}.`,"I was alone.","I don't know.","I was doing a task."]);
  addChat(b.name,line,b.color);
  B.saidCount++;
  reactToStatement(b,meta);
}

function castVote(voter,targetId,row){
  if(!S.meeting||S.meeting.resolved)return;
  if(!voter.alive){if(voter===S.me)toast("Ghosts can't vote");return;}
  if(S.meeting.votes[voter.id]!==undefined)return;
  S.meeting.votes[voter.id]=targetId;
  if(voter===S.me){
    document.querySelectorAll("#voteList .vrow").forEach(r=>r.classList.remove("voted"));
    if(row)row.classList.add("voted");
    addChat("SYSTEM",S.me.name+" voted.","#7a6a55");
  }
  refreshTally();
}
function refreshTally(){
  const rows=document.querySelectorAll("#voteList .vrow"),counts={};
  Object.values(S.meeting.votes).forEach(v=>counts[v]=(counts[v]||0)+1);
  S.players.forEach((p,i)=>{if(rows[i])rows[i].querySelector(".vtally").textContent="■".repeat(counts[p.id]||0);});
  if(rows[S.players.length])rows[S.players.length].querySelector(".vtally").textContent="■".repeat(counts["skip"]||0);
}
function botVote(b){
  if(!S.meeting||S.meeting.resolved||!b.alive)return;
  const B=b.bot,acc=S.meeting.accusations;
  let target="skip";
  // a suspiciously fast self-report earns a little doubt from crew bots
  if(b.team!=="imp"&&S.lastReport&&S.lastReport.fresh&&S.lastReport.by!==b.id)
    B.susp[S.lastReport.by]=(B.susp[S.lastReport.by]||0)+2;
  // late game: crew bots stop skipping, because skipping loses
  const aliveN=S.players.filter(p=>p.alive).length;
  const desperate=aliveN<=4;
  if(b.team==="imp"){
    // vote with the crowd if the crowd isn't looking at an impostor
    const hot=Object.entries(acc).map(([id,n])=>[S.players.find(p=>p.id==id),n])
      .filter(([p])=>p&&p.alive).sort((a,c)=>c[1]-a[1])[0];
    if(hot&&hot[0].team!=="imp"&&Math.random()<0.85)target=hot[0].id;
    else{const crew=S.players.filter(p=>p.alive&&p.team!=="imp"&&p!==b);
      if(crew.length&&Math.random()<0.6)target=pick(crew).id;}
  }else{
    const sus=bestSuspect(b);
    if(sus&&Math.random()<0.9)target=sus.id;
    else{
      // no personal evidence: follow the loudest accusation, but only sometimes,
      // and never vote for someone who gave this bot an alibi
      const hot=Object.entries(acc).map(([id,n])=>[S.players.find(p=>p.id==id),n])
        .filter(([p,n])=>p&&p.alive&&p!==b&&n>=(desperate?1:2)&&(B.trust[p.id]||0)<2.5)
        .sort((a,c)=>c[1]-a[1])[0];
      if(hot&&Math.random()<(desperate?0.85:0.6))target=hot[0].id;
      else if(desperate&&Math.random()<0.5){
        // last few players: vote for whoever you have LEAST alibi time with
        const cand=S.players.filter(p=>p.alive&&p!==b)
          .sort((x,y)=>(B.trust[x.id]||0)-(B.trust[y.id]||0))[0];
        if(cand)target=cand.id;
      }
    }
  }
  castVote(b,target);
}
function resolveMeeting(){
  if(S.meeting.resolved)return;
  S.meeting.resolved=true;
  const counts={};Object.values(S.meeting.votes).forEach(v=>counts[v]=(counts[v]||0)+1);
  let top=null,topN=0,tie=false;
  Object.entries(counts).forEach(([k,n])=>{
    if(k==="skip")return;
    if(n>topN){top=k;topN=n;tie=false;}else if(n===topN)tie=true;
  });
  const skips=counts["skip"]||0;
  let text;
  if(!top||tie||skips>=topN)text="No one was ejected. "+(tie?"(tie)":"(skipped)");
  else{
    const p=S.players.find(x=>x.id==top);
    p.alive=false;p.ejected=true;becomeGhost(p);
    text=`${p.name} was ejected. ${p.team==="imp"?"They were an Impostor.":
      p.team==="neutral"?"They were the Traitor.":"They were not an Impostor."}`;
    if(S.meeting.votes[S.me.id]==top&&p.team!=="crew"&&S.me.alive)S.score+=150;
    if(p===S.me)banner("YOU WERE EJECTED",2200);
  }
  addChat("SYSTEM",text,"#e0554a");
  updateHUD();
  setTimeout(()=>{
    $("#meeting").classList.add("hidden");S.meeting=null;
    S.players.forEach(p=>{const B=p.bot;
      B.susp={};B.memory=[];B.trust={};B.witness=null;B.wps=[];
      B.seenSet=new Set();B.alibi=null;B.selfReport=0;B.lastRoom="living";
      B.shock=0;B.avoidBody=null;B.fleeing=0;B.buddy=null;B.selfReported=false;});
    S._lastRoomShown=null;S.lastReport=null;
    S.myMemory=[];S.myVents=[];S.killCd=Math.max(S.killCd,10);
    checkWin();
  },3400);
}

/* ============================= 10. RENDER =========================== */
function shakeIt(v){S.shake=Math.min(1.4,S.shake+v);}
function puff(x,y,color,n){for(let i=0;i<(n||10);i++)S.particles.push({x,y,vx:rnd(-120,120),
  vy:rnd(-180,-20),life:rnd(.4,.9),color,size:rnd(4,9),rot:rnd(0,6),vr:rnd(-8,8)});}
function blood(x,y,color){for(let i=0;i<26;i++)S.particles.push({x,y,vx:rnd(-200,200),vy:rnd(-260,-40),
  life:rnd(.5,1.1),color:i%3?color:"#b8342b",size:rnd(4,11),rot:rnd(0,6),vr:rnd(-10,10)});shakeIt(.9);}
function confettiAt(x,y){for(let i=0;i<24;i++)S.particles.push({x,y,vx:rnd(-160,160),vy:rnd(-280,-80),
  life:rnd(.6,1.2),color:pick(["#e9d24a","#5aa457","#4a7fd9","#ea86bd","#e9913c"]),
  size:rnd(4,9),rot:rnd(0,6),vr:rnd(-12,12)});}
function confetti(win){for(let i=0;i<(win?90:30);i++)S.particles.push({x:S.me.x+rnd(-240,240),
  y:S.me.y-300,vx:rnd(-60,60),vy:rnd(20,140),life:rnd(1.4,2.6),
  color:win?pick(["#e9d24a","#5aa457","#4a7fd9","#ea86bd"]):"#7a6a55",
  size:rnd(4,10),rot:rnd(0,6),vr:rnd(-8,8)});}

function wobbleRect(x,y,w,h,seed){
  const pts=[],step=50;let i=0;
  const push=(px,py)=>pts.push([px+wob(seed+i*3.7)*2.8,py+wob(seed+ ++i*7.1)*2.8]);
  for(let t=0;t<w;t+=step)push(x+t,y);
  for(let t=0;t<h;t+=step)push(x+w,y+t);
  for(let t=w;t>0;t-=step)push(x+t,y+h);
  for(let t=h;t>0;t-=step)push(x,y+t);
  return pts;
}
const ROOM_OUTLINE={};
ROOM_IDS.forEach((id,i)=>{const r=ROOMS[id];ROOM_OUTLINE[id]=wobbleRect(r.x,r.y,r.w,r.h,i*13+3);});

function viewZoom(){return clamp(Math.min(W/1000,H/700),0.5,1.15);}

/* --------- fog of war: which rectangles can the player actually see? ---------
   You see your own room (and any corridor you're standing in, plus a peek into
   the rooms it joins). Everything else is drawn much darker and its occupants
   are not rendered at all. Ghosts see the whole mansion. -------------------- */
function visibleRects(){
  const me=S.me;
  if(!me.alive)return null;                 // ghosts see the whole mansion
  const rooms=new Set(),doors=new Set(),rects=[];
  const addRoom=id=>{rooms.add(id);const r=ROOMS[id];rects.push([r.x,r.y,r.w,r.h]);};
  const addDoor=(d,i)=>{doors.add(i);d.rects.forEach(q=>rects.push(q));};
  const here=roomAt(me.x,me.y);
  if(here){
    addRoom(here);
    DOORS.forEach((d,i)=>{if(d.a===here||d.b===here)addDoor(d,i);});
  }else{
    // In a hallway: light that corridor, and only peek into a linked room if
    // you are actually standing near its doorway (stops the long perimeter
    // hall from revealing rooms on the far side of the mansion).
    DOORS.forEach((d,i)=>{
      if(!d.rects.some(q=>inRect(me.x,me.y,q)))return;
      addDoor(d,i);
      [d.a,d.b].forEach(id=>{const r=ROOMS[id];
        const cx=clamp(me.x,r.x,r.x+r.w), cy=clamp(me.y,r.y,r.y+r.h);
        if(Math.hypot(me.x-cx,me.y-cy)<200)addRoom(id);});
    });
  }
  if(!rects.length)addRoom(me.room||"living");
  return {rooms,doors,rects};
}
function isVisibleAt(x,y,V){
  if(!V)return true;
  for(const r of V.rects) if(inRect(x,y,r)) return true;
  return false;
}
// paint unlit rooms/corridors dark (drawn after the map, before actors)
function drawFog(V){
  if(!V)return;
  const dark=(S.sabotage&&S.sabotage.type==="lights")?"rgba(24,20,14,.93)":"rgba(28,24,17,.82)";
  ctx.fillStyle=dark;
  ROOM_IDS.forEach(id=>{if(V.rooms.has(id)){return;}
    const r=ROOMS[id];ctx.fillRect(r.x-4,r.y-4,r.w+8,r.h+8);});
  DOORS.forEach((d,i)=>{if(V.doors.has(i))return;
    d.rects.forEach(q=>ctx.fillRect(q[0]-3,q[1]-3,q[2]+6,q[3]+6));});
  // faint chalk outline so the floor plan is still readable in the dark
  ctx.save();ctx.globalAlpha=.22;ctx.strokeStyle="#f6f0e2";ctx.lineWidth=2;
  ROOM_IDS.forEach(id=>{if(V.rooms.has(id))return;const r=ROOMS[id];
    ctx.strokeRect(r.x,r.y,r.w,r.h);});
  ctx.globalAlpha=.3;ctx.fillStyle="#f6f0e2";ctx.textAlign="center";
  ctx.font="italic 17px 'Comic Sans MS',cursive";
  ROOM_IDS.forEach(id=>{if(V.rooms.has(id))return;const r=ROOMS[id];
    ctx.fillText(ROOMS[id].name.toUpperCase(),r.x+r.w/2,r.y+r.h/2);});
  ctx.restore();
}

function render(){
  ctx.setTransform(DPR,0,0,DPR,0,0);ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#d8c9ac";ctx.fillRect(0,0,W,H);
  if(S.phase==="menu"){drawMenuBg();return;}

  const zoom=viewZoom();
  const VIS=visibleRects();
  const sx=S.shake>0?rnd(-1,1)*S.shake*10:0, sy=S.shake>0?rnd(-1,1)*S.shake*10:0;
  ctx.save();
  ctx.translate(W/2+sx,H/2+sy);ctx.scale(zoom,zoom);ctx.translate(-S.cam.x,-S.cam.y);
  const grey=S.sabotage&&S.sabotage.type==="comms"&&S.sabotage.hacker;

  // floors
  ctx.fillStyle="#efe6d2";WALK.forEach(r=>ctx.fillRect(r[0],r[1],r[2],r[3]));
  ctx.fillStyle="rgba(190,175,145,.3)";
  DOORS.forEach(d=>d.rects.forEach(r=>ctx.fillRect(r[0],r[1],r[2],r[3])));
  // floorboard hatching (paper pencil texture)
  ctx.strokeStyle="rgba(150,135,110,.18)";ctx.lineWidth=1;
  ROOM_IDS.forEach(id=>{const r=ROOMS[id];ctx.beginPath();
    for(let y=r.y+18;y<r.y+r.h;y+=26){ctx.moveTo(r.x+6,y);ctx.lineTo(r.x+r.w-6,y);}ctx.stroke();});

  // room outlines
  ctx.lineWidth=3.4;ctx.strokeStyle="#3b342c";ctx.lineJoin="round";
  ROOM_IDS.forEach(id=>{const pts=ROOM_OUTLINE[id];ctx.beginPath();
    pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.stroke();});
  // punch doorways open
  DOORS.forEach(d=>d.rects.forEach(r=>{
    ctx.fillStyle="#efe6d2";ctx.fillRect(r[0]-5,r[1]-5,r[2]+10,r[3]+10);
    if(d.locked>0){ctx.fillStyle="rgba(224,85,74,.5)";ctx.fillRect(r[0],r[1],r[2],r[3]);}
  }));
  ctx.save();ctx.setLineDash([10,8]);ctx.lineWidth=2;ctx.strokeStyle="rgba(59,52,44,.45)";
  DOORS.forEach(d=>d.rects.forEach(r=>ctx.strokeRect(r[0],r[1],r[2],r[3])));ctx.restore();

  // labels
  ctx.fillStyle="rgba(59,52,44,.6)";ctx.textAlign="center";
  ctx.font="italic 19px 'Comic Sans MS', cursive";
  ROOM_IDS.forEach(id=>{const r=ROOMS[id];ctx.fillText(ROOMS[id].name.toUpperCase(),r.x+r.w/2,r.y+30);});

  // paper furniture
  drawDecor();

  // systems
  SYSTEMS.forEach(s=>{
    const r=ROOMS[s.room],x=r.x+r.w*s.x,y=r.y+r.h*s.y;
    ctx.save();ctx.translate(x,y);ctx.rotate(wob(s.id.length*5)*0.05);
    ctx.fillStyle=s.id==="emerg"?"#e0554a":"#c9d6f0";
    ctx.fillRect(-40,-24,80,48);ctx.strokeStyle="#3b342c";ctx.lineWidth=2.5;ctx.strokeRect(-40,-24,80,48);
    ctx.fillStyle=s.id==="emerg"?"#fff":"#3b342c";ctx.font="11px 'Comic Sans MS',cursive";
    ctx.fillText(s.label,0,4);ctx.restore();
  });
  // cameras
  CAM_SPOTS.concat(S.extraCams).forEach(rid=>{const r=ROOMS[rid];
    ctx.fillStyle="#4b4741";ctx.fillRect(r.x+16,r.y+r.h-34,20,15);
    ctx.fillStyle="#e0554a";ctx.beginPath();ctx.arc(r.x+40,r.y+r.h-26,4.5,0,7);ctx.fill();});

  // ---- TASK CONSOLES: everyone can see the furniture; yours glow ----
  drawConsoles();

  // vents
  const showVents=S.me.team==="imp"||!S.me.alive;
  VENTS.forEach(v=>{
    ctx.save();ctx.translate(v.x,v.y);
    const active=S.inVent===v;
    ctx.fillStyle=active?"#e9d24a":showVents?"#8a8375":"#b8ab90";
    ctx.strokeStyle="#3b342c";ctx.lineWidth=2.4;
    ctx.fillRect(-19,-14,38,28);ctx.strokeRect(-19,-14,38,28);
    ctx.beginPath();for(let i=-11;i<=11;i+=6){ctx.moveTo(i,-10);ctx.lineTo(i,10);}ctx.stroke();
    if(showVents){ctx.fillStyle="rgba(59,52,44,.6)";ctx.font="10px 'Comic Sans MS',cursive";
      ctx.textAlign="center";ctx.fillText("VENT",0,26);}
    ctx.restore();
  });
  // reactor pads
  if(S.sabotage&&S.sabotage.type==="reactor"){
    const rc=ROOMS.reactor;
    [[rc.x+70,rc.y+rc.h/2+20,S.sabotage.fixA],[rc.x+rc.w-70,rc.y+rc.h/2+20,S.sabotage.fixB]].forEach(p=>{
      ctx.fillStyle=p[2]?"#5aa457":"#e0554a";ctx.beginPath();ctx.arc(p[0],p[1],30,0,7);ctx.fill();
      ctx.strokeStyle="#3b342c";ctx.lineWidth=3;ctx.stroke();});
  }

  // ---- fog of war: everything you can't see goes dark ----
  drawFog(VIS);
  // your own task markers stay faintly visible through the dark
  if(!(S.sabotage&&S.sabotage.type==="comms")){
    ctx.save();ctx.globalAlpha=.55;
    S.me.tasks.filter(t=>!t.done&&!(t.fake&&S.me.team==="imp")).forEach(t=>{
      if(isVisibleAt(t.x,t.y,VIS))return;
      const b=Math.sin(S.t*4+t.x)*4;
      ctx.fillStyle="#e9d24a";ctx.strokeStyle="#3b342c";ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(t.x,t.y-26+b);ctx.lineTo(t.x-10,t.y-42+b);
      ctx.lineTo(t.x+10,t.y-42+b);ctx.closePath();ctx.fill();ctx.stroke();
    });
    ctx.restore();
  }

  // bodies (only the ones in lit space)
  S.bodies.forEach(b=>{if(!b.reported&&isVisibleAt(b.x,b.y,VIS))drawBody(b);});

  // players
  S.players.forEach(p=>{
    if(p.inVent&&p!==S.me)return;                 // hidden inside a vent
    if(p===S.me&&S.inVent)return;
    if(!p.alive&&S.me.alive&&p!==S.me)return;     // living can't see ghosts
    if(p!==S.me&&!isVisibleAt(p.x,p.y,VIS))return; // in an unlit room
    if(p===S.me&&S.invisible>0){ctx.globalAlpha=.18;drawPaperGuy(p,!p.alive,grey);ctx.globalAlpha=1;return;}
    drawPaperGuy(p,!p.alive,grey);
  });

  // visual task animations
  S.visuals.forEach(v=>{
    const p=S.players.find(x=>x.id===v.id);if(!p||p.inVent)return;
    if(p!==S.me&&!isVisibleAt(p.x,p.y,VIS))return;
    drawVisualTask(v,p);
  });

  // particles
  S.particles.forEach(q=>{ctx.save();ctx.translate(q.x,q.y);ctx.rotate(q.rot);
    ctx.globalAlpha=clamp(q.life,0,1);ctx.fillStyle=q.color;
    ctx.fillRect(-q.size/2,-q.size/2,q.size,q.size*1.3);ctx.restore();});
  ctx.globalAlpha=1;
  ctx.restore();

  // vision overlay
  if(S.me.alive&&!S.inVent){
    let vis=(S.sabotage&&S.sabotage.type==="lights")?165:430;
    vis*=zoom;
    const g=ctx.createRadialGradient(W/2,H/2,vis*0.45,W/2,H/2,vis*1.35);
    g.addColorStop(0,"rgba(30,25,18,0)");g.addColorStop(1,"rgba(30,25,18,0.93)");
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  }
  if(S.inVent)drawVentView(zoom);
  if(S.sabotage&&S.sabotage.type==="reactor"){
    ctx.fillStyle=`rgba(224,85,74,${0.12+Math.abs(Math.sin(S.t*4))*0.12})`;ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#fff";ctx.font="bold 26px 'Comic Sans MS',cursive";ctx.textAlign="center";
    ctx.fillText("REACTOR "+Math.ceil(S.sabotage.timer),W/2,86);
  }

  // room name card, fades as you settle in
  if(S.roomLabel&&S.roomLabel.t>0){
    const a=clamp(S.roomLabel.t,0,1);
    ctx.save();ctx.globalAlpha=a*0.9;ctx.textAlign="center";
    ctx.font="italic 26px 'Comic Sans MS',cursive";
    ctx.lineWidth=5;ctx.strokeStyle="rgba(28,24,17,.85)";
    ctx.strokeText(S.roomLabel.name.toUpperCase(),W/2,H-70);
    ctx.fillStyle="#f6f0e2";ctx.fillText(S.roomLabel.name.toUpperCase(),W/2,H-70);
    ctx.restore();
  }

  drawTaskArrow(zoom);
  drawMinimap();
}

/* -------- hand-drawn paper furniture -------- */
function drawDecor(){
  ctx.save();
  ctx.lineJoin="round";
  Object.keys(DECOR).forEach(rid=>{
    const R=ROOMS[rid];
    DECOR[rid].forEach((d,i)=>{
      const [type,fx,fy,fw,fh]=d;
      const w=R.w*fw,h=R.h*fh,x=R.x+R.w*fx-w/2,y=R.y+R.h*fy-h/2;
      ctx.save();
      ctx.translate(x+w/2,y+h/2);
      ctx.rotate(wob(rid.length*7+i*13)*0.03);   // slight paper-cut imperfection
      ctx.translate(-w/2,-h/2);
      // soft paper drop shadow
      ctx.fillStyle="rgba(60,50,38,.14)";ctx.fillRect(4,5,w,h);
      ctx.strokeStyle="#3b342c";ctx.lineWidth=2.2;
      if(type==="rug"){
        ctx.fillStyle="#dfc9a8";ctx.fillRect(0,0,w,h);
        ctx.setLineDash([8,6]);ctx.strokeRect(0,0,w,h);ctx.setLineDash([]);
        ctx.strokeStyle="rgba(59,52,44,.35)";ctx.lineWidth=1.5;
        ctx.strokeRect(w*.1,h*.18,w*.8,h*.64);
      }else if(type==="bed"){
        ctx.fillStyle="#e6dcc4";ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
        ctx.fillStyle="#c9d6f0";ctx.fillRect(2,h*.42,w-4,h*.56);ctx.strokeRect(2,h*.42,w-4,h*.56);
        ctx.fillStyle="#fffdf5";ctx.fillRect(w*.16,h*.08,w*.68,h*.26);ctx.strokeRect(w*.16,h*.08,w*.68,h*.26);
      }else if(type==="table"||type==="counter"){
        ctx.fillStyle=type==="counter"?"#d3c4a4":"#c8a37a";
        ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
        ctx.strokeStyle="rgba(59,52,44,.35)";ctx.lineWidth=1.4;
        for(let k=1;k<4;k++){ctx.beginPath();ctx.moveTo(w*k/4,3);ctx.lineTo(w*k/4,h-3);ctx.stroke();}
      }else if(type==="plant"){
        ctx.fillStyle="#b4854f";ctx.fillRect(w*.22,h*.55,w*.56,h*.45);ctx.strokeRect(w*.22,h*.55,w*.56,h*.45);
        ctx.fillStyle="#4c9c54";
        [[.5,.1],[.2,.34],[.8,.34]].forEach(p=>{ctx.beginPath();
          ctx.ellipse(w*p[0],h*p[1],w*.26,h*.2,0,0,7);ctx.fill();ctx.stroke();});
      }else if(type==="box"){
        ctx.fillStyle="#c8a37a";ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
        ctx.beginPath();ctx.moveTo(0,h*.42);ctx.lineTo(w,h*.42);
        ctx.moveTo(w*.5,0);ctx.lineTo(w*.5,h*.42);ctx.stroke();
      }else if(type==="screen"){
        ctx.fillStyle="#4b4741";ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
        ctx.fillStyle="#8fa7bd";ctx.fillRect(4,4,w-8,h-8);
        ctx.strokeStyle="rgba(255,255,255,.35)";ctx.lineWidth=1.4;
        for(let k=1;k<4;k++){ctx.beginPath();ctx.moveTo(7,h*k/4);ctx.lineTo(w-7,h*k/4);ctx.stroke();}
      }else if(type==="pipe"){
        ctx.fillStyle="#a89f8c";ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
        ctx.strokeStyle="#3b342c";ctx.lineWidth=2;
        for(let k=1;k<6;k++){ctx.beginPath();ctx.moveTo(w*k/6,0);ctx.lineTo(w*k/6,h);ctx.stroke();}
      }else if(type==="door"){
        ctx.fillStyle="#8a6244";ctx.fillRect(0,0,w,h);ctx.strokeRect(0,0,w,h);
        ctx.beginPath();ctx.moveTo(w*.5,0);ctx.lineTo(w*.5,h);ctx.stroke();
        ctx.fillStyle="#e9d24a";
        ctx.beginPath();ctx.arc(w*.42,h*.55,3.5,0,7);ctx.fill();
        ctx.beginPath();ctx.arc(w*.58,h*.55,3.5,0,7);ctx.fill();
      }
      ctx.restore();
    });
  });
  ctx.restore();
}

/* -------- task consoles + guidance -------- */
function drawConsoles(){
  const commsDown=S.sabotage&&S.sabotage.type==="comms";
  TASK_DEFS.forEach(d=>{
    const mine=S.me.tasks.find(t=>t.def===d);
    const active=mine&&!mine.done&&!commsDown;
    ctx.save();ctx.translate(d.x,d.y);ctx.rotate(wob(d.i*9)*0.06);
    // shadow
    ctx.fillStyle="rgba(60,50,38,.18)";ctx.fillRect(-22,14,48,7);
    // console box
    ctx.fillStyle=active?"#f4dd8a":(mine&&mine.done)?"#cfe0c8":"#e2d9c2";
    ctx.strokeStyle="#3b342c";ctx.lineWidth=2.6;
    ctx.beginPath();ctx.moveTo(-24,-18);ctx.lineTo(24,-20);ctx.lineTo(26,16);ctx.lineTo(-22,18);
    ctx.closePath();ctx.fill();ctx.stroke();
    // screen doodle
    ctx.fillStyle="#8fa7bd";ctx.fillRect(-15,-11,30,15);
    ctx.strokeStyle="#3b342c";ctx.lineWidth=1.6;ctx.strokeRect(-15,-11,30,15);
    ctx.fillStyle="#3b342c";ctx.fillRect(-13,8,26,3);
    if(mine&&mine.done){ctx.strokeStyle="#4c9c54";ctx.lineWidth=4;
      ctx.beginPath();ctx.moveTo(-12,0);ctx.lineTo(-4,8);ctx.lineTo(14,-12);ctx.stroke();}
    ctx.restore();
    // label + bobbing marker for your own tasks
    if(active){
      const b=Math.sin(S.t*4+d.i)*5;
      ctx.fillStyle="#e9d24a";ctx.strokeStyle="#3b342c";ctx.lineWidth=2.5;
      ctx.beginPath();ctx.moveTo(d.x,d.y-30+b);ctx.lineTo(d.x-13,d.y-52+b);
      ctx.lineTo(d.x+13,d.y-52+b);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle="#3b342c";ctx.font="12px 'Comic Sans MS',cursive";ctx.textAlign="center";
      ctx.fillText(d.name,d.x,d.y-58+b);
      // "press E" prompt when close
      if(dist(d,S.me)<70&&S.me.alive){
        ctx.fillStyle="#e0554a";ctx.font="13px 'Comic Sans MS',cursive";
        ctx.fillText("[E] DO TASK",d.x,d.y+40);
      }
    }
  });
}
// arrow near the player pointing at the closest remaining task
function drawTaskArrow(zoom){
  if(!S.me.alive||S.inVent)return;
  if(S.sabotage&&S.sabotage.type==="comms")return;
  const t=nextTask();if(!t||t.fake&&S.me.team==="imp")return;
  const a=Math.atan2(t.y-S.me.y,t.x-S.me.x);
  const cx=W/2+Math.cos(a)*90,cy=H/2+Math.sin(a)*90;
  ctx.save();ctx.translate(cx,cy);ctx.rotate(a);
  ctx.globalAlpha=.85;ctx.fillStyle="#e9d24a";ctx.strokeStyle="#3b342c";ctx.lineWidth=2.5;
  ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(-10,-11);ctx.lineTo(-5,0);ctx.lineTo(-10,11);
  ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  ctx.globalAlpha=1;
}
// small paper minimap top-right with your task rooms flagged
function drawMinimap(){
  const mw=204,mh=Math.round(mw*(MAP_BOUNDS.y1-MAP_BOUNDS.y0)/(MAP_BOUNDS.x1-MAP_BOUNDS.x0));
  const mx=W-mw-12,my=54;
  const sx=mw/(MAP_BOUNDS.x1-MAP_BOUNDS.x0),sy=mh/(MAP_BOUNDS.y1-MAP_BOUNDS.y0);
  const tx=v=>mx+(v-MAP_BOUNDS.x0)*sx, ty=v=>my+(v-MAP_BOUNDS.y0)*sy;
  ctx.save();
  ctx.globalAlpha=.93;
  ctx.fillStyle="#f6f0e2";ctx.strokeStyle="#3b342c";ctx.lineWidth=2.5;
  ctx.fillRect(mx-6,my-6,mw+12,mh+12);ctx.strokeRect(mx-6,my-6,mw+12,mh+12);
  ROOM_IDS.forEach(id=>{const r=ROOMS[id];
    const hasTask=S.me.tasks.some(t=>!t.done&&t.room===id&&!(t.fake&&S.me.team==="imp"));
    ctx.fillStyle=hasTask?"#f4dd8a":"#e6dcc4";
    ctx.fillRect(tx(r.x),ty(r.y),r.w*sx,r.h*sy);
    ctx.strokeStyle="rgba(59,52,44,.7)";ctx.lineWidth=1;
    ctx.strokeRect(tx(r.x),ty(r.y),r.w*sx,r.h*sy);
  });
  DOORS.forEach(d=>d.rects.forEach(r=>{ctx.fillStyle="rgba(59,52,44,.25)";
    ctx.fillRect(tx(r[0]),ty(r[1]),r[2]*sx,r[3]*sy);}));
  if(S.sabotage){
    const rm={lights:"electrical",comms:"admin",reactor:"reactor"}[S.sabotage.type];
    if(rm){const r=ROOMS[rm];ctx.fillStyle=`rgba(224,85,74,${.35+Math.abs(Math.sin(S.t*5))*.35})`;
      ctx.fillRect(tx(r.x),ty(r.y),r.w*sx,r.h*sy);}
  }
  // mark the two entrances
  ["front","back"].forEach(rid=>{const r=ROOMS[rid];
    ctx.fillStyle="#4c9c54";ctx.font="9px 'Comic Sans MS',cursive";ctx.textAlign="center";
    ctx.fillText("⌂",tx(r.x+r.w/2),ty(r.y+r.h/2)+3);});
  ctx.fillStyle="#e0554a";ctx.beginPath();ctx.arc(tx(S.me.x),ty(S.me.y),4,0,7);ctx.fill();
  ctx.strokeStyle="#3b342c";ctx.lineWidth=1.4;ctx.stroke();
  ctx.restore();
}

/* ---- Among Us style vent HUD: directional arrows around the hatch ---- */
function drawVentView(zoom){
  // dark tunnel vignette
  const g=ctx.createRadialGradient(W/2,H/2,60,W/2,H/2,Math.max(W,H)*0.62);
  g.addColorStop(0,"rgba(20,17,12,.15)");g.addColorStop(1,"rgba(16,14,10,.94)");
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  // hatch you're sitting in
  ctx.save();ctx.translate(W/2,H/2);
  const pop=1+S.ventAnim*1.2;
  ctx.scale(pop,pop);
  ctx.fillStyle="#8a8375";ctx.strokeStyle="#f6f0e2";ctx.lineWidth=3;
  ctx.fillRect(-26,-20,52,40);ctx.strokeRect(-26,-20,52,40);
  ctx.beginPath();for(let i=-16;i<=16;i+=8){ctx.moveTo(i,-14);ctx.lineTo(i,14);}ctx.stroke();
  ctx.restore();
  // arrows to linked vents
  ventArrows().forEach(a=>{
    const px=W/2+a.dx*88*zoom, py=H/2+a.dy*88*zoom;
    ctx.save();ctx.translate(px,py);ctx.rotate(a.ang);
    const pulse=1+Math.sin(S.t*5)*0.06;
    ctx.scale(pulse,pulse);
    ctx.fillStyle="#e9d24a";ctx.strokeStyle="#3b342c";ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(24,0);ctx.lineTo(-14,-17);ctx.lineTo(-6,0);ctx.lineTo(-14,17);
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.restore();
    // destination label, kept upright
    ctx.save();ctx.textAlign="center";ctx.font="13px 'Comic Sans MS',cursive";
    ctx.fillStyle="#f6f0e2";
    ctx.fillText(ROOMS[a.vent.room].name,px+a.dx*46*zoom,py+a.dy*46*zoom+4);
    ctx.restore();
  });
  ctx.save();ctx.textAlign="center";ctx.fillStyle="#f6f0e2";
  ctx.font="16px 'Comic Sans MS',cursive";
  ctx.fillText("VENT · "+ROOMS[S.inVent.room].name,W/2,64);
  ctx.font="12px 'Comic Sans MS',cursive";ctx.globalAlpha=.8;
  ctx.fillText("push a direction or tap an arrow — F to climb out",W/2,86);
  ctx.restore();
}

function drawPaperGuy(p,ghost,grey){
  const col=grey?"#9a958c":p.color;
  // ghosts float and gently sway instead of walking
  const bobY=ghost?Math.sin(S.t*2+p.id)*6-6:Math.sin(p.bob)*2.4;
  ctx.save();ctx.translate(p.x,p.y+bobY);ctx.globalAlpha=ghost?0.45:1;
  ctx.fillStyle="rgba(60,50,38,.25)";ctx.beginPath();ctx.ellipse(3,22,18,6,0,0,7);ctx.fill();
  ctx.rotate(Math.sin(p.bob*0.5)*0.05);ctx.scale(p.face,1);
  ctx.fillStyle=col;ctx.strokeStyle="#3b342c";ctx.lineWidth=2.8;ctx.lineJoin="round";
  ctx.beginPath();ctx.moveTo(-16,-24);ctx.lineTo(16,-26);ctx.lineTo(18,19);ctx.lineTo(-15,21);
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.moveTo(18,19);ctx.lineTo(7,20);ctx.lineTo(17,8);ctx.closePath();
  ctx.fillStyle="rgba(0,0,0,.18)";ctx.fill();
  ctx.fillStyle="#cfe4f2";ctx.beginPath();ctx.ellipse(4,-10,10,6.5,0,0,7);ctx.fill();
  ctx.strokeStyle="#3b342c";ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.moveTo(-7,21);ctx.lineTo(-7,29);ctx.moveTo(7,21);ctx.lineTo(7,29);
  ctx.lineWidth=3;ctx.stroke();
  ctx.restore();
  if(!grey&&!(p===S.me&&S.invisible>0)){
    ctx.save();ctx.textAlign="center";ctx.font="14px 'Comic Sans MS',cursive";
    ctx.fillStyle=p===S.me?"#e0554a":"#2f2a24";
    ctx.fillText(p.name,p.x,p.y-36);
    // ghosts are tagged with their ghost role so the afterlife is readable
    if(ghost){const g=p.ghost||ghostRole(p);
      ctx.font="11px 'Comic Sans MS',cursive";ctx.fillStyle=g.color;
      ctx.fillText("👻 "+g.name,p.x,p.y-50+Math.sin(S.t*2+p.id)*2);}
    ctx.restore();
  }else if(p===S.me&&S.invisible>0){
    // invisible Spy: only the player sees their own faint, fading name
    ctx.save();ctx.globalAlpha=clamp(1-S.t%0.5*2,0,1)*0.5;
    ctx.textAlign="center";ctx.font="12px 'Comic Sans MS',cursive";ctx.fillStyle="#e9d24a";
    ctx.fillText(p.name+" (hidden)",p.x,p.y-36);ctx.restore();ctx.globalAlpha=1;
  }
  if(S.hauntedBy===p.id&&(p===S.me||S.me.team==="imp"||!S.me.alive)){
    ctx.save();ctx.translate(p.x,p.y-56+Math.sin(S.t*5)*3);
    ctx.fillStyle="#8c62c4";ctx.strokeStyle="#3b342c";ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(0,0,12,0,7);ctx.fill();ctx.stroke();
    ctx.fillStyle="#fff";ctx.font="bold 15px sans-serif";ctx.textAlign="center";ctx.fillText("!",0,5);
    ctx.restore();
  }
}
// visual tasks other players can witness
function drawVisualTask(v,p){
  const x=p.x,y=p.y,t=S.t;
  ctx.save();ctx.strokeStyle="#3b342c";ctx.lineWidth=2.2;
  if(v.type==="scan"){
    const k=(Math.sin(t*3)+1)/2;
    ctx.strokeStyle="#5fc9cf";ctx.lineWidth=3;
    ctx.beginPath();ctx.ellipse(x,y-40+k*70,34,10,0,0,7);ctx.stroke();
    ctx.strokeStyle="#3b342c";ctx.lineWidth=2;ctx.strokeRect(x-36,y-46,72,86);
  }
  if(v.type==="trash"){
    for(let i=0;i<4;i++){const o=(t*90+i*40)%110;
      ctx.fillStyle=["#8a6244","#b8ab90","#e2d9c2"][i%3];
      ctx.fillRect(x+18+Math.sin(i+t)*5,y-20+o,9,11);}
    ctx.fillStyle="#4b4741";ctx.fillRect(x+10,y+30,34,18);
  }
  if(v.type==="water"){
    for(let i=0;i<5;i++){const o=(t*120+i*26)%70;
      ctx.fillStyle="#5fc9cf";ctx.fillRect(x+20,y-24+o,4,7);}
    ctx.fillStyle="#4c9c54";ctx.beginPath();ctx.arc(x+30,y+22,13,0,7);ctx.fill();ctx.stroke();
  }
  if(v.type==="cook"){
    for(let i=0;i<3;i++){const o=(t*60+i*24)%60;
      ctx.globalAlpha=1-o/60;ctx.fillStyle="#cfc7b3";
      ctx.beginPath();ctx.arc(x+26+Math.sin(t*3+i)*5,y-14-o,7,0,7);ctx.fill();}
    ctx.globalAlpha=1;ctx.fillStyle="#8a8375";ctx.fillRect(x+14,y-8,28,10);
  }
  if(v.type==="gen"){
    for(let i=0;i<6;i++){const a=t*8+i;
      ctx.fillStyle=i%2?"#e9d24a":"#e9913c";
      ctx.fillRect(x+22+Math.cos(a)*16,y-8+Math.sin(a)*16,4,4);}
  }
  if(v.type==="package"){
    ctx.fillStyle="#c8a37a";ctx.fillRect(x+16,y-14+Math.sin(t*4)*4,26,24);
    ctx.strokeRect(x+16,y-14+Math.sin(t*4)*4,26,24);
  }
  ctx.restore();
}
function drawBody(b){
  ctx.save();ctx.translate(b.x,b.y);ctx.rotate(0.9);
  ctx.fillStyle="rgba(60,50,38,.22)";ctx.beginPath();ctx.ellipse(3,10,21,7,0,0,7);ctx.fill();
  ctx.fillStyle=b.color;ctx.strokeStyle="#3b342c";ctx.lineWidth=2.7;
  ctx.beginPath();ctx.moveTo(-17,-13);ctx.lineTo(15,-17);ctx.lineTo(19,11);ctx.lineTo(-14,14);
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle="#b8342b";ctx.beginPath();ctx.ellipse(-2,4,15,6,0.3,0,7);ctx.fill();
  ctx.restore();
  ctx.fillStyle="#b8342b";ctx.font="13px 'Comic Sans MS',cursive";ctx.textAlign="center";
  ctx.fillText("BODY",b.x,b.y-26);
}
function drawMenuBg(){
  const t=performance.now()/1000;
  for(let i=0;i<26;i++){
    const x=((i*137.5+t*18)%(W+80))-40,y=((i*91.3+t*11)%(H+80))-40;
    ctx.save();ctx.translate(x,y);ctx.rotate(t*0.4+i);
    ctx.fillStyle=["#e0554a","#4a7fd9","#4c9c54","#e9d24a","#ea86bd"][i%5];
    ctx.globalAlpha=.35;ctx.fillRect(-9,-11,18,22);ctx.restore();
  }
  ctx.globalAlpha=1;
}

/* ============================ 11. SCORES / UI ======================= */
function saveScore(score,role,won){
  const list=JSON.parse(localStorage.getItem("funsion_scores")||"[]");
  list.push({score,role,won,d:new Date().toLocaleDateString()});
  list.sort((a,b)=>b.score-a.score);
  localStorage.setItem("funsion_scores",JSON.stringify(list.slice(0,10)));
}
function renderScores(){
  const list=JSON.parse(localStorage.getItem("funsion_scores")||"[]");
  $("#scoreTable").innerHTML=list.length?list.map((s,i)=>
    `<div><span>${i+1}. ${s.role} ${s.won?"🏆":""}</span><b>${s.score}</b></div>`).join("")
    :"<div>No scores yet — go fold some paper.</div>";
}
function hideAll(){["#menu","#lobby","#panel","#meeting","#pause","#over","#scores","#howto","#reveal","#spawn"]
  .forEach(s=>$(s).classList.add("hidden"));panelOpen=false;
  if(S._revealGo){removeEventListener("keydown",S._revealGo);
    removeEventListener("pointerdown",S._revealGo);S._revealGo=null;}}
function togglePause(){S.paused=!S.paused;$("#pause").classList.toggle("hidden",!S.paused);}

const sliders=[["setPlayers","vPlayers","players",""],["setImp","vImp","imps",""],
  ["setKill","vKill","killCd","s"],["setRole2","vRole2","roleCd","s"],["setUses","vUses","uses",""],
  ["setTasks","vTasks","tasks",""],["setSpeed","vSpeed","speed",""],["setMeet","vMeet","meetings",""],
  ["setSab","vSab","sabCd","s"]];
function syncLobby(){
  sliders.forEach(([id,lbl,key,suf])=>{const el=$("#"+id);S.settings[key]=+el.value;
    $("#"+lbl).textContent=el.value+suf;});
  S.settings.name=$("#setName").value;S.settings.role=$("#setRole").value;
  const maxImp=Math.max(1,Math.floor(S.settings.players/2)-1);
  if(S.settings.imps>maxImp){S.settings.imps=maxImp;$("#setImp").value=maxImp;$("#vImp").textContent=maxImp;}
  $("#rosterList").innerHTML=COLORS.slice(0,S.settings.players).map((c,i)=>
    `<div class="rchip"><span class="swatch" style="background:${c[1]}"></span>${
      i===0?(S.settings.name||"YOU").toUpperCase():c[0].toUpperCase()}</div>`).join("");
}
sliders.forEach(([id])=>$("#"+id).addEventListener("input",syncLobby));
$("#setName").addEventListener("input",syncLobby);
$("#setRole").addEventListener("change",syncLobby);
$("#btnPlay").onclick=()=>{hideAll();$("#lobby").classList.remove("hidden");syncLobby();};
$("#btnHowto").onclick=()=>{hideAll();$("#howto").classList.remove("hidden");};
$("#btnHowBack").onclick=()=>{hideAll();$("#menu").classList.remove("hidden");};
$("#btnScores").onclick=()=>{renderScores();hideAll();$("#scores").classList.remove("hidden");};
$("#btnScoresBack").onclick=()=>{hideAll();$("#menu").classList.remove("hidden");};
$("#btnBackMenu").onclick=()=>{hideAll();$("#menu").classList.remove("hidden");};
$("#btnStart").onclick=()=>{syncLobby();setupGame();};
$("#pauseBtn").onclick=togglePause;
$("#btnResume").onclick=togglePause;
$("#btnQuit").onclick=()=>{S.paused=false;S.phase="menu";hideAll();$("#hud").classList.add("hidden");
  $("#lobby").classList.remove("hidden");syncLobby();};
$("#btnAgain").onclick=()=>setupGame();
$("#btnLobby").onclick=()=>{S.phase="menu";hideAll();$("#hud").classList.add("hidden");
  $("#lobby").classList.remove("hidden");syncLobby();};
$("#panelClose").onclick=closePanel;
syncLobby();
