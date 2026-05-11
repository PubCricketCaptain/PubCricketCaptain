// Load Firebase dynamically
window._firebaseDB = null;
(function loadFirebase() {
  var s1 = document.createElement('script');
  s1.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js';
  s1.onload = function() {
    var s2 = document.createElement('script');
    s2.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js';
    s2.onload = function() {
      try {
        firebase.initializeApp({
          apiKey: "AIzaSyDYphLCwkifIZnevtopINUCYWgSRkwR1Z4",
          authDomain: "pub-cricket-captain.firebaseapp.com",
          projectId: "pub-cricket-captain",
          databaseURL: "https://pub-cricket-captain-default-rtdb.firebaseio.com",
          storageBucket: "pub-cricket-captain.firebasestorage.app",
          messagingSenderId: "955219189872",
          appId: "1:955219189872:web:985212e2eb3e77140fd4b5"
        });
        var _db = firebase.database();
        window._firebaseDB = _db;
        window._firebaseSet = function(ref,data){ return ref.set(data); };
        window._firebaseRef_fn = function(db,path){ return db.ref(path); };
        window._firebaseOnValue = function(ref,cb){ return ref.on('value',cb); };
        window._firebaseGet = function(ref){ return ref.once('value'); };
        console.log('Firebase ready');
      } catch(e) { console.log('Firebase init failed:', e.message); }
    };
    document.head.appendChild(s2);
  };
  s1.onerror = function(){ console.log('Firebase CDN failed to load'); };
  document.head.appendChild(s1);
})();

window.onerror=function(msg,src,line,col,err){
  const div=document.createElement('div');
  div.style.cssText='position:fixed;top:0;left:0;right:0;background:#7A1B1B;color:#fff;padding:10px;font-size:11px;font-family:monospace;z-index:99999;white-space:pre-wrap;';
  div.textContent='ERROR: '+msg+'\nLine: '+line+' Col: '+col+'\nSrc: '+src+'\n'+(err&&err.stack?err.stack.split('\n').slice(0,6).join('\n'):'no stack');
  document.body.appendChild(div);
  return false;
};
window.addEventListener('unhandledrejection',function(e){
  const div=document.createElement('div');
  div.style.cssText='position:fixed;top:40px;left:0;right:0;background:#5A3B7A;color:#fff;padding:10px;font-size:11px;font-family:monospace;z-index:99999;white-space:pre-wrap;';
  div.textContent='PROMISE ERROR: '+(e.reason&&e.reason.message||String(e.reason))+'\n'+(e.reason&&e.reason.stack?e.reason.stack.split('\n').slice(0,4).join('\n'):'');
  document.body.appendChild(div);
});

// =======================================
// MULTIPLAYER
// =======================================
let mp = {
  active: false,      // are we in multiplayer mode?
  role: null,         // 'host' or 'guest'
  roomCode: null,     // 4-letter code
  unsubscribe: null,  // Firebase listener cleanup
  lastUpdate: null,   // timestamp of last Firebase update
  dropTimer: null,    // connection drop detection timer
  actionTimer: null,  // per-action countdown timer
};

function mpRoomPath(code){ return 'games/' + code.toUpperCase(); }

function generateRoomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O confusion
  let code='';
  for(let i=0;i<4;i++) code+=chars[Math.floor(Math.random()*chars.length)];
  return code;
}

async function mpCreateRoom(){
  if(!window._firebaseDB){
    // Wait up to 3 seconds for Firebase to initialise
    let attempts=0;
    while(!window._firebaseDB && attempts<30){ await new Promise(r=>setTimeout(r,100)); attempts++; }
    if(!window._firebaseDB){ alert('Firebase not ready -- please refresh and try again'); return; }
  }
  const code = generateRoomCode();
  mp.active=true; mp.role='host'; mp.roomCode=code;
  st.mpPhase='lobby';
  st.cpuTeam=null; // no CPU in multiplayer
  matchTeams={t1:null,t2:null};
  render(); // show lobby immediately
  mpSubscribe();
  mpPush(); // push in background -- don't await
}

async function mpJoinRoom(code){
  if(!window._firebaseDB){
    let attempts=0;
    while(!window._firebaseDB && attempts<30){ await new Promise(r=>setTimeout(r,100)); attempts++; }
    if(!window._firebaseDB){ alert('Firebase not ready -- please refresh'); return; }
  }
  code = code.toUpperCase().trim();
  if(code.length!==4){ alert('Enter a 4-letter room code'); return; }
  // Check room exists
  const snap = await window._firebaseGet(window._firebaseRef_fn(window._firebaseDB, mpRoomPath(code)));
  if(!snap.exists()){ alert('Room not found -- check the code'); return; }
  mp.active=true; mp.role='guest'; mp.roomCode=code;
  st.cpuTeam=null; // no CPU in multiplayer
  const data = snap.val();
  if(data.st){
    st = data.st;
    if(!st.log) st.log=[];
    if(!st.batsmen) st.batsmen=[];
    if(!st.activeBat) st.activeBat=[];
    if(!st.umpires) st.umpires=[];
    if(!st.overBalls) st.overBalls=[];
    if(!st.bowlerOvers) st.bowlerOvers={};
    if(!st.bowlStats) st.bowlStats={};
    if(!st.mentalities) st.mentalities={};
    if(!st.bowlerConsecWkts) st.bowlerConsecWkts={};
  }
  if(data.matchTeams) matchTeams = data.matchTeams;
  mpSubscribe();
  render();
}

function mpSubscribe(){
  if(mp.unsubscribe) mp.unsubscribe();
  const dbRef = window._firebaseRef_fn(window._firebaseDB, mpRoomPath(mp.roomCode));
  const unsub = null;
  window._firebaseOnValue(dbRef, (snap)=>{
    if(!snap.exists()) return;
    mp.lastUpdate=Date.now();
    const data = snap.val();
    // Check for forfeit
    if(data.forfeit&&data.forfeit.by){
      const forfeitName=data.forfeit.by==='team1'?(matchTeams.t1?matchTeams.t1.name:'Team 1'):(matchTeams.t2?matchTeams.t2.name:'Team 2');
      const myRole=mp.role==='host'?'team1':'team2';
      if(data.forfeit.by!==myRole){
        // Opponent forfeited -- show result
        mpClearActionTimer();
        alert(forfeitName+' has forfeited. You win!');
        mpLeave();render();return;
      }
    }
    if(data.st&&typeof data.st==='object'){
      st = data.st;
      // Ensure critical arrays exist after deserialisation
      if(!st.log) st.log=[];
      if(!st.batsmen) st.batsmen=[];
      if(!st.activeBat) st.activeBat=[];
      if(!st.umpires) st.umpires=[];
      if(!st.overBalls) st.overBalls=[];
      if(!st.bowlerOvers) st.bowlerOvers={};
      if(!st.bowlStats) st.bowlStats={};
      if(!st.mentalities) st.mentalities={};
      if(!st.bowlerConsecWkts) st.bowlerConsecWkts={};
    }
    if(data.matchTeams) matchTeams = data.matchTeams;
    renderOnly();
  });
  // compat SDK: unsub is the ref.off function
  mp.unsubscribe = ()=>{ dbRef.off('value'); };
  mpStartDropDetection();
}

async function mpPush(){
  if(!mp.active||!window._firebaseDB||!mp.roomCode) return;
  try{
    const payload={st:JSON.parse(JSON.stringify(st)), matchTeams:matchTeams, ts:Date.now()};
    await window._firebaseSet(
      window._firebaseRef_fn(window._firebaseDB, mpRoomPath(mp.roomCode)),
      payload
    );
  }catch(e){ console.warn('Firebase push failed:', e); }
}

function mpLeave(){
  if(mp.unsubscribe) mp.unsubscribe();
  mp={active:false,role:null,roomCode:null,unsubscribe:null};
  render();
}

// -- MP TIMERS --
function mpClearActionTimer(){
  if(mp.actionTimer){clearInterval(mp.actionTimer);mp.actionTimer=null;}
  const el=document.getElementById('mp-timer');
  if(el)el.remove();
}

function mpStartActionTimer(seconds, onExpire, label){
  mpClearActionTimer();
  if(!mp.active) return;
  let t=seconds;
  // Show timer badge in app
  function showTimer(){
    let el=document.getElementById('mp-timer');
    if(!el){
      el=document.createElement('div');
      el.id='mp-timer';
      el.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);'
        +'background:var(--dark);color:var(--cream);padding:6px 16px;border-radius:20px;'
        +'font-size:12px;font-family:Georgia,serif;z-index:9990;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent=(label||'Auto-play')+' in '+t+'s';
  }
  showTimer();
  mp.actionTimer=setInterval(()=>{
    t--;
    showTimer();
    if(t<=0){
      mpClearActionTimer();
      onExpire();
    }
  },1000);
}

function mpStartDropDetection(){
  if(mp.dropTimer){clearInterval(mp.dropTimer);mp.dropTimer=null;}
  mp.lastUpdate=Date.now();
  mp.dropTimer=setInterval(()=>{
    if(!mp.active){clearInterval(mp.dropTimer);return;}
    const elapsed=(Date.now()-(mp.lastUpdate||Date.now()))/1000;
    if(elapsed>60){
      // Offer end without penalty
      const existing=document.getElementById('mp-drop-banner');
      if(!existing){
        const div=document.createElement('div');
        div.id='mp-drop-banner';
        div.style.cssText='position:fixed;top:0;left:0;right:0;background:#7A1B1B;color:#fff;'
          +'padding:10px 12px;font-size:12px;font-family:Georgia,serif;z-index:9998;text-align:center;';
        div.innerHTML='Connection lost for 60s. '
          +'<button onclick="mpEndWithoutPenalty()" style="margin-left:8px;padding:3px 10px;'
          +'background:#fff;color:#7A1B1B;border:none;border-radius:3px;font-family:Georgia,serif;'
          +'font-size:11px;cursor:pointer;">End game -- no penalty</button>';
        document.body.appendChild(div);
      }
    } else if(elapsed>30){
      const existing=document.getElementById('mp-drop-banner');
      if(!existing){
        const div=document.createElement('div');
        div.id='mp-drop-banner';
        div.style.cssText='position:fixed;top:0;left:0;right:0;background:#8B6914;color:#fff;'
          +'padding:8px 12px;font-size:11px;font-family:Georgia,serif;z-index:9998;text-align:center;';
        div.textContent='Connection lost -- waiting for opponent...';
        document.body.appendChild(div);
      }
    } else {
      const el=document.getElementById('mp-drop-banner');
      if(el)el.remove();
    }
  },5000);
}

function mpEndWithoutPenalty(){
  const el=document.getElementById('mp-drop-banner');
  if(el)el.remove();
  mpClearActionTimer();
  mpLeave();
  render();
}

function mpForfeit(){
  if(!mp.active||st.phase!=='playing') return;
  if(!confirm('Forfeit the match? You will lose.')) return;
  // Write forfeit to Firebase so opponent sees it
  const forfeitTeam = mp.role==='host'?'team1':'team2';
  if(window._firebaseDB){
    window._firebaseSet(
      window._firebaseRef_fn(window._firebaseDB, mpRoomPath(mp.roomCode)+'/forfeit'),
      {by: forfeitTeam, ts: Date.now()}
    );
  }
  mpLeave();
  render();
}

// Role helpers
function mpIsHost(){ return !mp.active || mp.role==='host'; }
function mpIsGuest(){ return mp.active && mp.role==='guest'; }
// Host controls bowling, guest controls batting (and vice versa if guest bats first)
// In 2P: host always bowls first innings, guest bats first innings
// The bowler sees bowling screen, batter sees batting screen
function mpGetScreen(){
  if(!mp.active) return st.gameScreen; // local game -- use as-is
  // Host = bowling screen, Guest = batting screen (for commentary both see commentary)
  if(st.gameScreen==='commentary') return 'commentary';
  if(mp.role==='host') return 'bowling';
  if(mp.role==='guest') return 'batting';
  return st.gameScreen;
}
// =======================================
// DATA
// =======================================
const PITCH_OPTS = [
  {id:'minefield',label:'Minefield',icon:'[zap]',desc:"Seaming, crumbling -- bowlers' paradise", idx:0, weight:1},
  {id:'good',     label:'Good',     icon:'[pitch]',desc:'Fair contest, true bounce',             idx:1, weight:4},
  {id:'flat',     label:'Flat Track',icon:'[bat]',desc:"Batter's highway -- high scores expected",idx:2, weight:2},
];
const WEATHER_OPTS = [
  {id:'sunny',   label:'Sunny',   icon:'[sun]',desc:'Standard conditions',                    idx:0, weight:5},
  {id:'overcast',label:'Overcast',icon:'[cloud]', desc:'Helps swing and seam bowlers',           idx:1, weight:3},
  {id:'hot',     label:'Hot',     icon:'?',desc:'Ball bounces -- fast bowlers thrive',      idx:2, weight:2},
  {id:'damp',    label:'Damp',    icon:'[rain]?',desc:'Slow, low scoring -- tough for all',       idx:3, weight:1},
];
const BATSMEN_TEMPLATE = [
  {id:0,name:'B1', label:'Opener',  style:'Conservative',hand:'R',stars:4,vs_fast:1.2, vs_spin:0.7, run_bias:[0,1,1,2,2,4],risk:.06},
  {id:1,name:'B2', label:'Opener',  style:'Conservative',hand:'L',stars:4,vs_fast:1.2, vs_spin:0.7, run_bias:[0,1,1,2,2,4],risk:.06},
  {id:2,name:'B3', label:'No.3',    style:'Conservative',hand:'R',stars:3,vs_fast:1.1, vs_spin:.75, run_bias:[0,1,1,2,2,4],risk:.08},
  {id:3,name:'B4', label:'No.4',    style:'Balanced',    hand:'L',stars:4,vs_fast:1.0, vs_spin:1.0, run_bias:[0,1,2,2,4,6],risk:.10},
  {id:4,name:'B5', label:'No.5',    style:'Aggressive',  hand:'R',stars:3,vs_fast:.85, vs_spin:1.2, run_bias:[0,1,2,4,4,6],risk:.14},
  {id:5,name:'B6', label:'No.6',    style:'Aggressive',  hand:'L',stars:3,vs_fast:.85, vs_spin:1.2, run_bias:[0,1,2,4,4,6],risk:.14},
  {id:6,name:'B7', label:'No.7',    style:'Ultra-Agg',   hand:'R',stars:2,vs_fast:.8,  vs_spin:.8,  run_bias:[0,1,2,4,6,6],risk:.20},
  {id:7,name:'B8', label:'No.8',    style:'Ultra-Agg',   hand:'L',stars:2,vs_fast:.8,  vs_spin:.8,  run_bias:[0,1,2,4,6,6],risk:.20},
  {id:8, name:'B9', label:'Tail',  style:'Slogger',hand:'R',stars:1,vs_fast:.6,vs_spin:.6,run_bias:[0,1,4,4,6,6],risk:.30},
  {id:9, name:'B10',label:'Tail',  style:'Slogger',hand:'L',stars:1,vs_fast:.6,vs_spin:.6,run_bias:[0,1,4,4,6,6],risk:.30},
  {id:10,name:'B11',label:'Tail',  style:'Slogger',hand:'R',stars:1,vs_fast:.5,vs_spin:.5,run_bias:[0,1,4,4,6,6],risk:.35},
];
const BOWLERS = [
  {id:'fa',name:'Fast A',  type:'fast',  hand:'R',speciality:'opener',  stars:5},
  {id:'fb',name:'Fast B',  type:'fast',  hand:'L',speciality:'finisher',stars:4},
  {id:'mp',name:'Med-Pace',type:'medium',hand:'R',speciality:'none',    stars:3},
  {id:'sa',name:'Spin A',  type:'spin',  hand:'R',speciality:'none',    stars:4},
  {id:'sb',name:'Spin B',  type:'spin',  hand:'L',speciality:'none',    stars:3},
];
const UMPIRE_POOL = [
  {name:'R. Palmer',   quality:'Strong', strength:5},
  {name:'H. Hobson',   quality:'Strong', strength:5},
  {name:'D. Constant', quality:'Good',   strength:4},
  {name:'M. Kitchen',  quality:'Good',   strength:4},
  {name:'T. Fairley',  quality:'Fair',   strength:3},
  {name:'J. Holder',   quality:'Fair',   strength:3},
  {name:'B. Dudleston',quality:'Weak',   strength:2},
  {name:'P. Willey',   quality:'Weak',   strength:2},
];
const FIELD_OPTS = [
  {id:'attacking',label:'Attacking',desc:'More boundaries, higher wicket risk'},
  {id:'balanced', label:'Balanced', desc:'Even distribution'},
  {id:'defensive',label:'Defensive',desc:'More dot balls, fewer wickets'},
];

// Styles: id, batting modifiers
const STYLES = {
  'Conservative': {vs_fast:1.15, vs_spin:0.72, run_bias:[0,1,1,2,2,4]},
  'Balanced':     {vs_fast:1.0,  vs_spin:1.0,  run_bias:[0,1,2,2,4,6]},
  'Aggressive':   {vs_fast:0.85, vs_spin:1.2,  run_bias:[0,1,2,4,4,6]},
  'Ultra-Agg':    {vs_fast:0.8,  vs_spin:0.8,  run_bias:[0,1,2,4,6,6]},
  'Slogger':      {vs_fast:0.6,  vs_spin:0.6,  run_bias:[0,1,4,4,6,6]},
};
const STYLE_LIST = ['Conservative','Balanced','Aggressive','Ultra-Agg','Slogger'];
const BOWL_TYPES = ['fast','medium','spin'];
const SPECIALISMS = ['none','opener','finisher','strike','swing','seamer','tailkiller'];
const SPECIALISM_LABELS = {
  none:'None', opener:'Opener (overs 1-2)', finisher:'Finisher (overs 9-10)',
  strike:'Strike (hot weather)', swing:'Swing (overcast)', seamer:'Seamer (minefield)',
  tailkiller:'Tail Killer (vs 7-11)',
};

// Batsman mentalities -- chosen live by batting team each ball
const MENTALITIES = [
  {id:'defensive',   label:'Defensive',   icon:'[o]', desc:'Dot balls, hard to dismiss'},
  {id:'rotation',    label:'Rotate',      icon:'[rot]', desc:'Singles & twos, keeps strike'},
  {id:'positive',    label:'Positive',    icon:'[v]', desc:'Balanced approach'},
  {id:'aggressive',  label:'Aggressive',  icon:'[agg]', desc:'Boundary hunting, higher risk'},
];

// Batsman specialities (top 6 only) -- passive auto buffs
const BAT_SPECIALISMS = ['none','vs_fast','vs_spin','rotation','big_hitter','lower_order','closer'];
const BAT_SPECIALISM_LABELS = {
  none:'None',
  vs_fast:'Good vs Fast',
  vs_spin:'Good vs Spin',
  rotation:'Strike Rotation',
  big_hitter:'Big Hitter',
  lower_order:'Lower Order Specialist',
  closer:'Closer (overs 8-10)',
};

// Team personalities
const TEAM_PERSONALITIES = ['Balanced','Setting','Chasing'];
const TEAM_PERSONALITY_DESCS = {
  Balanced:'No preference -- adaptable',
  Setting: 'Built to bat first -- aggressive setting, disciplined defence',
  Chasing: 'Built to bat second -- contain first, chase hard',
};

const BAT_SPECIALISM_SHORT = {
  none:'None',
  vs_fast:'vs Fast',
  vs_spin:'vs Spin',
  rotation:'Rotate',
  big_hitter:'Big Hit',
  lower_order:'L.Order',
  closer:'Closer',
};

function makePlayer(id,name,batStars,style,hand,isWk=false,isBowler=false,bowlStars=1,bowlType='fast',specialism='none',batSpecialism='none'){
  return {id,name,batStars,style,hand,isWk,isBowler,bowlStars,bowlType,specialism,batSpecialism};
}

function makeTeam(name, personality='Balanced', players=[]){
  return {name, personality, players: players.map((p,i)=>({...p,id:i}))};
}

// -- Stock CPU Teams --
const STOCK_TEAMS = [
  makeTeam('The Arkaba XI', 'Setting', [
    makePlayer(0,'A. Hartley',   4,'Conservative','R',false,true, 5,'fast','opener'),
    makePlayer(1,'J. Blackwood', 4,'Conservative','L',false,true, 4,'fast','seamer'),
    makePlayer(2,'C. Rawlings',  3,'Conservative','R',false),
    makePlayer(3,'D. Forsyth',   4,'Balanced',    'R',true),
    makePlayer(4,'M. Stapleton', 3,'Aggressive',  'L',false),
    makePlayer(5,'T. Brennan',   3,'Aggressive',  'R',false,true, 3,'medium','none'),
    makePlayer(6,'S. Okafor',    2,'Ultra-Agg',   'R',false,true, 3,'fast','finisher'),
    makePlayer(7,'P. Holt',      2,'Ultra-Agg',   'L',false,true, 3,'fast','strike'),
    makePlayer(8,'R. Ingram',    1,'Slogger',     'R',false),
    makePlayer(9,'N. Moss',      1,'Slogger',     'L',false),
    makePlayer(10,'W. Cribb',    1,'Slogger',     'R',false),
  ]),
  makeTeam('The Austral XI', 'Chasing', [
    makePlayer(0,'M. Rashid',    5,'Aggressive',  'R',false,true, 3,'fast','opener'),
    makePlayer(1,'N. Connolly',  4,'Aggressive',  'L',false),
    makePlayer(2,'O. Baptiste',  4,'Aggressive',  'R',false),
    makePlayer(3,'P. Svensson',  5,'Balanced',    'R',true),
    makePlayer(4,'Q. Thornton',  4,'Ultra-Agg',   'L',false,true, 3,'medium','none'),
    makePlayer(5,'R. Ade',       3,'Ultra-Agg',   'R',false,true, 3,'spin','none'),
    makePlayer(6,'S. Vickers',   2,'Ultra-Agg',   'L',false,true, 3,'fast','finisher'),
    makePlayer(7,'T. Ogilvie',   2,'Slogger',     'R',false,true, 3,'fast','strike'),
    makePlayer(8,'U. Mwangi',    1,'Slogger',     'R',false),
    makePlayer(9,'V. Cross',     1,'Slogger',     'L',false),
    makePlayer(10,'W. Adesanya', 1,'Slogger',     'R',false),
  ]),
  makeTeam('Crown & Anchor CC', 'Balanced', [
    makePlayer(0,'X. Pemberley', 4,'Conservative','R',false,true, 5,'fast','swing'),
    makePlayer(1,'Y. Chakravarti',4,'Conservative','L',false,true,4,'fast','seamer'),
    makePlayer(2,'Z. Okonkwo',   3,'Conservative','R',false),
    makePlayer(3,'A. Mistry',    4,'Balanced',    'R',true),
    makePlayer(4,'B. Cavendish', 3,'Balanced',    'L',false,true, 4,'spin','none'),
    makePlayer(5,'C. Worthington',3,'Aggressive', 'R',false,true, 2,'medium','none'),
    makePlayer(6,'D. Osei',      2,'Ultra-Agg',   'L',false,true, 3,'fast','finisher'),
    makePlayer(7,'E. Halliday',  2,'Ultra-Agg',   'R',false),
    makePlayer(8,'F. Nzinga',    1,'Slogger',     'R',false),
    makePlayer(9,'G. Tattersall',1,'Slogger',     'L',false),
    makePlayer(10,'H. Quarshie', 1,'Slogger',     'R',false),
  ]),
  makeTeam('The Exeter Hotel', 'Setting', [
    makePlayer(0,'T. Alderton',  4,'Conservative','R',false,true, 4,'fast','opener'),
    makePlayer(1,'R. Gallagher', 4,'Conservative','L',false),
    makePlayer(2,'A. Pryce',     3,'Conservative','R',false),
    makePlayer(3,'S. Mensah',    4,'Balanced',    'R',true),
    makePlayer(4,'C. Holloway',  3,'Balanced',    'L',false,true, 3,'medium','none'),
    makePlayer(5,'D. Kowalski',  3,'Aggressive',  'R',false,true, 4,'spin','none'),
    makePlayer(6,'F. Turnbull',  2,'Ultra-Agg',   'L',false,true, 3,'fast','finisher'),
    makePlayer(7,'G. Okeke',     2,'Ultra-Agg',   'R',false,true, 4,'fast','none'),
    makePlayer(8,'H. Finch',     1,'Slogger',     'R',false),
    makePlayer(9,'I. Barlow',    1,'Slogger',     'L',false),
    makePlayer(10,'J. Quaye',    1,'Slogger',     'R',false),
  ]),
  makeTeam('The Forester CC', 'Balanced', [
    makePlayer(0,'J. Brennan',   4,'Conservative','R',false,true, 4,'fast','opener'),
    makePlayer(1,'K. Sharma',    4,'Conservative','L',false),
    makePlayer(2,'L. Doyle',     3,'Balanced',    'R',false),
    makePlayer(3,'M. Okafor',    4,'Balanced',    'R',true),
    makePlayer(4,'N. Price',     3,'Aggressive',  'L',false,true, 3,'spin','none'),
    makePlayer(5,'O. Walters',   3,'Aggressive',  'R',false,true, 4,'spin','none'),
    makePlayer(6,'P. Adeyemi',   2,'Ultra-Agg',   'L',false,true, 3,'fast','finisher'),
    makePlayer(7,'Q. Lawson',    2,'Ultra-Agg',   'R',false,true, 3,'fast','none'),
    makePlayer(8,'R. Tate',      1,'Slogger',     'R',false),
    makePlayer(9,'S. Bright',    1,'Slogger',     'L',false),
    makePlayer(10,'T. Webb',     1,'Slogger',     'R',false),
  ]),
  makeTeam('The Leicester CC', 'Setting', [
    makePlayer(0,'O. Patel',     4,'Conservative','R',false,true, 4,'spin','none'),
    makePlayer(1,'H. Devereux',  4,'Conservative','L',false),
    makePlayer(2,'F. Nkosi',     3,'Conservative','R',false),
    makePlayer(3,'B. Whitmore',  4,'Balanced',    'R',true),
    makePlayer(4,'G. Rennie',    3,'Aggressive',  'L',false,true, 4,'spin','none'),
    makePlayer(5,'I. Oduya',     3,'Aggressive',  'R',false,true, 3,'spin','none'),
    makePlayer(6,'K. Flynn',     2,'Ultra-Agg',   'L',false,true, 4,'fast','opener'),
    makePlayer(7,'L. Abara',     2,'Ultra-Agg',   'R',false,true, 3,'fast','finisher'),
    makePlayer(8,'E. Grimshaw',  1,'Slogger',     'R',false),
    makePlayer(9,'Q. Boateng',   1,'Slogger',     'L',false),
    makePlayer(10,'V. Lowe',     1,'Slogger',     'R',false),
  ]),
  makeTeam('The Plough XI', 'Balanced', [
    makePlayer(0,'U. Hennessy',  4,'Conservative','R',false,true, 5,'fast','seamer'),
    makePlayer(1,'V. Ramachandran',4,'Conservative','L',false),
    makePlayer(2,'W. Ashby',     3,'Conservative','R',false),
    makePlayer(3,'X. Johansson', 4,'Balanced',    'R',true),
    makePlayer(4,'Y. Obi',       3,'Balanced',    'L',false,true, 3,'medium','none'),
    makePlayer(5,'Z. McAllister',3,'Aggressive',  'R',false,true, 4,'spin','none'),
    makePlayer(6,'A. Dembele',   2,'Ultra-Agg',   'L',false,true, 3,'fast','finisher'),
    makePlayer(7,'B. Stafford',  2,'Ultra-Agg',   'R',false,true, 3,'fast','strike'),
    makePlayer(8,'C. Nash',      1,'Slogger',     'R',false),
    makePlayer(9,'D. Okoro',     1,'Slogger',     'L',false),
    makePlayer(10,'E. Hurst',    1,'Slogger',     'R',false),
  ]),
  makeTeam('The White Hart XI', 'Chasing', [
    makePlayer(0,'Q. Maddox',    5,'Aggressive',  'R',false,true, 4,'fast','opener'),
    makePlayer(1,'R. Nwosu',     4,'Aggressive',  'L',false),
    makePlayer(2,'S. Pemberton', 4,'Aggressive',  'R',false),
    makePlayer(3,'T. Adeola',    5,'Balanced',    'R',true),
    makePlayer(4,'U. Chesterton',4,'Ultra-Agg',   'L',false,true, 3,'medium','none'),
    makePlayer(5,'V. Driscoll',  3,'Ultra-Agg',   'R',false,true, 3,'spin','none'),
    makePlayer(6,'W. Asante',    2,'Ultra-Agg',   'L',false,true, 4,'fast','finisher'),
    makePlayer(7,'X. Harrington',2,'Slogger',     'R',false,true, 3,'fast','strike'),
    makePlayer(8,'Y. Mensah',    1,'Slogger',     'R',false),
    makePlayer(9,'Z. Whitfield', 1,'Slogger',     'L',false),
    makePlayer(10,'A. Mullen',   1,'Slogger',     'R',false),
  ]),
];

// -- Match History --
let matchHistory = [];
let historyScreenOpen = false;

function loadHistory(){
  try{ const s=localStorage.getItem('cricket_history'); if(s) matchHistory=JSON.parse(s); }catch(e){}
}
function saveHistory(){
  try{ localStorage.setItem('cricket_history', JSON.stringify(matchHistory)); }catch(e){}
}
function clearHistory(){
  matchHistory=[];
  saveHistory();
  render();
}
loadHistory();

function recordMatchResult(){
  if(st.innings!==2||st.team1Score===null||!st.done) return;
  // Avoid double-recording
  if(st._historyRecorded) return;
  st._historyRecorded=true;

  const t1=getMatchTeam(1), t2=getMatchTeam(2);
  const result=getMatchResult();
  const entry={
    date: new Date().toISOString(),
    team1: t1.name, team2: t2.name,
    pitch: st.pitchId, weather: st.weatherId,
    profile1: st.profileInnings1||'A', profile2: st.profileInnings2||'A',
    inn1runs: st.team1Score, inn1wkts: st.team1Wickets,
    inn2runs: st.runs, inn2wkts: st.wickets,
    result: result ? result.text : 'Unknown',
    resultCls: result ? result.cls : '',
  };
  matchHistory.unshift(entry);
  if(matchHistory.length>50) matchHistory=matchHistory.slice(0,50);
  saveHistory();
}
let customTeams = [];
let teamEditorOpen = false;
let teamEditorData = null;   // team being edited
let teamEditorIdx = null;    // index in customTeams, or null for new
let matchTeams = {t1:null, t2:null}; // teams chosen for current match
let dragSrc = null;
let bowlerScreenOpen = false;

function loadCustomTeams(){
  try{ const s=localStorage.getItem('cricket_teams'); if(s)customTeams=JSON.parse(s); }catch(e){}
}
function saveCustomTeams(){
  try{ localStorage.setItem('cricket_teams',JSON.stringify(customTeams)); }catch(e){}
}
loadCustomTeams();

// =======================================
// PROFILES
// =======================================
const DEFAULT_HOWZAT = [
  // *        [Minefield]              [Good]                [Flat]
  // Weather:  Sun  Ovc  Hot  Dmp      Sun  Ovc  Hot  Dmp    Sun  Ovc  Hot  Dmp
  [[14,16,16, 8],[ 8,10, 8, 6],[ 7, 8, 5, 8]],
  // **
  [[17,19,19,11],[11,13,11, 8],[10,11, 8,11]],
  // ***
  [[20,23,23,14],[14,17,14,11],[13,14,11,14]],
  // ****
  [[24,28,27,17],[17,21,17,14],[16,18,14,18]],
  // *****
  [[28,33,32,21],[21,25,21,17],[20,22,17,22]],
];
const DEFAULT_NOTOUT = [
  // *        [Minefield]              [Good]                [Flat]
  [[ 8, 7, 9,14],[12, 9,15,12],[22,16,24,18]],
  // **
  [[14,12,16,20],[20,16,23,20],[32,24,34,28]],
  // ***
  [[22,20,24,30],[30,26,33,30],[44,36,46,40]],
  // ****
  [[34,30,36,42],[42,38,45,40],[56,48,58,52]],
  // *****
  [[46,42,48,54],[54,50,57,52],[68,62,70,64]],
];
const DEFAULT_MODS = {
  dotBallPct:   3,    // % added to howzat per consecutive dot ball (max 2 dots = 6%)
  fastOverBonus:10,   // % bonus for fast bowler in fast overs (and spin in spin)
  wrongOverPen: 12,   // % penalty for bowling in wrong over type
  mediumPen:    15,   // % penalty for medium pace
  handAngle:    8,    // % bonus for bowling to opposite-hand batsman
  speciality:   10,   // % bonus for opener/finisher in their overs
  hotFastBonus: 8,    // % bonus for fast bowlers in hot weather
  defFatigueThresh: 3,// overs before defensive field fatigue kicks in
  defFatigueMod:12,   // % reduction in howzat per over of defensive fatigue
  attFatigueMod:15,   // % increase in howzat per over of attacking fatigue
};

function makeProfile(name, howzat, notout, mods){
  return {
    name,
    howzat: howzat.map(r=>r.map(p=>[...p])),
    notout: notout.map(r=>r.map(p=>[...p])),
    mods: {...mods},
  };
}

// v8: single profile -- A/B removed
let profiles = {
  A: makeProfile('Settings', DEFAULT_HOWZAT, DEFAULT_NOTOUT, DEFAULT_MODS),
};
let settingsOpen = false;

function migrateProfiles(){
  ['A'].forEach(k=>{
    const p=profiles[k];
    if(!p){profiles[k]=makeProfile('Settings',DEFAULT_HOWZAT,DEFAULT_NOTOUT,DEFAULT_MODS);return;}
    ['howzat','notout'].forEach(tbl=>{
      if(!p[tbl])return;
      p[tbl]=p[tbl].map((starRow,si)=>
        starRow.map((pitchRow,pi)=>{
          const def=tbl==='howzat'?DEFAULT_HOWZAT:DEFAULT_NOTOUT;
          while(pitchRow.length<4) pitchRow.push(def[si][pi][pitchRow.length]);
          return pitchRow;
        })
      );
    });
    Object.keys(DEFAULT_MODS).forEach(key=>{
      if(p.mods[key]===undefined) p.mods[key]=DEFAULT_MODS[key];
    });
  });
}
const DEFAULT_PROFILE_VERSION = '6';

function loadProfiles(){
  try{
    const saved=localStorage.getItem('cricket_profiles');
    const savedVersion=localStorage.getItem('cricket_profile_version');
    if(saved && savedVersion===DEFAULT_PROFILE_VERSION){
      profiles=JSON.parse(saved); migrateProfiles();
    } else {
      saveProfiles();
    }
  }catch(e){}
}
function saveProfiles(){
  try{
    localStorage.setItem('cricket_profiles', JSON.stringify(profiles));
    localStorage.setItem('cricket_profile_version', DEFAULT_PROFILE_VERSION);
  }catch(e){}
}
loadProfiles();

// Active profile for current innings (set at innings start)
// innings 1 uses profileInnings1, innings 2 uses profileInnings2
// Both default to 'A' until chosen

function getActiveProfile(){
  const key = st.innings===1 ? (st.profileInnings1||'A') : (st.profileInnings2||'A');
  return profiles[key];
}
function getHowzatPct(bowlerStars){ const pi=st.pitchIdx??1, wi=st.weatherIdx??0; return getActiveProfile().howzat[Math.max(0,Math.min(4,bowlerStars-1))][pi][wi]; }
function getNotOutPct(batStars){
  const _pi=st.pitchIdx??1, _wi=st.weatherIdx??0;
  let pct = getActiveProfile().notout[Math.max(0,Math.min(4,batStars-1))][_pi][_wi];
  if(_pi === 0) pct *= 1.5;   // minefield survival boost
  if(_wi === 1) pct *= 1.2; // overcast survival boost
  return pct;
}
function getMod(key){ return getActiveProfile().mods[key]; }

// Personality modifiers -- mild buffs/debuffs based on team's preferred role
function getBattingPersonalityMod(){
  // Returns howzat multiplier for the batting team this innings
  // Lower = harder to dismiss (buff), Higher = easier (debuff)
  const team = getMatchTeam(st.innings);
  const pers = team.personality || 'Balanced';
  const isBattingFirst = st.innings === 1;
  if(pers === 'Setting')  return isBattingFirst ? 0.92 : 1.08;
  if(pers === 'Chasing')  return isBattingFirst ? 1.08 : 0.92;
  return 1.0; // Balanced
}

function getBowlingPersonalityMod(){
  // Returns howzat multiplier for the bowling team this innings
  // Higher = more dangerous (buff), Lower = less effective (debuff)
  const team = getFieldingTeam();
  const pers = team.personality || 'Balanced';
  const isBowlingSecond = st.innings === 2;
  if(pers === 'Setting')  return isBowlingSecond ? 1.08 : 0.92;
  if(pers === 'Chasing')  return isBowlingSecond ? 0.92 : 1.08;
  return 1.0; // Balanced
}

function getPersonalityRunMod(){
  // Mild run scoring modifier for batting team -- Setting bats more freely in 1st innings
  const team = getMatchTeam(st.innings);
  const pers = team.personality || 'Balanced';
  const isBattingFirst = st.innings === 1;
  if(pers === 'Setting')  return isBattingFirst ? 1.05 : 0.95;
  if(pers === 'Chasing')  return isBattingFirst ? 0.95 : 1.05;
  return 1.0;
}

// =======================================
// HELPERS
// =======================================
function rnd(arr){return arr[Math.floor(Math.random()*arr.length)];}
function pct(n){return Math.random()<Math.max(0,Math.min(1,n/100));}
function starRating(n,max=5){return '*'.repeat(n)+'?'.repeat(max-n);}
function weightedRnd(arr){
  const total=arr.reduce((s,x)=>s+x.weight,0);
  let r=Math.random()*total;
  for(const x of arr){r-=x.weight;if(r<=0)return x;}
  return arr[arr.length-1];
}

// =======================================
// STATE
// =======================================
let st;

function initSetup(){
  st={
    phase:'select_teams',
    gameScreen:'bowling',
    mpPhase:null, // 'lobby'|'conditions'|'teams'|'toss'|'bat_bowl' // 'bowling'|'batting'|'commentary' -- sub-screen during play
    playerTeam:null,   // 'team1'|'team2' -- which team the human controls
    tossWinner:null,
    pitchId:'good',pitchIdx:1,
    weatherId:'sunny',weatherIdx:0,
    innings:1,
    team1Score:null,team1Wickets:null,
    runs:0,wickets:0,over:1,ball:0,
    batsmen:null,activeBat:[0,1],
    bowler:null,bowlerOvers:{},bowlStats:{}, // bowlStats: {id:{balls,runs,wkts}}
    field:'balanced',
    mentalities:{},     // {batIdx: mentality id} -- persists per batsman
    pendingWicket:false, // waiting for batting team to choose next batsman
    umpires:[{...UMPIRE_POOL[0]},{...UMPIRE_POOL[2]}], // overwritten at toss
    activeUmpIdx:0,
    reviewsLeft:2,bowlingReviewsLeft:2,
    pendingDismissal:null,
    batDie:null,bowlDie:null,
    log:[],done:false,matchOver:false,
    overBalls:[],mustChangeBowler:false,
    consecutiveZeros:0,dotBallBuff:0,
    wicketDecayBuff:0,        // notout survival boost after wicket, decays each ball
    bowlerConsecWkts:{},      // per-bowler consecutive wicket count for hat trick tracking
    lastWicketBowler:null,    // which bowler just took a wicket
    batConfidence:0,  // builds per ball faced with same field, resets on field change or new bat
    fieldStreak:{id:'balanced',count:0},
    momentum:0,       // builds on boundaries, decays on dots/singles, resets on new batsman
    cpuTeam: null,    // 't1'|'t2'|null -- which team the CPU controls
    ballsSinceBatArrived: 0, // tracks how long current batsman has been in
  };
}
initSetup();

function saveSession(){
  try{
    localStorage.setItem('cricket_st',JSON.stringify(st));
    localStorage.setItem('cricket_matchTeams',JSON.stringify(matchTeams));
  }catch(e){}
  // Push to Firebase if in multiplayer
  if(mp&&mp.active) mpPush();
}
function loadSession(){
  try{
    const s=localStorage.getItem('cricket_st');
    const m=localStorage.getItem('cricket_matchTeams');
    if(s&&s.length>2){
      const parsed=JSON.parse(s);
      if(parsed&&typeof parsed==='object') st=parsed;
    }
    if(m&&m.length>2){
      const parsed=JSON.parse(m);
      if(parsed&&typeof parsed==='object') matchTeams=parsed;
    }
    return !!s;
  }catch(e){
    // Corrupted localStorage -- clear it
    try{localStorage.removeItem('cricket_st');localStorage.removeItem('cricket_matchTeams');}catch(e2){}
    return false;
  }
}
// Clear localStorage if version mismatch -- prevents stale state crashes
const GAME_VERSION='v10mp3';
if(localStorage.getItem('cricket_version')!==GAME_VERSION){
  localStorage.removeItem('cricket_st');
  localStorage.removeItem('cricket_matchTeams');
  localStorage.setItem('cricket_version',GAME_VERSION);
}
loadSession();

function getMatchTeam(inningsNum){
  const key = inningsNum===1 ? 't1' : 't2';
  return matchTeams[key] || STOCK_TEAMS[2]; // default Westbrook if none set
}

// Returns the team currently batting (accounts for toss choice)
function getBattingTeam(){
  // In innings 1: if team1 chose to bowl, team2 bats
  const team1BatsFirst = st.pendingChoice !== 'bowl';
  if(st.innings===1) return team1BatsFirst ? getMatchTeam(1) : getMatchTeam(2);
  return team1BatsFirst ? getMatchTeam(2) : getMatchTeam(1);
}
function getFieldingTeamObj(){
  const team1BatsFirst = st.pendingChoice !== 'bowl';
  if(st.innings===1) return team1BatsFirst ? getMatchTeam(2) : getMatchTeam(1);
  return team1BatsFirst ? getMatchTeam(1) : getMatchTeam(2);
}

function freshBatsmen(){
  const team = getBattingTeam();
  return team.players.map((p,i)=>({
    id:i, name:p.name, style:p.style, hand:p.hand,
    stars:p.batStars, isWk:p.isWk||false,
    batSpecialism:p.batSpecialism||'none',
    position:i, // original position for lower order detection
    vs_fast: STYLES[p.style]?.vs_fast||1.0,
    vs_spin: STYLES[p.style]?.vs_spin||1.0,
    run_bias: STYLES[p.style]?.run_bias||[0,1,2,2,4,6],
    runs:0, balls:0, status:'waiting',
  }));
}

function getFieldingTeam(){
  return getFieldingTeamObj();
}

function getBowlersForInnings(){
  const team = getFieldingTeam();
  const bowlers = team.players.filter(p=>p.isBowler).map(p=>({
    id:'b'+p.id, name:p.name, type:p.bowlType, hand:p.hand,
    speciality:p.specialism, stars:p.bowlStars,
  }));
  const nonBowlers = team.players.filter(p=>!p.isBowler).map(p=>({
    id:'e'+p.id, name:p.name+'*', type:'medium', hand:p.hand,
    speciality:'none', stars:1, emergency:true,
  }));
  return [...bowlers, ...nonBowlers];
}

// =======================================
// LOOKUP
// =======================================
function getOverType(){return st.over<=5?'fast':'spin';}

// Per-star howzat cap -- better batsmen have a lower ceiling on dismissal chance
// Concentrates wickets in the tail where they belong
function getHowzatCap(batStars){
  switch(batStars){
    case 5: return 50;
    case 4: return 55;
    case 3: return 65;
    case 2: return 75;
    case 1: return 85;
    default:return 65;
  }
}

function getFieldFatigue(){
  const f=st.field, streak=st.fieldStreak.id===f?st.fieldStreak.count:0;
  const thresh=getMod('defFatigueThresh');
  const fo=Math.max(0,streak-thresh);
  const dm=getMod('defFatigueMod')/100, am=getMod('attFatigueMod')/100;
  if(f==='defensive')return{howzatMod:Math.max(.3,1-fo*dm),runMod:1+fo*dm,label:fo>0?'Def. fatigue':''  };
  if(f==='attacking')return{howzatMod:Math.max(0.7,1-fo*am),runMod:1,label:fo>0?`Field worn in`:''};
  return{howzatMod:1,runMod:1,label:''};
}
function getRunFaces(){
  const f=st.field,fat=getFieldFatigue(),w=st.weatherId;
  const bwl=st.bowler?getBowlersForInnings().find(b=>b.id===st.bowler):null;
  const isMedium=bwl&&bwl.type==='medium';

  // Damp: sluggish outfield, difficult grip -- mostly 0,1,2 with rare boundaries
  if(w==='damp'){
    if(f==='attacking')return[0,1,1,2,2,4];
    if(f==='defensive')return[0,0,1,1,1,2];
    return[0,0,1,1,2,4];
  }
  // Hot: ball bounces true, slightly easier to hit boundaries
  if(w==='hot'){
    if(f==='attacking')return[1,2,4,6,6,6];
    if(f==='defensive')return[0,0,1,2,2,4];
    return[0,1,2,4,6,6];
  }
  // Medium pace: harder to score boundaries regardless of field
  if(isMedium){
    if(f==='attacking')return[0,1,2,4,4,6];
    if(f==='defensive')return[0,0,0,1,1,2];
    return[0,0,1,1,2,4];
  }
  if(f==='attacking')return[1,2,4,6,6,6];
  if(f==='defensive'){
    if(fat.runMod>1.3)return[0,0,1,2,2,4];
    if(fat.runMod>1.15)return[0,0,0,1,2,4];
    return[0,0,0,1,1,4];
  }
  return[0,1,2,4,4,6];
}
function getBowlerStarsMod(bwl){
  const ot=getOverType(),bat=st.batsmen[st.activeBat[0]];
  let wm=1.0;
  const fb=getMod('fastOverBonus')/100, wp=getMod('wrongOverPen')/100;
  const ha=getMod('handAngle')/100;

  // Over type modifiers (fast/spin only)
  if(bwl.type==='fast'  &&ot==='fast') wm*=1+fb;
  if(bwl.type==='spin'  &&ot==='spin') wm*=1+fb;
  if(bwl.type==='fast'  &&ot==='spin') wm*=1-wp;
  if(bwl.type==='spin'  &&ot==='fast') wm*=1-wp;
  // Medium pace: no % modifier -- handled via effective star adjustments in getInherentBonus

  // Hand angle
  if(bwl.hand!==bat.hand) wm*=1+ha;

  const vm=bwl.type==='spin'?bat.vs_spin:bat.vs_fast;
  wm/=vm;
  return Math.min(1.5,wm);
}

// Returns +1 if bowler is in their specialist moment, 0 otherwise
function getSpecialistBonus(bwl){
  if(!bwl||!bwl.speciality||bwl.speciality==='none') return 0;
  switch(bwl.speciality){
    case 'opener':   return (st.over<=2)?1:0;
    case 'finisher': return (st.over>=9)?1:0;
    case 'strike':   return st.weatherId==='hot'?1:0;
    case 'swing':    return st.weatherId==='overcast'?1:0;
    case 'seamer':   return st.pitchId==='minefield'?1:0;
    case 'tailkiller': return isLowerOrder(st.batsmen[st.activeBat[0]])?1:0;
    default: return 0;
  }
}

// Inherent type bonuses -- star adjustments based on bowler type and conditions
function getInherentBonus(bwl){
  let bonus = 0;

  // Spinners naturally thrive on a crumbling minefield
  if(bwl.type==='spin' && st.pitchId==='minefield') bonus += 1;

  // Medium pace: context-dependent star adjustments
  if(bwl.type==='medium'){
    const isFinisher = bwl.speciality==='finisher';
    if(st.over<=3)                        bonus -= 1; // too easy to play early on
    if(st.over>=9 && !isFinisher)         bonus -= 1; // not threatening at death
    // (if isFinisher in overs 9-10, getSpecialistBonus gives +1 separately -- no death penalty)
    if(st.weatherId==='damp')             bonus += 1; // heavy ball swings nicely
  }

  return bonus;
}
function getStrikerMentality(){
  return st.mentalities[st.activeBat[0]] || 'positive';
}
function getNonStrikerMentality(){
  return st.mentalities[st.activeBat?.[1]] || 'positive';
}

// Last over run faces -- higher variance, more sixes and howzat risk
// Defensive: unchanged (protecting wicket)
// Rotation: slight push for boundaries
// Positive: meaningful swing for it
// Aggressive: boom or bust
const LAST_OVER_RUNS = {
  defensive: null, // use normal faces -- not swinging
  rotation:  {attacking:[0,1,2,4,4,6], balanced:[0,1,1,2,4,6], defensive:[0,0,1,2,4,4]},
  positive:  {attacking:[0,1,2,4,6,6], balanced:[0,1,2,4,4,6], defensive:[0,1,2,4,4,6]},
  aggressive:{attacking:[0,2,4,6,6,6], balanced:[0,2,4,4,6,6], defensive:[0,1,2,4,6,6]},
};
// Last over howzat multiplier -- aggressive goes big, others unchanged
const LAST_OVER_HZ_MULT = {
  defensive: 1.0,
  rotation:  1.0,
  positive:  1.15,
  aggressive:1.40,
};

// Run face tables -- calibrated v9 (Config R, 5,000 innings full-fidelity validated)
// Targets: def field 50-70, bal field 60-80, att field 45-90 boom/bust, wkts 8-10 att / 4-6 bal / 2-4 def
const MENTALITY_RUNS = {
  defensive: {
    attacking: [0,0,1,2,2,4],
    balanced:  [0,0,1,1,2,4],
    defensive: [0,0,1,1,2,2],
  },
  rotation: {
    attacking: [0,0,1,2,4,4],
    balanced:  [0,0,1,2,2,4],
    defensive: [0,0,1,1,2,4],
  },
  positive: {
    attacking: [0,1,2,2,4,6],
    balanced:  [0,1,1,2,2,4],
    defensive: [0,0,1,2,2,4],
  },
  aggressive: {
    attacking: [0,1,2,4,6,6],
    balanced:  [0,1,2,4,4,4],
    defensive: [0,0,1,1,2,4],
  },
};
// Tail (1-star batsmen) always use these regardless of mentality
const TAIL_RUNS = {
  attacking: [0,1,2,4,6,6],
  balanced:  [0,1,2,4,4,6],
  defensive: [0,0,1,2,4,4],
};

// Momentum system constants
const MOMENTUM_CAP = 10;
const MENTALITY_MOMENTUM = {
  defensive:  { boundaryGain: 0.3, dotDecay: 1.5, runDecay: 1.0, howzatPerPoint: 0.5  },
  rotation:   { boundaryGain: 0.6, dotDecay: 1.0, runDecay: 0.5, howzatPerPoint: 1.0  },
  positive:   { boundaryGain: 1.0, dotDecay: 0.8, runDecay: 0.3, howzatPerPoint: 1.5  },
  aggressive: { boundaryGain: 1.3, dotDecay: 1.0, runDecay: 0.4, howzatPerPoint: 2.5  },
};

// Mentality run faces
function getMentalityRunFaces(mentality, field){
  const bat = st.batsmen[st.activeBat[0]];
  // Tail always uses TAIL_RUNS -- their doom is their 1-star howzat, not mentality
  if(bat.stars===1){
    return TAIL_RUNS[field] || TAIL_RUNS.balanced;
  }
  // Last over -- use elevated faces if available for this mentality
  if(st.over>=10 && LAST_OVER_RUNS[mentality]){
    const lastTable = LAST_OVER_RUNS[mentality];
    return lastTable[field] || lastTable.balanced;
  }
  const table = MENTALITY_RUNS[mentality];
  if(!table) return getRunFaces();
  return table[field] || table.balanced;
}

// Mentality howzat modifier -- v8 calibrated Rock/Paper/Scissors architecture
// Mentality controls dismissal risk, field controls wicket pressure independently
// v9 calibrated: mentality?field hz lookup table
// Replaces blind multiplication -- each combination tuned independently
// Validated against 5,000-innings full-fidelity sim (config R)
const MENTALITY_FIELD_HZ = {
  defensive:  {attacking:1.30, balanced:0.72, defensive:0.58},
  rotation:   {attacking:1.40, balanced:0.86, defensive:0.68},
  positive:   {attacking:1.50, balanced:1.00, defensive:0.80},
  aggressive: {attacking:1.45, balanced:1.18, defensive:0.92},
};
function getMentalityHowzatMod(mentality){
  const base = (MENTALITY_FIELD_HZ[mentality]?.[st.field]) ?? 1.0;
  // Last over -- aggressive/positive batsmen take more risks
  if(st.over>=10){
    return base * (LAST_OVER_HZ_MULT[mentality] ?? 1.0);
  }
  return base;
}

// Bat specialism howzat modifier for striker
function getBatSpecialismMod(bat, bwl, over){
  switch(bat.batSpecialism){
    case 'vs_fast': return bwl.type==='fast'?0.80:1.0;
    case 'vs_spin': return bwl.type==='spin'?0.80:1.0;
    case 'big_hitter': return 1.10; // slightly easier to dismiss but hits harder
    case 'closer': return (over>=8)?0.82:1.0;
    case 'rotation': return 0.90; // hard to dismiss, plays sensibly
    case 'lower_order': return 1.0; // buff is in strike protection, not howzat
    default: return 1.0;
  }
}

// Is striker a lower order batsman (position 6+)?
function isLowerOrder(bat){ return bat.position>=6; }
function isStrikeRotator(bat){ return bat.batSpecialism==='rotation'; }

// Strike rotation: does the striker protect the tail?
// If striker has rotation specialism and non-striker is lower order,
// attempt to score odd runs on last ball or even runs generally
function shouldAttemptRotation(){
  const striker=st.batsmen[st.activeBat?.[0]];
  const nonStriker=st.batsmen[st.activeBat?.[1]];
  if(!striker||!nonStriker) return false;
  return isStrikeRotator(striker) && isLowerOrder(nonStriker);
}
function getDotBallBuff(){return st.dotBallBuff;}
function getDotBallPct(){return getMod('dotBallPct');}

// Batsman confidence: builds per ball faced with same field setting
// +1 per ball, capped at 20. Resets on field change or new batsman.
// Effect: run face bias shifts up, not-out chance increases
function getConfidenceRunBonus(){
  // Every 6 confidence points shift runs slightly (was every 4 -- reduced to limit inflation)
  return Math.floor(st.batConfidence/6);
}
function getConfidenceNotOutBonus(){
  // +1% not-out per 2 confidence points, max +8%
  return Math.min(8, Math.floor(st.batConfidence/2));
}
function getFieldNotOutBonus(){return st.fieldStreak.id===st.field?st.fieldStreak.count:0;}
function getUmpireOut(ump){return Math.random()<ump.strength/6;}
// v9: defensive notout bonus is field-aware
// Attacking field = no survival bonus (can't play defensively when fielders are up)
// Balanced field = partial bonus
// Defensive field = full bonus (set field rewards patient play)
const DEF_NOTOUT_BY_FIELD = {attacking:1.00, balanced:1.25, defensive:1.50};
function getWicketDecayBonus(){ return st.wicketDecayBuff||0; }

function rollNotOut(bat){
  let notOutPct = getNotOutPct(bat.stars)+getFieldNotOutBonus()+getConfidenceNotOutBonus()+getWicketDecayBonus();
  if(getStrikerMentality()==='defensive'){
    notOutPct *= (DEF_NOTOUT_BY_FIELD[st.field] ?? 1.25);
  }
  return pct(Math.min(95, notOutPct));
}
// Flavour text for not-out decisions by dismissal type
// Returns {referral, verdict} for Caught (two-step), or {referral} for others
function getNotOutFlavour(dtype, umpName, thirdUmpName){
  switch(dtype){
    case 'Caught':{
      const referrals=[
        `Did the fielder take it cleanly? ${umpName} has sent it upstairs!`,
        `Did it carry? ${umpName} is unsure -- it's going to the third umpire!`,
        `${umpName} can't be sure -- did the ball bounce before the fielder gathered? Upstairs!`,
        `${umpName} hesitates -- did the fielder get their fingers under it in time? It's referred!`,
        `DROPPED! ${umpName} signals not out -- a costly spill`,
      ];
      const verdicts=[
        `${thirdUmpName}: Not out -- the ball grounded just before the fielder`,
        `${thirdUmpName}: Not out -- it fell just short`,
        `${thirdUmpName}: Not out -- the replays show it bounced`,
        `${thirdUmpName}: Not out -- the ball touched the turf`,
      ];
      return {
        referral: referrals[Math.floor(Math.random()*referrals.length)],
        verdict:  verdicts[Math.floor(Math.random()*verdicts.length)],
      };
    }
    case 'Caught Behind':
      return {referral: [
        `${umpName} shakes their head -- was there an edge?`,
        `${umpName}: Not out. Did the ball brush the pad rather than the bat?`,
        `${umpName} turns it down -- was there anything on it?`,
        `${umpName}: Not out. Did it clip the arm on the way through?`,
      ][Math.floor(Math.random()*4)]};
    case 'LBW':
      return {referral: [
        `${umpName}: Not out -- did it pitch outside leg?`,
        `${umpName}: Not out -- was it going over the stumps?`,
        `${umpName}: Not out -- did it strike outside the line of off stump?`,
        `${umpName}: Not out -- did bat hit ball first?`,
        `${umpName}: Not out -- was the impact just outside off?`,
      ][Math.floor(Math.random()*5)]};
    default:
      return {referral:`${umpName}: Not out`};
  }
}
function getDismissalFlavour(batRuns){
  if(batRuns>=50) return 'Walk off head held high';
  if(batRuns>=30) return 'March back to the changing room';
  if(batRuns>=15) return 'Walk back to the rooms';
  return 'Trudge back to the shed';
}

// =======================================
// GAME LOGIC
// =======================================
function rollBat(){
  if(st.done||st.matchOver)return;
  if(!st.bowler){addLog('Select a bowler first','over');render();return;}
  if(st.pendingDismissal){addLog('Resolve pending decision first','over');render();return;}
  if(st.mustChangeBowler){addLog('Must change bowler!','over');render();return;}
  if(st.pendingWicket){addLog('Choose next batsman first','over');render();return;}

  // CPU makes decisions before each ball
  applyCpuBowlerIfNeeded();
  applyCpuFieldIfNeeded();
  applyCpuMentalityIfNeeded();

  const bwl=getBowlersForInnings().find(b=>b.id===st.bowler);
  if(!bwl){addLog('Select a bowler first','over');render();return;}
  if(!st.activeBat||st.activeBat.length<1){addLog('Innings over','over');render();return;}
  const bat=st.batsmen[st.activeBat[0]];
  if(!bat){addLog('No batsman -- innings over','over');render();return;}
  const fat=getFieldFatigue();
  const mentality=getStrikerMentality();
  const over=st.over;

  const specialistBonus=getSpecialistBonus(bwl);
  const inherentBonus=getInherentBonus(bwl);
  const effectiveStars=Math.min(5,bwl.stars+specialistBonus+inherentBonus);
  if(specialistBonus>0&&st.ball===0){
    const msgs={
      opener:`${bwl.name} is in his element -- early doors`,
      finisher:`${bwl.name} thrives at the death`,
      strike:`${bwl.name} loves the hard, bouncy track`,
      swing:`${bwl.name} will be dangerous in these conditions`,
      seamer:`This pitch was made for ${bwl.name}`,
      tailkiller:`${bwl.name} is lethal against the lower order`,
    };
    addLog(msgs[bwl.speciality]||`${bwl.name} in their element`,'over');
  }
  if(inherentBonus>0&&st.ball===0){
    if(bwl.type==='spin'&&st.pitchId==='minefield'&&st.over===6)
      addLog(`The rough is turning square -- ${bwl.name} will be dangerous`,'over');
    if(bwl.type==='medium'&&st.weatherId==='damp')
      addLog(`${bwl.name} is getting the ball to swing in the damp`,'over');
  }

  let howzatChance=getHowzatPct(effectiveStars)*getBowlerStarsMod(bwl)*fat.howzatMod;
  howzatChance*=getMentalityHowzatMod(mentality);
  howzatChance*=getBatSpecialismMod(bat,bwl,over);
  howzatChance*=getBattingPersonalityMod();
  howzatChance*=getBowlingPersonalityMod();
  howzatChance+=getDotBallBuff();
  const _mm=MENTALITY_MOMENTUM[mentality]||MENTALITY_MOMENTUM.positive;
  howzatChance+=(st.momentum * _mm.howzatPerPoint); // momentum risk scales with mentality
  howzatChance=Math.min(getHowzatCap(bat.stars),Math.max(2,howzatChance));

  if(!st.bowlStats[bwl.id]) st.bowlStats[bwl.id]={balls:0,runs:0,wkts:0};
  st.bowlStats[bwl.id].balls++;

  if(pct(howzatChance)){
    if(mentality==='rotation'&&Math.random()<0.08){
      addLog(`${bat.name} -- RUN OUT attempting a quick single!`,'howzat');
      st.momentum=0; // dismissal resets momentum
      triggerHowzat(bwl,bat,true);
    } else {
      // Survived howzat -- momentum decays (treated like dot)
      const mm=MENTALITY_MOMENTUM[mentality]||MENTALITY_MOMENTUM.positive;
      st.momentum=Math.max(0, st.momentum - mm.dotDecay);
      // Survived -- reset bowler's consecutive wicket count
      if(st.bowler&&st.bowlerConsecWkts&&st.bowlerConsecWkts[st.bowler]){
        st.bowlerConsecWkts[st.bowler]=0;
      }
      triggerHowzat(bwl,bat,false);
    }
    return;
  }

  const runFaces=getMentalityRunFaces(mentality,st.field);
  let face=rnd(runFaces);

  // Strike rotation: last ball of over, protect tail
  if(shouldAttemptRotation()&&st.ball===5){
    if(st.field==='defensive'){
      face=Math.random()<0.4?1:0;
      if(face===0) addLog(`${bat.name} can't rotate -- field cuts off the single`,'');
    } else {
      face=1;
      addLog(`${bat.name} rotates the strike -- tail protected`,'');
    }
  }

  st.batDie=String(face);st.bowlDie=null;

  if(face===0){
    st.consecutiveZeros++;
    st.dotBallBuff=Math.min(2,st.consecutiveZeros)*getDotBallPct();
    // Dot ball is still a non-wicket -- reset bowler's consecutive count
    if(st.bowler&&st.bowlerConsecWkts&&st.bowlerConsecWkts[st.bowler]){
      st.bowlerConsecWkts[st.bowler]=0;
    }
    const mm=MENTALITY_MOMENTUM[mentality]||MENTALITY_MOMENTUM.positive;
    st.momentum=Math.max(0, st.momentum - mm.dotDecay);
    addLog(`${bat.name}: dot ball`,'');
    advanceBall('done');
  } else {
    st.consecutiveZeros=0;st.dotBallBuff=0;st.batConfidence=0;
    // Non-wicket ball -- reset this bowler's consecutive wicket count
    if(st.bowler&&st.bowlerConsecWkts&&st.bowlerConsecWkts[st.bowler]){
      st.bowlerConsecWkts[st.bowler]=0;
    }
    let runs=Math.max(0,Math.round(face*fat.runMod*getPersonalityRunMod()));
    const vm=bwl.type==='spin'?bat.vs_spin:bat.vs_fast;
    runs=Math.min(6,Math.round(runs*Math.min(1.3,vm)));
    if(bat.batSpecialism==='big_hitter'&&runs>=4&&Math.random()<0.3) runs=Math.min(6,runs+2);
    const confBonus=getConfidenceRunBonus();
    if(confBonus>0&&runs>0) runs=Math.min(6,runs+Math.floor(confBonus/3));
    st.runs+=runs;bat.runs+=runs;bat.balls++;
    st.bowlStats[bwl.id].runs+=runs;
    // Milestone check -- stored, logged AFTER the run entry so it appears above it
    let _milestone=null;
    if(bat.runs>=100 && bat.runs-runs<100) _milestone=`${bat.name} raises the bat -- ONE HUNDRED! The crowd rise as one.`;
    else if(bat.runs>=50 && bat.runs-runs<50) _milestone=`${bat.name} raises the bat -- fifty up!`;
    // Update momentum based on runs scored
    const mm=MENTALITY_MOMENTUM[mentality]||MENTALITY_MOMENTUM.positive;
    if(runs>=6)      st.momentum=Math.min(MOMENTUM_CAP, st.momentum + (3*mm.boundaryGain));
    else if(runs>=4) st.momentum=Math.min(MOMENTUM_CAP, st.momentum + (2*mm.boundaryGain));
    else             st.momentum=Math.max(0, st.momentum - mm.runDecay);
    let cls='',msg=`${bat.name}: ${runs} run${runs!==1?'s':''}`;
    if(runs>=6){msg=`${bat.name}: SIX!`;cls='boundary';}
    else if(runs>=4){msg=`${bat.name}: FOUR!`;cls='boundary';}
    addLog(msg,cls);
    if(_milestone) addLog(_milestone,'boundary');
    // Odd runs on balls 1-5 swap the striker mid-over
    // Odd runs on ball 6 also swap but end-of-over swap brings them back (net: no change)
    const isLastBall = st.ball===5;
    if(runs%2===1 && !isLastBall){
      if(st.activeBat?.length>=2)st.activeBat=[st.activeBat[1],st.activeBat[0]];
    }
    advanceBall(runs>=4?'boundary':'done');
  }
  checkChase();render();
}


function triggerHowzat(bwl,bat,forceRunOut=false){
  // Dismissal type weights based on real T20 statistics
  // Caught Behind has DRS capability, Caught (fielder) does not
  // Stumped only possible off spin
  let types;
  if(bwl.type==='spin'){
    types=[
      {d:'Caught',         w:35, noDrs:true  },
      {d:'Caught Behind',  w:20, noDrs:false },
      {d:'LBW',            w:18, noDrs:false },
      {d:'Bowled',         w:12, noDrs:true  },
      {d:'Stumped',        w:10, noDrs:false },
      {d:'Run Out',        w:5,  noDrs:true  },
    ];
  } else if(bwl.type==='fast'){
    types=[
      {d:'Caught',         w:38, noDrs:true  },
      {d:'Caught Behind',  w:18, noDrs:false },
      {d:'Bowled',         w:25, noDrs:true  },
      {d:'LBW',            w:14, noDrs:false },
      {d:'Run Out',        w:5,  noDrs:true  },
    ];
  } else { // medium
    types=[
      {d:'Caught',         w:40, noDrs:true  },
      {d:'Caught Behind',  w:18, noDrs:false },
      {d:'Bowled',         w:20, noDrs:true  },
      {d:'LBW',            w:15, noDrs:false },
      {d:'Run Out',        w:7,  noDrs:true  },
    ];
  }

  // Weighted pick
  const total=types.reduce((s,x)=>s+x.w,0);
  let r=Math.random()*total;
  let chosen=types[0];
  for(const t of types){r-=t.w;if(r<=0){chosen=t;break;}}
  const dtype=chosen.d;
  const drsAllowed=!chosen.noDrs;

  const ump=st.umpires[st.activeUmpIdx];
  const isOut=getUmpireOut(ump);
  st.bowlDie=dtype;

  if(dtype==='Bowled'){
    st.pendingDismissal={bwl,dtype,ump,umpIdx:st.activeUmpIdx,givenOut:true,noDrs:true,thirdUmp:st.umpires[st.activeUmpIdx===0?1:0]};
    addLog(`${bat.name} -- BOWLED! Stumps shattered`,'howzat');
    advanceBall('wkt');
  } else if(dtype==='Run Out'||dtype==='Stumped'){
    // Auto-referred to third umpire -- resolves immediately
    const reviewIdx=st.activeUmpIdx===0?1:0;
    const thirdUmp=st.umpires[reviewIdx];
    const thirdOut=getUmpireOut(thirdUmp);
    addLog(`${dtype}! Referred straight to third umpire (${thirdUmp.name})...`,'howzat');
    advanceBall(thirdOut?'wkt':'done');
    if(thirdOut){
      addLog(`Third umpire: OUT -- ${dtype}!`,'wkt');
      dismissBatsman(dtype,'');
    } else {
      addLog(`Third umpire: NOT OUT -- ${bat.name} survives`,'review');
    }
    checkChase();render();return;
  } else if(isOut){
    const lbwReviewable=dtype==='LBW';
    st.pendingDismissal={bwl,dtype,ump,umpIdx:st.activeUmpIdx,givenOut:true,noDrs:!drsAllowed,lbwReviewable,thirdUmp:st.umpires[st.activeUmpIdx===0?1:0]};
    let dismissalMsg=`Howzat! ${ump.name} raises the finger -- ${dtype}!`;
    if(dtype==='Caught Behind'){
      const team=getMatchTeam(st.innings);
      const keeper=team.players.find(p=>p.isWk);
      if(keeper) dismissalMsg=`Howzat! ${ump.name} raises the finger -- Caught behind by ${keeper.name}+!`;
    }
    addLog(dismissalMsg,'howzat');
    advanceBall('wkt');
    // CPU batting DRS fires after render (see end of function)
  } else {
    // Not out -- bowling team may DRS if dismissal type allows it
    const thirdUmp=st.umpires[st.activeUmpIdx===0?1:0];
    const flavour=getNotOutFlavour(dtype,ump.name,thirdUmp.name);
    st.pendingDismissal={bwl,dtype,ump,umpIdx:st.activeUmpIdx,givenOut:false,noDrs:!drsAllowed,
      notOutMsg:flavour.referral, verdictMsg:flavour.verdict, thirdUmp};
    addLog(`${flavour.referral}`,'howzat');
    advanceBall('done');
  }
  render();
  // CPU auto-DRS -- fires after render so UI is settled
  if(st.pendingDismissal) applyCpuDrsIfNeeded();
}

// Single dismissal handler -- all paths go through here to avoid count drift
function dismissBatsman(dtype, logPrefix){
  const bat=st.batsmen[st.activeBat[0]];
  bat.status='out';
  st.wickets++;
  st.momentum=0;
  // Credit wicket to current bowler + hat trick tracking
  if(st.bowler){
    if(!st.bowlStats[st.bowler]) st.bowlStats[st.bowler]={balls:0,runs:0,wkts:0};
    st.bowlStats[st.bowler].wkts++;
    const bwlWkts = st.bowlStats[st.bowler].wkts;
    // Consecutive wicket tracking per bowler
    if(!st.bowlerConsecWkts) st.bowlerConsecWkts={};
    if(st.lastWicketBowler===st.bowler && st.lastWicketBowler!==null){
      st.bowlerConsecWkts[st.bowler]=(st.bowlerConsecWkts[st.bowler]||1)+1;
    } else {
      // Different bowler -- reset others, start this one
      st.bowlerConsecWkts={};
      st.bowlerConsecWkts[st.bowler]=1;
    }
    st.lastWicketBowler=st.bowler;
    const consec=st.bowlerConsecWkts[st.bowler]||1;
    const bwlName=getBowlersForInnings().find(b=>b.id===st.bowler)?.name||'Bowler';
    // Hat trick milestones
    if(consec===3) addLog(`[hat] HAT TRICK! ${bwlName} -- three in a row!`,'boundary');
    else if(consec===4) addLog(`[hat][hat] DOUBLE HAT TRICK! ${bwlName} -- four in a row!`,'boundary');
    else if(consec>=5){
      const names=['','','','','Triple','Quadruple','Quintuple','Sextuple'];
      const n=names[consec]||`${consec}-wicket`;
      addLog(`[hat] ${n.toUpperCase()} HAT TRICK! ${bwlName} -- ${consec} in a row!`,'boundary');
    }
    // 5-wicket milestone
    if(bwlWkts===5) addLog(`${bwlName} holds the ball aloft -- five wickets!`,'boundary');
  }
  // Set wicket survival decay buff for incoming batsman
  st.wicketDecayBuff=8;
  addLog(`${logPrefix}${bat.name} -- ${dtype}! Wicket #${st.wickets}`,'wkt');
  checkMilestones(bat);
  st.pendingDismissal=null;
  nextBatsman();
}

function checkMilestones(bat){
  // Called after runs are scored or wicket taken -- check batsman 50/100
}

function acceptDismissal(){
  if(!st.pendingDismissal||!st.pendingDismissal.givenOut)return;
  dismissBatsman(st.pendingDismissal.dtype,'');
  checkChase();render();
}

function dismissNotOut(){
  if(!st.pendingDismissal||st.pendingDismissal.givenOut)return;
  addLog('Not out stands','over');
  st.pendingDismissal=null;
  checkChase();render();
}

function callReview(){
  if(!st.pendingDismissal)return;
  const d=st.pendingDismissal;
  const reviewUmp=d.thirdUmp;

  if(d.givenOut){
    if(st.reviewsLeft<=0)return;
    const thirdOut=getUmpireOut(reviewUmp);
    if(thirdOut){
      addLog(`Third umpire (${reviewUmp.name}): OUT upheld`,'wkt');
      st.reviewsLeft--;
      dismissBatsman(d.dtype,'');
    } else {
      addLog(`Third umpire (${reviewUmp.name}): NOT OUT -- overturned`,'review');
      st.pendingDismissal=null;
    }
  } else {
    if(st.bowlingReviewsLeft<=0)return;
    const thirdOut=getUmpireOut(reviewUmp);
    if(thirdOut){
      addLog(`Third umpire (${reviewUmp.name}): OUT -- reversed!`,'wkt');
      dismissBatsman(d.dtype,'');
    } else {
      addLog(`Third umpire (${reviewUmp.name}): NOT OUT confirmed -- review lost`,'review');
      st.bowlingReviewsLeft--;
      st.pendingDismissal=null;
    }
  }
  checkChase();render();
}

function checkChase(){
  if(st.innings!==2||st.team1Score===null)return;
  if(st.runs>st.team1Score){st.done=true;addLog(`Team 2 win! ${st.runs}/${st.wickets} -- target beaten`,'boundary');}
}

function nextBatsman(){
  if(st.wickets>=10){st.done=true;if(st.innings===1&&!st._t1log)st._t1log=[...st.log];addLog('All out!','wkt');return;}
  const waiting=st.batsmen.filter(b=>b.status==='waiting');
  if(!waiting.length){st.done=true;if(st.innings===1&&!st._t1log)st._t1log=[...st.log];addLog('All out!','wkt');return;}
  st.pendingWicket=true; // batting team must choose next batsman
}

function sendNextBatsman(){
  // Send in whoever is next in the list
  const next=st.batsmen.findIndex(b=>b.status==='waiting');
  if(next===-1){st.done=true;st.pendingWicket=false;render();return;}
  sendBatsman(next);
}

function sendBatsman(idx){
  if(!st.pendingWicket&&!isCpuBatting()) return; // guard double-send
  if(st.batsmen[idx].status!=='waiting') return;
  st.batsmen[idx].status='in';
  st.activeBat[0]=idx;
  st.consecutiveZeros=0;st.dotBallBuff=0;st.batConfidence=0;st.momentum=0;st.ballsSinceBatArrived=0;st.wicketDecayBuff=0;st.bowlerConsecWkts={};st.lastWicketBowler=null;
  st.pendingWicket=false;
  // Preserve non-striker's mentality, reset new batsman to positive
  if(!st.mentalities[idx]) st.mentalities[idx]='positive';
  addLog(`${st.batsmen[idx].name} comes to the crease`,'over');
  render();
}

function advanceBall(pipType){
  st.overBalls.push({type:pipType});
  st.ballsSinceBatArrived++;
  // Decay wicket survival boost each ball: 8->4->2->1->0
  if(st.wicketDecayBuff>=8)      st.wicketDecayBuff=4;
  else if(st.wicketDecayBuff>=4) st.wicketDecayBuff=2;
  else if(st.wicketDecayBuff>=2) st.wicketDecayBuff=1;
  else                           st.wicketDecayBuff=0;
  if(st.fieldStreak.id===st.field){st.fieldStreak.count++;}
  else{st.fieldStreak={id:st.field,count:1}; st.batConfidence=0;} // field changed -- reset confidence
  // Build batsman confidence per ball faced with same field
  st.batConfidence=Math.min(20,st.batConfidence+1);
  st.ball++;
  if(st.ball>=6){
    st.ball=0;
    if(st.bowler)st.bowlerOvers[st.bowler]=(st.bowlerOvers[st.bowler]||0)+1;
    st.over++;st.overBalls=[];st.mustChangeBowler=true;
    const outgoingUmp=st.umpires[st.activeUmpIdx].name;
    st.activeUmpIdx=st.activeUmpIdx===0?1:0;
    if(st.activeBat?.length>=2)st.activeBat=[st.activeBat[1],st.activeBat[0]];
    if(st.over>10){st.done=true;if(st.innings===1&&!st._t1log)st._t1log=[...st.log];addLog('10 overs -- innings over!','over');return;}
    const fat=getFieldFatigue();
    addLog(`-- Over ${st.over-1} end | ${st.runs}/${st.wickets}${fat.label?' | '+fat.label:''} --`,'over');
    addLog(`${outgoingUmp} moves to square leg`,'over');
  }
}

function selectBowler(id){
  if(st.done||st.matchOver)return;
  if(!st.mustChangeBowler&&st.bowler&&st.ball>0)return;
  if(id===st.bowler&&st.ball===0)return;
  if((st.bowlerOvers[id]||0)>=2){addLog('Bowler has used both overs','over');render();return;}
  st.bowler=id;st.mustChangeBowler=false;
  const _bwlName=getBowlersForInnings().find(b=>b.id===id)?.name||id;
  addLog(`${_bwlName} to bowl over ${st.over}`,'over');
  render();
}

function selectField(id){
  if(!st.done&&!st.matchOver&&!st.pendingDismissal){
    if(st.field!==id){
      const icons={attacking:'[x]',balanced:'[=]',defensive:'[o]'};
      addLog(`Field: ${icons[st.field]||st.field} -> ${icons[id]||id} ${id}`,'over');
    }
    st.field=id;render();
  }
}

// =======================================
// CPU LOGIC
// =======================================

function isCpuBowling(){
  // CPU controls the fielding team this innings?
  const team1BatsFirst = st.pendingChoice !== 'bowl';
  const fieldingSlot = (st.innings===1) === team1BatsFirst ? 't2' : 't1';
  return st.cpuTeam === fieldingSlot;
}

function isCpuBatting(){
  const team1BatsFirst = st.pendingChoice !== 'bowl';
  const battingSlot = (st.innings===1) === team1BatsFirst ? 't1' : 't2';
  return st.cpuTeam === battingSlot;
}

function cpuSelectField(){
  // Returns 'attacking'|'balanced'|'defensive'
  const bat = st.batsmen[st.activeBat[0]];
  const batStar = bat ? bat.stars : 3;
  const ballsFaced = st.ballsSinceBatArrived;
  const runsAhead = st.innings===2 ? (st.team1Score - st.runs) : 0;
  const runsNeeded = st.innings===2 ? (st.team1Score + 1 - st.runs) : 0;
  const ballsLeft = (10 - st.over) * 6 + (6 - st.ball);
  const nearWin = st.innings===2 && runsNeeded <= 15; // batting team close to winning

  // 1* batsman special rules (checked first)
  if(batStar === 1){
    if(nearWin) return 'defensive'; // protect the lead, make them earn it
    if(runsAhead >= 30) return 'attacking'; // kill them off
  }

  // New batsman (0-7 balls faced) -> attacking, they're nervous
  if(ballsFaced <= 7) return 'attacking';

  // Boundary just scored -> back to defensive (batsman released pressure)
  // (handled via consecutiveZeros reset -- if zeros=0 and we just had a boundary,
  //  that means runs scored; we use momentum as a proxy -- high momentum = batsman hot)
  if(st.momentum >= 5) return 'defensive'; // batsman in form, tighten up

  // 2+ consecutive dots built up -> cash in with attacking
  if(st.consecutiveZeros >= 2) return 'attacking';

  // Batsman settled (8+ balls) -> defensive to build pressure
  if(ballsFaced >= 8) return 'defensive';

  return 'balanced'; // fallback
}

function cpuSelectMentality(batIdx){
  // Returns mentality string for the batting CPU
  const bat = st.batsmen[batIdx];
  if(!bat) return 'positive';

  // 1* tail -- always positive (their stars are their doom anyway)
  if(bat.stars === 1) return 'positive';

  // Last 2 wickets -- cap at positive
  const wktsLeft = 10 - st.wickets;
  if(wktsLeft <= 2) return 'positive';

  if(st.innings === 2){
    // Chasing -- use required rate to decide
    const runsNeeded = st.team1Score + 1 - st.runs;
    const ballsLeft = (10 - st.over) * 6 + (6 - st.ball);
    const rrRequired = ballsLeft > 0 ? (runsNeeded / ballsLeft) * 6 : 99;

    if(rrRequired > 12) return 'aggressive';
    if(rrRequired > 9)  return 'positive';
    if(rrRequired > 6)  return 'rotation';
    return 'defensive'; // comfortable -- just bat time
  } else {
    // Setting -- build a total, be sensibly positive
    const over = st.over;
    if(over <= 4) return 'rotation';   // early doors -- build a base
    if(over <= 7) return 'positive';   // middle overs -- push on
    return 'aggressive';               // slog it out in the death
  }
}

// CPU DRS decision -- called when a dismissal is pending
// CPU reviews based on umpire quality: weak umpire = likely to review, strong = rare
function cpuShouldReview(){
  const d = st.pendingDismissal;
  if(!d || d.noDrs) return false;
  const ump = st.umpires[d.umpIdx];
  if(!ump) return false;
  // Umpire strength: 'Weak'=1, 'Fair'=2, 'Good'=3, 'Strong'=4
  const strengthMap = {'Weak':1,'Fair':2,'Good':3,'Strong':4};
  const str = strengthMap[ump.strength] || 2;
  // Review probability: weak ump -> high chance, strong -> low chance
  const reviewChance = {1:0.75, 2:0.45, 3:0.20, 4:0.08}[str] || 0.35;
  return Math.random() < reviewChance;
}

function applyCpuDrsIfNeeded(){
  if(!st.pendingDismissal) return;
  const d = st.pendingDismissal;

  // CPU controls batting DRS when CPU is batting
  if(isCpuBatting() && d.givenOut){
    if(!d.noDrs && st.reviewsLeft > 0 && cpuShouldReview()){
      // CPU reviews -- resolve it, then show result and wait for human to tap Next ball
      setTimeout(()=>{callReview();render();}, 500);
    } else {
      // CPU accepts -- dismiss but stay on commentary so human can read it
      setTimeout(()=>{
        acceptDismissal();
        // Don't auto-advance -- human taps Next ball
        render();
      }, 500);
    }
    return;
  }
  // CPU controls bowling DRS when CPU is bowling
  if(isCpuBowling() && !d.givenOut){
    if(!d.noDrs && st.bowlingReviewsLeft > 0 && cpuShouldReview()){
      setTimeout(()=>{callReview();render();}, 500);
    }
    // Human taps "Continue Playing" regardless
    return;
  }
}

function cpuSelectBowler(){
  // Pick best available bowler for this over
  const bowlers = getBowlersForInnings();
  const ot = st.over <= 5 ? 'fast' : 'spin';
  const avail = bowlers.filter(b => (st.bowlerOvers[b.id]||0) < 2 && b.id !== st.bowler);
  const pool = avail.length ? avail : bowlers.filter(b => (st.bowlerOvers[b.id]||0) < 2);
  if(!pool.length) return null;
  const scored = pool.map(b => {
    let sc = b.stars;
    if(b.type === ot) sc += 2;
    if(b.speciality === 'opener' && st.over <= 2) sc += 2;
    if(b.speciality === 'finisher' && st.over >= 9) sc += 2;
    return {b, sc};
  });
  scored.sort((a,b) => b.sc - a.sc);
  return scored[0].b.id;
}

function applyCpuBowlerIfNeeded(){
  if(!isCpuBowling()) return;
  if(!st.mustChangeBowler && st.bowler && st.ball > 0) return;
  const id = cpuSelectBowler();
  if(id){
    // Silent selection -- no log, human sees it on the bowling screen
    st.bowler=id; st.mustChangeBowler=false;
  }
}

function applyCpuFieldIfNeeded(){
  if(!isCpuBowling()) return;
  const field = cpuSelectField();
  if(st.field !== field){
    const icons={attacking:'[x]',balanced:'[=]',defensive:'[o]'};
    addLog(`Field: ${icons[st.field]||st.field} -> ${icons[field]||field} ${field}`,'over');
    st.field = field;
  }
}

function applyCpuMentalityIfNeeded(){
  if(!isCpuBatting()) return;
  const idx = st.activeBat[0];
  const mentality = cpuSelectMentality(idx);
  st.mentalities[idx] = mentality;
}

function startSecondInnings(){
  st._t1runs=st.runs; st._t1wkts=st.wickets;
  if(!st._t1log) st._t1log=[...st.log]; // snapshot taken at innings end
  st.gameScreen='bowling';
  confirmProfile2('A');
}

function confirmProfile2(profileKey){
  st.innings=2;
  st.team1Score=st._t1runs; st.team1Wickets=st._t1wkts;
  st.profileInnings2=profileKey;
  st.phase='playing';
  const t1log=st._t1log||[];
  st.runs=0;st.wickets=0;st.over=1;st.ball=0;
  st.batsmen=freshBatsmen();st.batsmen[0].status='in';st.batsmen[1].status='in';
  st.activeBat=[0,1];st.bowler=null;st.bowlerOvers={};st.bowlStats={};
  st.mustChangeBowler=false;st.pendingDismissal=null;
  st.batDie=null;st.bowlDie=null;st.done=false;st.overBalls=[];
  st.consecutiveZeros=0;st.dotBallBuff=0;st.batConfidence=0;st.momentum=0;
  st.fieldStreak={id:st.field,count:0};
  st.reviewsLeft=2;st.bowlingReviewsLeft=2;st.activeUmpIdx=0;
  st.mentalities={};st.pendingWicket=false;
  st.log=[{msg:`-- Second innings | Target: ${st.team1Score+1} --`,cls:'over'},...t1log.slice(0,4)];
  addLog(`${getMatchTeam(2).name} need ${st.team1Score+1} to win from 10 overs`,'over');
  // v8: single profile
  render();
}


function addLog(msg,cls){if(!st.log)st.log=[];st.log.unshift({msg,cls});if(st.log.length>150)st.log.pop();}

function getMatchResult(){
  if(st.innings!==2||st.team1Score===null||!st.done)return null;
  const t1name=getMatchTeam(1).name, t2name=getMatchTeam(2).name;
  let result;
  if(st.runs>st.team1Score) result={text:`${t2name} win by ${11-st.wickets} wickets! (${st.runs}/${st.wickets} vs ${st.team1Score}/${st.team1Wickets})`,cls:'result-win'};
  else if(st.runs===st.team1Score) result={text:`Match tied! Both scored ${st.team1Score}`,cls:'result-tie'};
  else result={text:`${t1name} win by ${st.team1Score-st.runs} runs! (${st.team1Score}/${st.team1Wickets} vs ${st.runs}/${st.wickets})`,cls:'result-loss'};
  recordMatchResult();
  return result;
}

// =======================================
// TRANSCRIPT
// =======================================
function generateTranscript(){
  const t1=getMatchTeam(1), t2=getMatchTeam(2);
  const pitch=PITCH_OPTS.find(p=>p.id===st.pitchId)||{label:'Unknown'};
  const weather=WEATHER_OPTS.find(w=>w.id===st.weatherId)||{label:'Unknown'};
  const lines=[];

  lines.push('=======================================');
  lines.push('COUNTY CRICKET -- MATCH TRANSCRIPT (v9)');
  lines.push('=======================================');
  lines.push(`${t1.name} vs ${t2.name}`);
  lines.push(`Pitch: ${pitch.label} . Weather: ${weather.label}`);
  lines.push('');

  // First innings log (oldest first)
  const inn1log = st._t1log ? [...st._t1log].reverse() : [];
  if(inn1log.length){
    lines.push(`-- FIRST INNINGS: ${t1.name} --`);
    inn1log.forEach(e=>lines.push(e.msg));
    if(st.team1Score!==null) lines.push(`Result: ${st.team1Score}/${st.team1Wickets}`);
    lines.push('');
  }

  // Second innings / current innings log (oldest first)
  const inn2log=[...st.log].reverse();
  const innLabel = st.innings===1 ? 'FIRST INNINGS' : 'SECOND INNINGS';
  lines.push(`-- ${innLabel}: ${getMatchTeam(st.innings).name} --`);
  inn2log.forEach(e=>lines.push(e.msg));
  lines.push(`Score at time of export: ${st.runs}/${st.wickets} (over ${st.over}.${st.ball})`);

  // Result if complete
  const result=getMatchResult();
  if(result){
    lines.push('');
    lines.push('-- RESULT --');
    lines.push(result.text);
  }

  lines.push('');
  lines.push('=======================================');
  return lines.join('\n');
}

function copyTranscript(){
  const text=generateTranscript();
  // Show in modal so user can select+copy manually (avoids Android clipboard issues)
  const existing=document.getElementById('transcript-modal');
  if(existing){existing.remove();return;}
  const overlay=document.createElement('div');
  overlay.id='transcript-modal';
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9998;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;';
  // Escape text BEFORE building innerHTML
  const escapedText=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  overlay.innerHTML='<div style="background:#EDE6D6;border-radius:6px;padding:14px;width:100%;max-width:600px;font-family:Georgia,serif;">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
    +'<strong style="font-size:13px">Match Transcript</strong>'
    +'<button onclick="document.getElementById(&apos;transcript-modal&apos;).remove()" style="background:#1A1208;color:#F5F0E8;border:none;border-radius:3px;padding:4px 10px;font-family:Georgia,serif;font-size:12px;cursor:pointer;">Close</button>'
    +'</div>'
    +'<p style="font-size:10px;color:#6B5840;margin-bottom:8px;">Select all the text below and copy it.</p>'
    +'<textarea readonly style="width:100%;height:60vh;font-family:monospace;font-size:10px;padding:8px;border:1px solid #C8B89A;border-radius:3px;background:#F5F0E8;resize:none;" onclick="this.select()">'+escapedText+'</textarea>'
    +'</div>'
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  // Auto-select the textarea
  setTimeout(()=>{const ta=overlay.querySelector('textarea');if(ta)ta.select();},100);
}

function showToast(msg){
  const existing=document.getElementById('cricket-toast');
  if(existing)existing.remove();
  const t=document.createElement('div');
  t.id='cricket-toast';
  t.textContent=msg;
  t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1A1208;color:#F5F0E8;padding:8px 18px;border-radius:4px;font-size:13px;font-family:Georgia,serif;z-index:9999;pointer-events:none;';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2000);
}

// =======================================
// SETUP
// =======================================
function tossTheCoin(){
  if(mp&&mp.active) return; // multiplayer uses mpCallToss instead
  const coin=document.getElementById('coin');
  if(coin)coin.classList.add('spin');
  setTimeout(()=>{
    st.tossWinner=Math.random()<.5?'team1':'team2';
    // Conditions already chosen on conditions screen -- don't re-roll
    const shuffled=[...UMPIRE_POOL].sort(()=>Math.random()-.5);
    st.umpires=[{...shuffled[0]},{...shuffled[1]}];
    // If CPU won the toss, it decides immediately
    const cpuWonToss = st.cpuTeam && (
      (st.tossWinner==='team1' && st.cpuTeam==='t1') ||
      (st.tossWinner==='team2' && st.cpuTeam==='t2')
    );
    if(cpuWonToss){
      // CPU prefers to bowl first on minefield/overcast/damp, bat otherwise
      const cpuWantsBowl = (st.pitchId==='minefield' || st.weatherId==='overcast' || st.weatherId==='damp')
        && Math.random()<0.7;
      // chooseBatBowl('bat') = team1 bats first
      // If CPU is t1 and wants to bowl -> choice='bowl' (team1 bowls, team2 bats)
      // If CPU is t2 and wants to bowl -> choice='bat' (team1 bats, team2 bowls)
      let choice;
      if(st.cpuTeam==='t1') choice = cpuWantsBowl ? 'bowl' : 'bat';
      else                   choice = cpuWantsBowl ? 'bat'  : 'bowl';
      st.phase='choose_bat_bowl';
      render(); // show "CPU deciding..."
      setTimeout(()=>{chooseBatBowl(choice);},800);
    } else {
      st.phase='choose_bat_bowl';
      render();
    }
  },700);
}

function chooseBatBowl(choice){
  st.pendingChoice=choice;
  if(mp&&mp.active){
    st.mpPhase=null; // clear mp phase, enter playing
    // Pick umpires if not already set
    if(!st.umpires||!st.umpires.length){
      const shuffled=[...UMPIRE_POOL].sort(()=>Math.random()-.5);
      st.umpires=[{...shuffled[0]},{...shuffled[1]}];
    }
  }
  confirmProfile('A');
}

function confirmProfile(profileKey){
  st.profileInnings1='A';
  st.phase='playing';
  st.batsmen=freshBatsmen();
  st.batsmen[0].status='in';st.batsmen[1].status='in';
  const pitch=PITCH_OPTS.find(x=>x.id===st.pitchId);
  const weather=WEATHER_OPTS.find(x=>x.id===st.weatherId);
  addLog(`Match begins -- ${pitch.label} pitch, ${weather.label} conditions`,'over');
  const t1=getMatchTeam(1),t2=getMatchTeam(2);
  addLog(`${st.pendingChoice==='bat'?t1.name+' bat first':t2.name+' bat first'}`,'over');
  render();
}

function confirmNewGame(){
  if(st.phase==='playing'){
    if(!confirm('Start a new game?')) return;
  }
  resetGame();
}

function resetGame(){
  try{localStorage.removeItem('cricket_st');localStorage.removeItem('cricket_matchTeams');}catch(e){}
  matchTeams={t1:null,t2:null};
  initSetup();st.gameScreen='bowling';render();
}

// =======================================
// RENDER
// =======================================
function renderOnly(){
  // Render without saving -- used when applying remote Firebase updates
  if(historyScreenOpen){ document.getElementById('app').innerHTML=renderHistoryScreen(); return; }
  if(bowlerScreenOpen){ document.getElementById('app').innerHTML=renderBowlerScreen(); return; }
  if(teamEditorOpen==='editor'){
    const scrollY = document.querySelector('.te-overlay')?.scrollTop||0;
    document.getElementById('app').innerHTML=renderTeamEditor();
    const overlay=document.querySelector('.te-overlay');
    if(overlay)overlay.scrollTop=scrollY;
    return;
  }
  if(teamEditorOpen==='list'){ document.getElementById('app').innerHTML=renderTeamEditorList(); return; }
  if(settingsOpen&&st.phase==='select_teams'){ document.getElementById('app').innerHTML=renderSettings(); return; }
  const showMast=st.phase!=='playing';
  document.getElementById('app').innerHTML=`
    ${settingsOpen&&st.phase==='select_teams'?renderSettings():''}
    ${showMast?`<div class="mast">
      <div class="mast-sup">Tabletop Edition</div>
      <div class="mast-title">Pub Cricket Captain</div>
      <div class="mast-sub">Pass the phone. Take the wickets.</div>
    </div>`:''}
    ${renderPhase()}`;
  startCpuBowlCountdown();
}

function render(){
  saveSession();
  if(historyScreenOpen){ document.getElementById('app').innerHTML=renderHistoryScreen(); return; }
  if(bowlerScreenOpen){ document.getElementById('app').innerHTML=renderBowlerScreen(); return; }
  if(teamEditorOpen==='editor'){
    const scrollY = document.querySelector('.te-overlay')?.scrollTop||0;
    document.getElementById('app').innerHTML=renderTeamEditor();
    const overlay=document.querySelector('.te-overlay');
    if(overlay)overlay.scrollTop=scrollY;
    return;
  }
  if(teamEditorOpen==='list'){
    document.getElementById('app').innerHTML=renderTeamEditorList();
    return;
  }
  const showMast=st.phase!=='playing';
  document.getElementById('app').innerHTML=`
    ${settingsOpen&&st.phase==='select_teams'?renderSettings():''}
    ${showMast?`<div class="mast">
      <div class="mast-sup">Tabletop Edition</div>
      <div class="mast-title">Pub Cricket Captain</div>
      <div class="mast-sub">Pass the phone. Take the wickets.</div>
    </div>`:''}
    ${renderPhase()}`;
  startCpuBowlCountdown();
}

function getCpuBowlFlavour(){
  const bwl=st.bowler?getBowlersForInnings().find(b=>b.id===st.bowler):null;
  if(!bwl) return 'The bowler stands at the top of their mark.';
  const hand=bwl.hand==='R'?'right':'left';
  const type=bwl.type==='fast'?'quick':'spin';
  const lines=[
    bwl.name+' stands at the top of their mark.',
    bwl.name+' turns, ball in '+hand+' hand.',
    bwl.name+' paces back to their mark.',
    bwl.name+' adjusts their grip -- '+(type==='quick'?'fingers across the seam.':'fingers around the seam.'),
  ];
  return lines[Math.floor(Math.random()*lines.length)];
}
function startCpuBowlCountdown(){
  // For online play: start action timers based on current screen
  if(!mp||!mp.active) return;
  mpClearActionTimer();
  const screen=mpGetScreen();
  const bwl=st.bowler?getBowlersForInnings().find(b=>b.id===st.bowler):null;
  const mustChange=st.mustChangeBowler;

  if(screen==='bowling'&&mp.role==='host'&&bwl&&!mustChange&&st.phase==='playing'){
    // Host on bowling screen -- 10s to tap Ready
    mpStartActionTimer(10,function(){goToBattingScreen();},'Auto-bowl');
  } else if(screen==='batting'&&mp.role==='guest'&&st.phase==='playing'){
    // Guest on batting screen -- 10s to choose mentality then deliver
    mpStartActionTimer(10,function(){
      // Auto-set defensive for all batsmen
      if(st.activeBat&&st.activeBat[0]!==undefined){
        st.mentalities[st.activeBat[0]]='defensive';
      }
      deliverBall();
    },'Auto-defensive');
  } else if(st.mpPhase==='toss'&&mp.role==='guest'&&!st.tossWinner){
    // Guest toss call -- 10s then auto heads
    mpStartActionTimer(10,function(){mpCallToss('heads');},'Auto-call');
  } else if(screen==='commentary'&&st.pendingDismissal){
    // DRS decision -- 5s then auto decline
    const d=st.pendingDismissal;
    if(d.givenOut&&!isCpuBatting()){
      mpStartActionTimer(5,function(){acceptAndReturn();},'Auto-accept');
    } else if(!d.givenOut&&!isCpuBowling()){
      mpStartActionTimer(5,function(){dismissNotOutAndReturn();},'Auto-continue');
    }
  } else {
    mpClearActionTimer();
  }
}

function renderPhase(){
  // Multiplayer overrides normal phase routing
  if(mp&&mp.active) return renderMpPhase();
  if(st.phase==='select_teams')return renderSelectTeams();
  if(st.phase==='conditions')return renderConditions();
  if(st.phase==='toss')return renderToss();
  if(st.phase==='choose_bat_bowl')return renderBatBowl();
  if(st.phase==='playing'){
    const screen = (typeof mpGetScreen==='function') ? mpGetScreen() : st.gameScreen;
    if(screen==='batting') return renderBattingScreen();
    if(screen==='commentary') return renderCommentaryScreen();
    return renderBowlingScreen();
  }
  return renderGame();
}

// =======================================
// MULTIPLAYER PHASE RENDERER
// =======================================
function renderMpPhase(){
  if(st.phase==='playing'){
    const screen=mpGetScreen();
    if(screen==='batting')return renderBattingScreen();
    if(screen==='commentary')return renderCommentaryScreen();
    return renderBowlingScreen();
  }
  const mpP=st.mpPhase||'lobby';
  if(mpP==='lobby')   return renderMpLobby();
  if(mpP==='conditions')return renderMpConditions();
  if(mpP==='teams')   return renderMpTeams();
  if(mpP==='toss')    return renderMpToss();
  return renderSelectTeams();
}

function renderMpLobby(){
  const isHost=mp.role==='host';
  const inner=isHost
    ?'<div style="font-size:12px;color:var(--mid);margin-bottom:8px">You are: <strong>Home team</strong></div>'
     +'<button class="btn btn-primary" style="width:100%" onclick="mpAdvanceToConditions()">Set Conditions &rarr;</button>'
    :'<div style="font-size:12px;color:var(--mid);font-style:italic;text-align:center">Host is setting conditions&hellip;</div>';
  return '<div class="setup">'
    +'<div class="setup-title">Online Lobby</div>'
    +'<div style="font-size:24px;font-weight:700;letter-spacing:.2em;text-align:center;'
    +'font-family:Playfair Display,serif;padding:16px;background:var(--dark);'
    +'color:var(--cream);border-radius:var(--r);margin-bottom:12px">'+mp.roomCode+'</div>'
    +'<div style="font-size:11px;color:var(--mid);text-align:center;margin-bottom:16px">'
    +(isHost?'Share this code with your opponent. Waiting for them to join&hellip;'
            :'You have joined! Waiting for host&hellip;')
    +'</div>'
    +inner
    +'<div style="margin-top:12px;text-align:center">'
    +'<button class="btn sec" style="font-size:11px;padding:4px 10px" onclick="mpLeave()">&#x2190; Leave lobby</button>'
    +'</div>'
    +'</div>';
}

function renderMpConditions(){
  if(mp.role==='guest'){
    return '<div class="setup">'
      +'<div class="setup-title">Online Lobby</div>'
      +'<div style="font-size:14px;color:var(--mid);font-style:italic;text-align:center;margin-top:20px">'
      +'Host is setting conditions&hellip;<br><br>'
      +'<span style="font-size:10px">Room: '+mp.roomCode+'</span>'
      +'</div></div>';
  }
  const pitch=PITCH_OPTS.find(p=>p.id===st.pitchId)||PITCH_OPTS[1];
  const weather=WEATHER_OPTS.find(w=>w.id===st.weatherId)||WEATHER_OPTS[0];
  let pitchCards='';
  PITCH_OPTS.forEach(p=>{
    pitchCards+='<div class="choice-card'+(p.id===st.pitchId?' sel':'')+'" style="padding:10px 6px;cursor:pointer" onclick="selectCondition(&apos;pitch&apos;,&apos;"+p.id+"&apos;)">'
      +'<div class="cc-icon" style="font-size:20px">'+p.icon+'</div>'
      +'<div class="cc-name" style="font-size:11px">'+p.label+'</div></div>';
  });
  let weatherCards='';
  WEATHER_OPTS.forEach(w=>{
    weatherCards+='<div class="choice-card'+(w.id===st.weatherId?' sel':'')+'" style="padding:10px 6px;cursor:pointer" onclick="selectCondition(&apos;weather&apos;,&apos;"+w.id+"&apos;)">'
      +'<div class="cc-icon" style="font-size:20px">'+w.icon+'</div>'
      +'<div class="cc-name" style="font-size:11px">'+w.label+'</div></div>';
  });
  return '<div class="setup">'
    +'<div class="setup-title">Set Conditions</div>'
    +'<div class="setup-sub">Choose pitch and weather &mdash; opponent cannot see this yet</div>'
    +'<div style="margin-bottom:14px">'
    +'<div style="font-size:11px;color:var(--mid);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase">Pitch</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">'+pitchCards+'</div></div>'
    +'<div style="margin-bottom:18px">'
    +'<div style="font-size:11px;color:var(--mid);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase">Weather</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px">'+weatherCards+'</div></div>'
    +'<button class="btn btn-primary" style="width:100%" onclick="mpAdvanceToTeams()">Confirm Conditions &rarr; Choose Teams</button>'
    +'</div>';
}

function renderMpTeams(){
  const allTeams=[...STOCK_TEAMS,...customTeams];
  const myTeam=mp.role==='host'?matchTeams.t1:matchTeams.t2;
  const theirTeam=mp.role==='host'?matchTeams.t2:matchTeams.t1;
  let teamBtns='';
  const left=allTeams.slice(0,4);
  const right=allTeams.slice(4,8);
  const makeCard=(t,i)=>{
    const sel=myTeam&&myTeam.name===t.name;
    const pColor=t.personality==='Chasing'?'#E8B4A0':t.personality==='Setting'?'#C9D8B6':'var(--border)';
    return '<div onclick="mpSelectTeamIdx('+i+')" style="'
      +'padding:8px 6px;border:2px solid '+(sel?'var(--gold-light)':'var(--border)')+';'
      +'border-radius:4px;background:'+(sel?'var(--gold-pale)':'var(--parchment)')+';'
      +'cursor:pointer;text-align:center;">'
      +'<div style="font-size:11px;font-weight:600;line-height:1.2;margin-bottom:3px">'+t.name+'</div>'
      +'<div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:'+pColor+';font-weight:600">'+t.personality+'</div>'
      +'</div>';
  };
  teamBtns='<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:10px">';
  for(let i=0;i<Math.max(left.length,right.length);i++){
    teamBtns+=left[i]?makeCard(left[i],i):'<div></div>';
    teamBtns+=right[i]?makeCard(right[i],i+4):'<div></div>';
  }
  teamBtns+='</div>';
  const myTeamBlock=myTeam
    ?'<div style="padding:10px 12px;background:var(--green-pale);border:1px solid var(--green);border-radius:var(--r);margin-bottom:10px">'
     +'<div style="font-size:11px;color:var(--green)">Your team</div>'
     +'<div style="font-size:15px;font-weight:600">'+myTeam.name+'</div></div>'
    :'';
  const opponentLine=theirTeam?' &middot; Opponent: <strong>'+theirTeam.name+'</strong>':'';
  const footer=myTeam&&theirTeam
    ?'<button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="mpAdvanceToToss()">Ready for Toss &rarr;</button>'
    :myTeam
    ?'<div style="font-size:11px;color:var(--mid);font-style:italic;text-align:center;margin-top:8px">Waiting for opponent to choose their team&hellip;</div>'
    :'<div style="font-size:11px;color:var(--mid);font-style:italic;text-align:center;margin-top:8px">Choose your team above</div>';
  return '<div class="setup">'
    +'<div class="setup-title">Choose Your Team</div>'
    +'<div style="font-size:11px;color:var(--mid);margin-bottom:10px">'
    +(mp.role==='host'?'You are Home team (Team 1)':'You are Away team (Team 2)')
    +opponentLine+'</div>'
    +myTeamBlock
    +'<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px;max-height:40vh;overflow-y:auto">'+teamBtns+'</div>'
    +footer
    +'</div>';
}

function renderMpToss(){
  const pitch=PITCH_OPTS.find(p=>p.id===st.pitchId)||PITCH_OPTS[1];
  const weather=WEATHER_OPTS.find(w=>w.id===st.weatherId)||WEATHER_OPTS[0];
  const tossResult=st.tossWinner;
  const guestName=matchTeams.t2?matchTeams.t2.name:'Away team';
  const hostName=matchTeams.t1?matchTeams.t1.name:'Home team';
  const winnerName=tossResult==='team1'?hostName:tossResult==='team2'?guestName:'';
  const condBar='<div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">'
    +'<div class="choice-card" style="cursor:default;padding:8px 12px;max-width:130px">'
    +'<div class="cc-icon" style="font-size:18px">'+pitch.icon+'</div>'
    +'<div class="cc-name" style="font-size:11px">'+pitch.label+'</div></div>'
    +'<div class="choice-card" style="cursor:default;padding:8px 12px;max-width:130px">'
    +'<div class="cc-icon" style="font-size:18px">'+weather.icon+'</div>'
    +'<div class="cc-name" style="font-size:11px">'+weather.label+'</div></div></div>';
  let inner='';
  if(tossResult){
    const iWon=(mp.role==='host'&&tossResult==='team1')||(mp.role==='guest'&&tossResult==='team2');
    inner='<div style="font-size:16px;font-weight:600;text-align:center;margin-bottom:18px">'+winnerName+' wins the toss!</div>';
    if(iWon){
      inner+='<div style="margin-bottom:10px;font-size:12px;color:var(--mid);text-align:center">You won &mdash; bat or bowl?</div>'
        +'<div class="choice-grid">'
        +'<div class="choice-card" onclick="chooseBatBowl(&apos;bat&apos;)"><div class="cc-icon">&#127951;</div><div class="cc-name">Bat First</div></div>'
        +'<div class="choice-card" onclick="chooseBatBowl(&apos;bowl&apos;)"><div class="cc-icon">&#127967;</div><div class="cc-name">Bowl First</div></div>'
        +'</div>';
    } else {
      inner+='<div style="font-size:12px;color:var(--mid);font-style:italic;text-align:center">Waiting for '+winnerName+' to choose&hellip;</div>';
    }
  } else if(mp.role==='guest'){
    inner='<div style="font-size:13px;font-weight:600;text-align:center;margin-bottom:16px">'+guestName+' &mdash; call it!</div>'
      +'<div class="choice-grid">'
      +'<div class="choice-card" onclick="mpCallToss(&apos;heads&apos;)"><div class="cc-icon">&#129689;</div><div class="cc-name">Heads</div></div>'
      +'<div class="choice-card" onclick="mpCallToss(&apos;tails&apos;)"><div class="cc-icon">&#129689;</div><div class="cc-name">Tails</div></div>'
      +'</div>';
  } else {
    inner='<div style="font-size:12px;color:var(--mid);font-style:italic;text-align:center;margin-top:20px">Waiting for '+guestName+' to call the toss&hellip;</div>';
  }
  return '<div class="setup"><div class="setup-title">The Toss</div>'+condBar+inner+'</div>';
}



function mpAdvanceToConditions(){
  st.mpPhase='conditions';
  render();
}
function mpAdvanceToTeams(){
  st.mpPhase='teams';
  // Pick umpires now
  const shuffled=[...UMPIRE_POOL].sort(()=>Math.random()-.5);
  st.umpires=[{...shuffled[0]},{...shuffled[1]}];
  render();
}
function mpAdvanceToToss(){
  st.mpPhase='toss';
  render();
}
function mpSelectTeam(name){
  const allTeams=[...STOCK_TEAMS,...customTeams];
  const team = allTeams.find(t=>t.name===name);
  if(!team) return;
  if(mp.role==='host') matchTeams.t1=team;
  else matchTeams.t2=team;
  render();
}
function mpSelectTeamIdx(idx){
  const allTeams=[...STOCK_TEAMS,...customTeams];
  const team = allTeams[idx];
  if(!team) return;
  if(mp.role==='host') matchTeams.t1=team;
  else matchTeams.t2=team;
  render();
}
function mpCallToss(call){mpClearActionTimer();
  // Guest calls -- coin flips
  const coin = Math.random()<0.5?'heads':'tails';
  st.tossWinner = (call===coin) ? 'team2' : 'team1'; // team2 = guest
  render(); // pushes to Firebase -- host sees result too
}

function renderConditions(){
  const pitch=PITCH_OPTS.find(p=>p.id===st.pitchId)||PITCH_OPTS[1];
  const weather=WEATHER_OPTS.find(w=>w.id===st.weatherId)||WEATHER_OPTS[0];
  return`<div class="setup">
    <div class="setup-title">Today&#39;s Conditions</div>
    <div class="setup-sub">Choose pitch and weather or go with what you&#39;re dealt</div>
    <div style="margin-bottom:14px">
      <div style="font-size:11px;color:var(--mid);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase">Pitch</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        ${PITCH_OPTS.map(p=>`<div class="choice-card${p.id===st.pitchId?' sel':''}" style="padding:10px 6px;cursor:pointer" onclick="selectCondition('pitch','${p.id}')">
          <div class="cc-icon" style="font-size:20px">${p.icon}</div>
          <div class="cc-name" style="font-size:11px">${p.label}</div>
        </div>`).join('')}
      </div>
    </div>
    <div style="margin-bottom:18px">
      <div style="font-size:11px;color:var(--mid);margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase">Weather</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px">
        ${WEATHER_OPTS.map(w=>`<div class="choice-card${w.id===st.weatherId?' sel':''}" style="padding:10px 6px;cursor:pointer" onclick="selectCondition('weather','${w.id}')">
          <div class="cc-icon" style="font-size:20px">${w.icon}</div>
          <div class="cc-name" style="font-size:11px">${w.label}</div>
        </div>`).join('')}
      </div>
    </div>
    ${st.cpuTeam==='t1'?`
    <button class="btn btn-primary" style="width:100%;margin-bottom:0" onclick="proceedToCpuGame()">Start Match -></button>
    `:`
    <button class="btn btn-primary" style="width:100%;margin-bottom:0" onclick="st.phase='toss';render()">Proceed to Toss -></button>
    `}
  </div>`;
}

function selectCondition(type, id){
  if(type==='pitch'){
    const p=PITCH_OPTS.find(x=>x.id===id);
    if(p){st.pitchId=p.id;st.pitchIdx=p.idx;}
  } else {
    const w=WEATHER_OPTS.find(x=>x.id===id);
    if(w){st.weatherId=w.id;st.weatherIdx=w.idx;}
  }
  render();
}

function proceedToCpuGame(){
  // CPU bats 1st -- skip toss entirely
  const shuffled=[...UMPIRE_POOL].sort(()=>Math.random()-.5);
  st.umpires=[{...shuffled[0]},{...shuffled[1]}];
  chooseBatBowl('bowl'); // human bowls, CPU bats
}

function renderToss(){
  const t1name=matchTeams.t1?matchTeams.t1.name:'Team 1';
  const t2name=matchTeams.t2?matchTeams.t2.name:'Team 2';
  const pitch=PITCH_OPTS.find(p=>p.id===st.pitchId)||PITCH_OPTS[1];
  const weather=WEATHER_OPTS.find(w=>w.id===st.weatherId)||WEATHER_OPTS[0];
  const hasTossed = !!st.tossWinner;
  const winnerName = st.tossWinner==='team1'?t1name:t2name;
  return`<div class="setup">
    <div class="setup-title">The Coin Toss</div>
    <div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">
      <div class="choice-card" style="cursor:default;padding:8px 12px;max-width:130px">
        <div class="cc-icon" style="font-size:18px">${pitch.icon}</div>
        <div class="cc-name" style="font-size:11px">${pitch.label}</div>
      </div>
      <div class="choice-card" style="cursor:default;padding:8px 12px;max-width:130px">
        <div class="cc-icon" style="font-size:18px">${weather.icon}</div>
        <div class="cc-name" style="font-size:11px">${weather.label}</div>
      </div>
    </div>
    ${hasTossed?`
    <div style="font-size:16px;font-family:'Playfair Display',serif;font-weight:600;text-align:center;margin-bottom:18px">
      ${winnerName} wins the toss!
    </div>
    <div class="choice-grid" style="margin-bottom:10px">
      <div class="choice-card" onclick="chooseBatBowl('bat')">
        <div class="cc-icon">[bat]</div>
        <div class="cc-name">Bat First</div>
        <div class="cc-desc">${t1name} set a target</div>
      </div>
      <div class="choice-card" onclick="chooseBatBowl('bowl')">
        <div class="cc-icon">[bowl]</div>
        <div class="cc-name">Bowl First</div>
        <div class="cc-desc">${t2name} set a target</div>
      </div>
    </div>
    <button class="btn sec" style="width:100%" onclick="redoToss()">? Redo toss</button>
    `:`
    <div class="coin" id="coin" onclick="tossTheCoin()">[coin]</div>
    <p style="font-size:11px;color:var(--mid);text-align:center">Tap to toss</p>
    `}
    <div style="margin-top:10px;text-align:center">
      <button class="btn sec" style="font-size:11px;padding:4px 10px" onclick="st.phase='conditions';render()"><- Back to conditions</button>
    </div>
  </div>`;
}

function redoToss(){
  st.tossWinner=null;
  render();
}

function renderBatBowl(){
  const t1name=getMatchTeam(1).name, t2name=getMatchTeam(2).name;
  const winnerName=st.tossWinner==='team1'?t1name:t2name;
  // Has the CPU already won the toss and is deciding? Show spinner.
  const cpuWonToss = st.cpuTeam && (
    (st.tossWinner==='team1'&&st.cpuTeam==='t1')||
    (st.tossWinner==='team2'&&st.cpuTeam==='t2')
  );
  const humanWonToss = !cpuWonToss || !st.cpuTeam;
  return`<div class="setup">
    <div class="setup-title">${winnerName} wins the toss!</div>
    ${humanWonToss?`
    <div style="margin-bottom:12px;font-size:12px;color:var(--mid)">Bat or bowl?</div>
    <div class="choice-grid">
      <div class="choice-card" onclick="chooseBatBowl('bat')">
        <div class="cc-icon">[bat]</div>
        <div class="cc-name">Bat First</div>
        <div class="cc-desc">Set a target</div>
      </div>
      <div class="choice-card" onclick="chooseBatBowl('bowl')">
        <div class="cc-icon">[bowl]</div>
        <div class="cc-name">Bowl First</div>
        <div class="cc-desc">Chase their score</div>
      </div>
    </div>`:`
    <div style="font-size:12px;color:var(--mid);font-style:italic">CPU is deciding...</div>`}
  </div>`;
}

// =======================================
// THREE-SCREEN GAME FLOW
// =======================================

function renderScoreBar(){
  const needRuns=st.innings===2&&st.team1Score!==null?st.team1Score+1-st.runs:null;
  const ballsLeft=Math.max(0,(10-st.over)*6+(6-st.ball));
  const pitch=PITCH_OPTS.find(p=>p.id===st.pitchId);
  const weather=WEATHER_OPTS.find(w=>w.id===st.weatherId);
  const battingName=getBattingTeam().name;
  const fieldingName=getFieldingTeamObj().name;
  const mpBadge=mp&&mp.active?`<span style="font-size:9px;background:var(--green);color:#fff;padding:2px 6px;border-radius:2px;letter-spacing:.1em">${mp.roomCode} . ${mp.role}</span>`:'';
  return`
<div style="background:var(--dark);color:var(--cream);padding:10px 12px;border-radius:var(--r);margin-bottom:8px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
    <div style="font-size:11px;color:var(--light)">${battingName} batting</div>
    <div style="display:flex;gap:6px;align-items:center">
      ${mpBadge}
      <div style="font-size:10px;color:var(--light)">${pitch.icon} ${pitch.label} . ${weather.icon} ${weather.label}</div>
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:baseline">
    <div style="font-family:'Playfair Display',serif;font-size:32px;font-weight:700">${st.runs}<span style="font-size:18px;opacity:.6">/${st.wickets}</span></div>
    <div style="text-align:right">
      <div style="font-size:20px;font-weight:600">Ov ${Math.min(st.over,10)}.${st.ball}</div>
      ${needRuns!==null?`<div style="font-size:11px;color:var(--light)">Need ${needRuns} from ${ballsLeft}b</div>`:''}
    </div>
  </div>
  ${st.innings===2&&st.team1Score!==null?`
  <div style="font-size:10px;color:var(--light);margin-top:2px">${fieldingName} set ${st.team1Score}/${st.team1Wickets}</div>`:''}
</div>`;
}

function renderBatterInfo(){
  // Minimal info shown to bowler -- name, runs, hand only. No mentality.
  return st.activeBat.map((idx,i)=>{
    const b=st.batsmen[idx];
    const isStriker=i===0;
    return`<div style="padding:6px 10px;border:1px solid ${isStriker?'var(--gold-light)':'var(--border)'};border-radius:var(--r);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:12px;font-weight:600">${b.name}${isStriker?' *':''}</div>
        <div style="font-size:10px;color:var(--mid)">${b.hand}H . ${'*'.repeat(b.stars)}</div>
      </div>
      <div style="font-size:20px;font-weight:700;font-family:'Playfair Display',serif">${b.runs}</div>
    </div>`;
  }).join('');
}

function renderOverPips(){
  return`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
    <div style="font-size:12px;color:var(--mid)">Over ${Math.min(st.over,10)} . ${6-st.ball} left</div>
    <div class="pips">${Array.from({length:6},(_,i)=>{const p=st.overBalls[i];return`<div class="pip${p?(' '+(p.type==='wkt'?'wkt':p.type==='boundary'?'boundary':'done')):''}"></div>`;}).join('')}</div>
  </div>`;
}

function renderBowlingScreen(){
  // Guest in multiplayer sees a waiting screen instead of bowling controls
  if(mp&&mp.active&&mp.role==='guest'&&st.gameScreen!=='commentary'){
    return`
${renderScoreBar()}
${renderOverPips()}
<div style="padding:20px;text-align:center;border:1px solid var(--border);border-radius:var(--r);background:var(--parchment)">
  <div style="font-size:16px;font-weight:600;margin-bottom:6px">Waiting for bowler...</div>
  <div style="font-size:12px;color:var(--mid)">The host is setting up the over</div>
  <div style="margin-top:10px;font-size:11px;color:var(--mid)">Room: <strong>${mp.roomCode}</strong></div>
</div>`;
  }
  const bwl=st.bowler?getBowlersForInnings().find(b=>b.id===st.bowler):null;
  const mustChange=st.mustChangeBowler;
  const fo=FIELD_OPTS.find(f=>f.id===st.field);
  const result=getMatchResult();
  const ot=getOverType();

  if(result) return renderResultScreen(result);
  if(st.done&&st.innings===1) return renderInningsBrakeScreen();

  // Pending wicket -- batting team chooses next batsman (still shown here as it's between balls)
  if(st.pendingWicket) return renderPendingWicket();

  return`
${renderScoreBar()}
${renderOverPips()}

<!-- Batting team info (visible to bowler) -->
<div style="margin-bottom:10px">${renderBatterInfo()}</div>

<!-- Umpires -->
<div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">
  <span style="font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:var(--mid)">Umpires</span>
  ${st.umpires.map((u,i)=>`<span style="font-size:10px;padding:2px 8px;border-radius:2px;border:1px solid ${st.activeUmpIdx===i?'var(--dark)':'var(--border)'};background:${st.activeUmpIdx===i?'var(--dark)':'transparent'};color:${st.activeUmpIdx===i?'var(--cream)':'var(--mid)'}">${u.name} . ${u.quality}${st.activeUmpIdx===i?' *':''}</span>`).join('')}
  <div style="flex:1"></div>
  <span style="font-size:10px;color:var(--mid)">Rev: ${st.reviewsLeft}/${st.bowlingReviewsLeft}</span>
</div>

<!-- Bowler card -->
<div class="card${mustChange?' must-change':''}" style="margin-bottom:8px">
  <div class="card-title">${mustChange?'? Change bowler -- over complete':'Bowler'}</div>
  ${bwl&&!mustChange?`
  <div style="font-family:'Playfair Display',serif;font-size:16px;font-weight:600;margin-bottom:2px">${bwl.name}</div>
  <div style="font-size:12px;color:var(--mid);margin-bottom:4px">${'*'.repeat(Math.min(5,bwl.stars+(getSpecialistBonus(bwl)||0)+(getInherentBonus(bwl)||0)))} . ${bwl.type}.${bwl.hand}H${bwl.speciality&&bwl.speciality!=='none'?' . '+bwl.speciality:''}</div>
  <div class="info-row">
    <span class="${getBowlerFavLabel(bwl).cls==='good'?'tag tag-green':getBowlerFavLabel(bwl).cls==='bad'?'tag tag-red':'tag tag-mid'}">${getBowlerFavLabel(bwl).label}</span>
    ${bwl.hand!==st.batsmen[st.activeBat[0]]?.hand?`<span class="tag tag-green">Arm angle ?</span>`:''}
    ${(getSpecialistBonus(bwl)+(getInherentBonus(bwl)||0))>0?`<span class="tag tag-gold">* In their element</span>`:''}
  </div>`:`<div style="font-size:13px;color:var(--mid)">No bowler selected</div>`}
  ${!isCpuBowling()?`<button class="btn btn-sm" style="margin-top:8px;width:100%" onclick="openBowlerScreen()" ${!mustChange&&bwl&&st.ball>0?'disabled':''}>
    ${mustChange?'Select bowler for next over ->':bwl&&st.ball>0?'Locked mid-over':'Select bowler ->'}
  </button>`:`<div style="font-size:10px;color:var(--mid);font-style:italic;margin-top:6px">CPU choosing bowler</div>`}
</div>

<!-- Field -->
<div class="card" style="margin-bottom:10px">
  <div class="card-title">Field${isCpuBowling()?` <span style="font-size:9px;color:var(--mid);font-weight:normal">CPU</span>`:''}</div>
  <div style="display:flex;gap:4px;margin-bottom:4px">
    ${FIELD_OPTS.map(f=>`<button class="f-btn ${f.id}${st.field===f.id?' sel':''}" onclick="selectField('${f.id}')" ${isCpuBowling()?'disabled':''}>${f.label}</button>`).join('')}
  </div>
  <div style="font-size:10px;color:var(--mid)">${fo?.desc||''} ${getFieldFatigue().label?'. '+getFieldFatigue().label:''}</div>
</div>

<!-- Ready button -->
${isCpuBowling()?`
<div style="padding:14px 12px;border:1px solid var(--border);border-radius:var(--r);background:var(--parchment);margin-bottom:10px;text-align:center">
  <div style="font-size:13px;font-weight:600;font-style:italic;color:var(--ink)">${getCpuBowlFlavour()}</div>
</div>
<button class="btn btn-primary" style="width:100%" onclick="goToBattingScreen()">
  Umpire signals play
</button>`:`
<button class="btn btn-primary" style="width:100%" onclick="goToBattingScreen()" ${!bwl||mustChange?'disabled':''}>
  ${mustChange?'Select a bowler first':'Ready -- Umpire signals play'}
</button>`}

<div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
  <button class="btn sec" style="font-size:11px;padding:4px 10px" onclick="copyTranscript()">[clip] Transcript</button>
  ${mp&&mp.active
    ?`<button class="btn sec" style="font-size:11px;padding:4px 10px;color:#7A1B1B" onclick="mpForfeit()">Forfeit</button>`
    :`<button class="btn sec" style="font-size:11px;padding:4px 10px" onclick="confirmNewGame()">New game</button>`}
</div>`;
}

function goToBattingScreen(){mpClearActionTimer();
  applyCpuBowlerIfNeeded();
  applyCpuFieldIfNeeded();
  if(!st.bowler||st.mustChangeBowler) return;
  if(isCpuBatting()){
    applyCpuMentalityIfNeeded();
    st.gameScreen='commentary';
    rollBat();
  } else {
    st.gameScreen='batting';
    render(); // saveSession called inside, which pushes to Firebase
  }
}

function renderBattingScreen(){
  // Host in multiplayer sees waiting screen instead of batting controls
  if(mp&&mp.active&&mp.role==='host'&&st.gameScreen!=='commentary'){
    return`
${renderScoreBar()}
${renderOverPips()}
<div style="padding:20px;text-align:center;border:1px solid var(--border);border-radius:var(--r);background:var(--parchment)">
  <div style="font-size:16px;font-weight:600;margin-bottom:6px">Waiting for batsman...</div>
  <div style="font-size:12px;color:var(--mid)">The guest is choosing their approach</div>
  <div style="margin-top:10px;font-size:11px;color:var(--mid)">Room: <strong>${mp.roomCode}</strong></div>
</div>`;
  }
  if(!st.activeBat||!st.activeBat[0]===undefined) return renderBowlingScreen();
  const bat=st.batsmen[st.activeBat[0]];
  if(!bat) return renderBowlingScreen();
  const m=st.mentalities[st.activeBat[0]]||'positive';
  const fo=FIELD_OPTS.find(f=>f.id===st.field);
  const result=getMatchResult();
  if(result) return renderResultScreen(result);

  return`
${renderScoreBar()}
${renderOverPips()}

<!-- Field info (batsman can see it) -->
<div style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--r);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
  <div>
    <div style="font-size:10px;color:var(--mid);text-transform:uppercase;letter-spacing:.06em">Field</div>
    <div style="font-size:14px;font-weight:600">${fo?.label||st.field}</div>
    <div style="font-size:10px;color:var(--mid)">${fo?.desc||''}</div>
  </div>
  <div style="font-size:24px">${fo?.icon||''}</div>
</div>

<!-- Striker -->
<div style="padding:10px 12px;border:1px solid var(--gold-light);border-radius:var(--r);background:var(--dark);color:var(--cream);margin-bottom:10px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:15px;font-weight:600">${bat.name} *</div>
      <div style="font-size:10px;color:var(--light)">${bat.hand}H . ${'*'.repeat(bat.stars)}</div>
    </div>
    <div style="font-size:24px;font-weight:700;font-family:'Playfair Display',serif;color:#C9D8B6">${bat.runs}</div>
  </div>
  ${st.momentum>0?`<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
    <div style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:${st.momentum>=7?'#E8B4A0':st.momentum>=4?'var(--gold-light)':'var(--light)'}">Momentum</div>
    <div style="flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.15);overflow:hidden">
      <div style="height:100%;border-radius:2px;width:${Math.round(st.momentum/MOMENTUM_CAP*100)}%;background:${st.momentum>=7?'#E8B4A0':st.momentum>=4?'var(--gold-light)':'#C9D8B6'};transition:width .3s"></div>
    </div>
  </div>`:''}
  <div style="font-size:11px;color:var(--light);margin-bottom:6px">Choose your approach:</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
    ${MENTALITIES.map(men=>`<button style="padding:7px 5px;font-size:11px;border:1px solid ${m===men.id?'var(--gold-light)':'rgba(255,255,255,.2)'};border-radius:3px;background:${m===men.id?'var(--gold-pale)':'transparent'};color:${m===men.id?'var(--gold)':'var(--light)'};cursor:pointer;font-family:Source Serif 4,serif;touch-action:manipulation;text-align:center"
      onclick="setMentality(${st.activeBat[0]},'${men.id}')">${men.label}</button>`).join('')}
  </div>
</div>

<!-- Non-striker -->
${(()=>{const ns=st.batsmen[st.activeBat?.[1]];return ns?`
<div style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--r);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;opacity:.7">
  <div>
    <div style="font-size:12px">${ns.name} <span style="font-size:10px;color:var(--mid)">non-striker</span></div>
    <div style="font-size:10px;color:var(--mid)">${ns.hand}H</div>
  </div>
  <div style="font-size:18px;font-weight:600">${ns.runs}</div>
</div>`:''})()}

<button class="btn btn-primary" style="width:100%;font-size:15px;padding:12px" onclick="deliverBall()">
  Deliver ->
</button>`;
}

function deliverBall(){mpClearActionTimer();
  st.gameScreen='commentary';
  rollBat(); // rollBat calls render which calls saveSession which pushes to Firebase
}

function renderCommentaryScreen(){
  const result=getMatchResult();
  const bat=st.batsmen?.[st.activeBat?.[0]];
  const humanControlsBatDrs = !isCpuBatting();
  const humanControlsBowlDrs = !isCpuBowling();
  const canBatReview=humanControlsBatDrs&&st.pendingDismissal&&st.pendingDismissal.givenOut&&!st.pendingDismissal.noDrs&&st.reviewsLeft>0;
  const showBatDrs=humanControlsBatDrs&&st.pendingDismissal&&st.pendingDismissal.givenOut&&!st.pendingDismissal.noDrs;
  const canBowlReview=humanControlsBowlDrs&&st.pendingDismissal&&!st.pendingDismissal.givenOut&&!st.pendingDismissal.noDrs&&st.bowlingReviewsLeft>0;
  const showBowlDrs=humanControlsBowlDrs&&st.pendingDismissal&&!st.pendingDismissal.givenOut&&!st.pendingDismissal.noDrs;
  const batRevTag=`${st.reviewsLeft} left`;
  const bowlRevTag=`${st.bowlingReviewsLeft} left`;

  if(result) return renderResultScreen(result);
  if(st.done&&st.innings===1) return renderInningsBrakeScreen();

  // Build last few log entries for commentary
  const commEntries=st.log.slice(0,5).reverse();

  return`
${renderScoreBar()}
${renderOverPips()}

<!-- Commentary feed -->
<div style="background:var(--dark);border-radius:var(--r);padding:18px 16px;margin-bottom:10px;min-height:120px;display:flex;flex-direction:column;justify-content:center">
  ${commEntries.map((e,i)=>{
    const isLatest=i===commEntries.length-1;
    const isBig=isLatest&&(e.cls==='boundary'||e.cls==='wkt'||e.cls==='howzat');
    return`<div style="
      font-size:${isBig?'22px':isLatest?'16px':'11px'};
      color:${e.cls==='boundary'?'#C9D8B6':e.cls==='wkt'?'#E8B4A0':e.cls==='howzat'?'var(--gold-light)':isLatest?'var(--cream)':'rgba(255,255,255,.4)'};
      margin-bottom:${isLatest?'0':'5px'};
      font-weight:${isLatest?'600':'400'};
      font-family:${isBig?'Playfair Display,serif':'inherit'};
      text-align:${isBig?'center':'left'};
      line-height:1.3;
    ">${e.msg}</div>`;
  }).join('')}
</div>

<!-- Dismissal decisions -->
${st.pendingDismissal&&st.pendingDismissal.givenOut?`
<div class="pending-box">
  <div class="pending-title">[=] ${getDismissalFlavour(bat?.runs||0)} -- ${st.pendingDismissal.dtype}</div>
  <div class="pending-sub">${bat?.name||'Batsman'} given out by ${st.pendingDismissal.ump.name} . ${st.pendingDismissal.ump.quality}${st.pendingDismissal.noDrs?' . No DRS':''}</div>
  <div class="pending-btns">
    ${!isCpuBatting()?`
    <button class="btn btn-danger" onclick="acceptAndReturn()">Accept -- Out</button>
    ${showBatDrs?`<button class="btn btn-gold" onclick="callReview()" ${!canBatReview?'disabled':''}>DRS (${batRevTag})</button>`:''}`:`
    <div style="font-size:11px;color:var(--mid);font-style:italic">CPU deciding...</div>`}
  </div>
</div>`:st.pendingDismissal&&!st.pendingDismissal.givenOut?`
<div class="pending-box" style="border-color:var(--green);background:var(--green-pale)">
  <div class="pending-title" style="color:var(--green)">? Not Out -- ${st.pendingDismissal.dtype}</div>
  <div class="pending-sub">${st.pendingDismissal.ump.name} . ${st.pendingDismissal.ump.quality} -- ${st.pendingDismissal.notOutMsg||'turned it down'}</div>
  ${st.pendingDismissal.verdictMsg?`<div class="pending-sub" style="margin-top:4px;font-style:italic">${st.pendingDismissal.verdictMsg}</div>`:''}
  <div class="pending-btns" style="margin-top:8px">
    <button class="btn btn-green" onclick="dismissNotOutAndReturn()">Continue Playing</button>
    ${showBowlDrs?`<button class="btn btn-gold" onclick="callReview()" ${!canBowlReview?'disabled':''}>DRS (${bowlRevTag})</button>`:''}
  </div>
</div>`:''}

<!-- Next ball -- only when no pending decision -->
${!st.pendingDismissal&&!st.pendingWicket?`
<button class="btn btn-primary" style="width:100%;font-size:15px;padding:12px" onclick="nextBall()">
  Next ball ->
</button>`:''}

${st.pendingWicket?renderPendingWicket():''}`;
}

function acceptAndReturn(){mpClearActionTimer();
  acceptDismissal();
  // Stay on commentary -- human taps Next ball to go back to bowling screen
  // (pendingWicket will be handled by renderCommentaryScreen)
  render();
}

function dismissNotOutAndReturn(){
  dismissNotOut();
  st.gameScreen='bowling';
  render();
}

function nextBall(){
  if(st.pendingWicket){
    render();
    return;
  }
  st.gameScreen='bowling';
  render(); // pushes to Firebase -- both players go back to their screens
}

function renderPendingWicket(){
  if(isCpuBatting()){
    // CPU batting -- auto-send next, no human choice shown
    setTimeout(()=>{if(st.pendingWicket)sendNextAndReturn();},600);
    return`<div class="pending-box" style="border-color:var(--red);background:var(--red-pale)">
      <div class="pending-title" style="color:var(--red)">[bat] Wicket!</div>
      <div style="font-size:11px;color:var(--mid);font-style:italic;margin-top:4px">Next batsman coming in...</div>
    </div>`;
  }
  return`<div class="pending-box" style="border-color:var(--red);background:var(--red-pale)">
  <div class="pending-title" style="color:var(--red)">[bat] Wicket! Who bats next?</div>
  <div class="pending-btns" style="margin-top:8px;flex-wrap:wrap">
    <button class="btn btn-primary" onclick="sendNextAndReturn()" style="flex:1">Next Batsman</button>
    <button class="btn" onclick="st._choosingBatsman=true;render()" style="flex:1">Choose</button>
  </div>
  ${st._choosingBatsman?`<div style="margin-top:10px;display:flex;flex-direction:column;gap:5px">
    ${st.batsmen.filter(b=>b.status==='waiting').map(b=>`
    <button class="btn" style="text-align:left;padding:8px 12px" onclick="sendBatsmanAndReturn(${b.id})">
      <strong>${b.name}</strong> <span style="font-size:11px;color:var(--mid)">${'*'.repeat(b.stars)}</span>
    </button>`).join('')}
  </div>`:''}
</div>`;
}

function sendNextAndReturn(){
  sendNextBatsman();
  st.gameScreen='bowling';
  render();
}

function sendBatsmanAndReturn(id){
  sendBatsman(id);
  st.gameScreen='bowling';
  render();
}

function renderInningsBrakeScreen(){
  return`
${renderScoreBar()}
<div class="innings-banner">
  <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:600;margin-bottom:5px">First innings -- ${st.runs}/${st.wickets}</div>
  <div style="font-size:13px;color:var(--mid);margin-bottom:12px">${getFieldingTeamObj().name} need ${st.runs+1} to win</div>
  <button class="btn btn-green" style="width:100%" onclick="startSecondInnings()">Begin second innings -></button>
</div>`;
}

function renderResultScreen(result){
  return`
${renderScoreBar()}
<div class="result-banner ${result.cls}">
  <div class="result-title">${result.text}</div>
  <div style="margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
    <button class="btn btn-sm" onclick="resetGame()">Play again</button>
    <button class="btn btn-sm" style="background:var(--mid)" onclick="copyTranscript()">[clip] Transcript</button>
  </div>
</div>`;
}

function renderGame(){
  const ot=getOverType();
  const bwl=st.bowler?getBowlersForInnings().find(b=>b.id===st.bowler):null;
  const bat=st.batsmen[st.activeBat[0]];
  const fat=getFieldFatigue();
  const mustChange=st.mustChangeBowler;
  const fo=FIELD_OPTS.find(f=>f.id===st.field);
  const needRuns=st.innings===2&&st.team1Score!==null?st.team1Score+1-st.runs:null;
  const ballsLeft=Math.max(0,(10-st.over+1)*6-st.ball);
  const result=getMatchResult();
  const humanControlsBatDrs = !isCpuBatting(); // human controls batting DRS when human is batting
  const humanControlsBowlDrs = !isCpuBowling(); // human controls bowling DRS when human is bowling
  const canBatReview=humanControlsBatDrs&&st.pendingDismissal&&st.pendingDismissal.givenOut&&!st.pendingDismissal.noDrs&&st.reviewsLeft>0;
  const showBatDrs=humanControlsBatDrs&&st.pendingDismissal&&st.pendingDismissal.givenOut&&!st.pendingDismissal.noDrs;
  const canBowlReview=humanControlsBowlDrs&&st.pendingDismissal&&!st.pendingDismissal.givenOut&&!st.pendingDismissal.noDrs&&st.bowlingReviewsLeft>0;
  const showBowlDrs=humanControlsBowlDrs&&st.pendingDismissal&&!st.pendingDismissal.givenOut&&!st.pendingDismissal.noDrs;
  const pitch=PITCH_OPTS.find(p=>p.id===st.pitchId);
  const weather=WEATHER_OPTS.find(w=>w.id===st.weatherId);
  const batRevTag=st.reviewsLeft>0?`<span class="tag tag-gold">Bat ${st.reviewsLeft}</span>`:`<span class="tag tag-red">Bat 0</span>`;
  const bowlRevTag=st.bowlingReviewsLeft>0?`<span class="tag tag-gold">Bowl ${st.bowlingReviewsLeft}</span>`:`<span class="tag tag-red">Bowl 0</span>`;
  const batDieCls=st.batDie!=null?(st.batDie==='0'?' wkt':(parseInt(st.batDie)>=4?' boundary':' active')):'';
  const latestLog=st.log.length>0?st.log[0]:{msg:'Select a bowler and field, then deliver',cls:''};
  const t1name=getMatchTeam(1).name, t2name=getMatchTeam(2).name;
  const t1pers=getMatchTeam(1).personality||'Balanced';
  const t2pers=getMatchTeam(2).personality||'Balanced';
  const curTeamName=getBattingTeam().name;
  return`
<!-- Conditions -->
<div class="cond-bar">
  <div><div class="cond-label">Pitch</div><div class="cond-val">${pitch.icon} ${pitch.label}</div></div>
  <div class="cond-sep">.</div>
  <div><div class="cond-label">Weather</div><div class="cond-val">${weather.icon} ${weather.label}</div></div>
  <div style="flex:1"></div>
  <button class="btn btn-sm" onclick="openSettings()" style="margin-right:4px">??</button>
  <button class="btn btn-sm" onclick="copyTranscript()" style="margin-right:4px" title="Copy match transcript">[clip]</button>
  <button class="btn btn-sm" onclick="resetGame()">New</button>
</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:11px">
  <div><span style="color:var(--ink);font-weight:600">${t1name}</span> <span class="tag tag-mid">${t1pers}</span></div>
  <div style="color:var(--mid);font-size:10px">vs</div>
  <div><span class="tag tag-mid">${t2pers}</span> <span style="color:var(--ink);font-weight:600">${t2name}</span></div>
</div>

${result?`<div class="result-banner ${result.cls}"><div class="result-title">${result.text}</div><div style="margin-top:8px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn btn-sm" onclick="resetGame()">Play again</button><button class="btn btn-sm" style="background:var(--mid)" onclick="copyTranscript()">[clip] Copy transcript</button></div></div>`:''}

${st.innings===2&&st.team1Score!==null?`
<div class="target-banner">
  <div><div style="font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--mid);margin-bottom:1px">Team 1 scored</div>
  <div class="target-score">${st.team1Score}/${st.team1Wickets}</div></div>
  <div style="font-size:12px;color:var(--mid)">${!st.done?`Need <strong style="color:var(--green)">${Math.max(0,needRuns)}</strong> from <strong style="color:var(--green)">${ballsLeft}</strong> balls`:'Innings complete'}</div>
</div>`:''}

<!-- Umpire strip -->
<div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">
  <span style="font-size:8px;letter-spacing:.15em;text-transform:uppercase;color:var(--mid);margin-right:2px">Umpires</span>
  ${st.umpires.map((u,i)=>`<span style="font-size:10px;padding:2px 8px;border-radius:2px;border:1px solid ${st.activeUmpIdx===i?'var(--dark)':'var(--border)'};background:${st.activeUmpIdx===i?'var(--dark)':'transparent'};color:${st.activeUmpIdx===i?'var(--cream)':'var(--mid)'}">${u.name} . ${u.quality}${st.activeUmpIdx===i?' *':''}</span>`).join('')}
  <div style="flex:1"></div>
  <span style="font-size:9px;color:var(--mid)">${batRevTag} ${bowlRevTag}</span>
</div>

<!-- Score + Batsmen at crease -->
<div style="display:flex;gap:8px;margin-bottom:10px;align-items:stretch">
  <div class="scoreboard" style="margin-bottom:0;flex:1.2;align-content:center">
    <div style="grid-column:span 2"><div class="sb-label">Score</div><div class="sb-val runs">${st.runs}<span style="font-size:16px;opacity:.6">/${st.wickets}</span></div></div>
    <div><div class="sb-label">Over</div><div class="sb-val">${Math.min(st.over,10)}.${st.ball}</div></div>
    <div><div class="sb-label">Type</div><div class="sb-val sm"><span class="tag tag-mid">${ot}</span><br><span style="font-size:9px;color:var(--light);margin-top:1px;display:block">${st.innings===1?'1st':'2nd'}</span></div></div>
  </div>
  <!-- Two batsmen at crease + mentality -->
  <div style="flex:1;display:flex;flex-direction:column;gap:5px;justify-content:center">
    ${st.activeBat.map(idx=>{const b=st.batsmen[idx];const m=st.mentalities[idx]||'positive';const mObj=MENTALITIES.find(x=>x.id===m);const isStriker=idx===st.activeBat[0];return`
    <div style="padding:6px 10px;border:1px solid var(--dark);border-radius:var(--r);background:var(--dark);color:var(--cream)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${isStriker?'5px':'0'}">
        <div>
          <div style="font-family:'Playfair Display',serif;font-size:12px;font-weight:600">${b.name}${isStriker?' *':''}</div>
          <div style="font-size:9px;color:var(--light)">${b.hand}H${b.batSpecialism&&b.batSpecialism!=='none'?' . '+BAT_SPECIALISM_SHORT[b.batSpecialism]:''}</div>
        </div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:600;color:#C9D8B6">${b.runs}</div>
      </div>
      ${isStriker?`<div style="display:flex;gap:4px;flex-wrap:wrap">
        ${MENTALITIES.map(men=>`<button style="padding:3px 7px;font-size:10px;border:1px solid ${m===men.id?'var(--gold-light)':'rgba(255,255,255,.2)'};border-radius:2px;background:${m===men.id?'var(--gold-pale)':'transparent'};color:${m===men.id?'var(--gold)':'var(--light)'};cursor:pointer;font-family:Source Serif 4,serif;touch-action:manipulation"
          onclick="setMentality(${idx},'${men.id}')" ${isCpuBatting()?'disabled style="opacity:0.4"':''}>${men.icon} ${men.label}</button>`).join('')}
      </div>
      ${st.momentum>0?`<div style="margin-top:4px;display:flex;align-items:center;gap:5px">
        <div style="font-size:8px;letter-spacing:.1em;text-transform:uppercase;color:${st.momentum>=7?'#E8B4A0':st.momentum>=4?'var(--gold-light)':'var(--light)'}">Momentum</div>
        <div style="flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.15);overflow:hidden">
          <div style="height:100%;border-radius:2px;width:${Math.round(st.momentum/MOMENTUM_CAP*100)}%;background:${st.momentum>=7?'#E8B4A0':st.momentum>=4?'var(--gold-light)':'#C9D8B6'};transition:width .3s"></div>
        </div>
        <div style="font-size:9px;color:${st.momentum>=7?'#E8B4A0':st.momentum>=4?'var(--gold-light)':'var(--light)'}">${Math.round(st.momentum)}</div>
      </div>`:''}
      `:'<div style="font-size:9px;color:var(--light);margin-top:2px">'+mObj.icon+' '+mObj.label+' . Non-striker</div>'}
    </div>`;}).join('')}
  </div>
</div>

<!-- Pending wicket -- batting team chooses next batsman -->
${st.pendingWicket?`
<div class="pending-box" style="border-color:var(--red);background:var(--red-pale)">
  <div class="pending-title" style="color:var(--red)">[bat] Wicket! Who&#39;s coming in?</div>
  <div class="pending-btns" style="margin-top:8px;flex-wrap:wrap">
    <button class="btn btn-primary" onclick="sendNextBatsman()" style="flex:1">Next Batsman</button>
    <button class="btn" onclick="st._choosingBatsman=true;render()" style="flex:1">Choose Batsman</button>
  </div>
  ${st._choosingBatsman?`<div style="margin-top:10px;display:flex;flex-direction:column;gap:5px">
    ${st.batsmen.filter(b=>b.status==='waiting').map(b=>`
    <button class="btn" style="text-align:left;padding:8px 12px" onclick="sendBatsman(${b.id})">
      <strong>${b.name}</strong> <span style="font-size:11px;color:var(--mid)">${'*'.repeat(b.stars)}</span>
    </button>`).join('')}
  </div>`:''}
</div>`:''}

<!-- Commentary banner -->
<div class="commentary">
  <div class="comm-text ${latestLog.cls}">${latestLog.msg}</div>
</div>

<!-- Next Delivery button -->
${!st.done&&!st.pendingDismissal&&!st.pendingWicket?`
<div style="margin-bottom:10px">
  <button class="btn btn-primary" onclick="rollBat()" ${!st.bowler||st.mustChangeBowler?'disabled':''}>Next Delivery</button>
</div>`:''}

${st.done&&st.innings===1&&!result?`
<div class="innings-banner">
  <div style="font-family:'Playfair Display',serif;font-size:16px;font-weight:600;margin-bottom:5px">First innings -- ${st.runs}/${st.wickets}</div>
  <div style="font-size:12px;color:var(--mid);margin-bottom:10px">Team 2 need ${st.runs+1} to win</div>
  <button class="btn btn-green" onclick="startSecondInnings()">Begin second innings</button>
</div>`:''}

${st.pendingDismissal&&st.pendingDismissal.givenOut?`
<div class="pending-box">
  <div class="pending-title">[=] ${getDismissalFlavour(bat.runs)} -- ${st.pendingDismissal.dtype}</div>
  <div class="pending-sub">${bat.name} given out by ${st.pendingDismissal.ump.name}${st.pendingDismissal.noDrs?' . No review possible':''}</div>
  <div class="pending-btns">
    ${!isCpuBatting()?`<button class="btn btn-danger" onclick="acceptDismissal()">Continue Playing</button>`:`<div style="font-size:11px;color:var(--mid);font-style:italic">CPU deciding...</div>`}
    ${showBatDrs?`<button class="btn btn-gold" onclick="callReview()" ${!canBatReview?'disabled':''}>DRS ${batRevTag}</button>`:''}
  </div>
</div>`:st.pendingDismissal&&!st.pendingDismissal.givenOut?`
<div class="pending-box" style="border-color:var(--green);background:var(--green-pale)">
  <div class="pending-title" style="color:var(--green)">? Not Out -- ${st.pendingDismissal.dtype}</div>
  <div class="pending-sub">${st.pendingDismissal.notOutMsg||st.pendingDismissal.ump.name+' turned it down'}</div>
  ${st.pendingDismissal.verdictMsg?`<div class="pending-sub" style="margin-top:4px;font-style:italic">${st.pendingDismissal.verdictMsg}</div>`:''}
  <div class="pending-btns" style="margin-top:8px">
    ${!isCpuBowling()?`<button class="btn btn-green" onclick="dismissNotOut()">Continue Playing</button>`:`<div style="font-size:11px;color:var(--mid);font-style:italic">CPU deciding...</div>`}
    ${showBowlDrs?`<button class="btn btn-gold" onclick="callReview()" ${!canBowlReview?'disabled':''}>DRS ${bowlRevTag}</button>`:''}
  </div>
</div>`:``}

<!-- Bowler + Field -->
${!st.done?`
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
  <div class="card${mustChange?' must-change':''}" style="flex:1;margin-bottom:0">
    <div class="card-title">${mustChange?'? Must change bowler':'Bowler'}</div>
    ${bwl?`
    <div style="font-family:'Playfair Display',serif;font-size:15px;font-weight:600;margin-bottom:3px">${bwl.name}</div>
    <div style="font-size:12px;color:var(--mid);margin-bottom:6px">
      ${'*'.repeat(Math.min(5,bwl.stars+(getSpecialistBonus(bwl)||0)+(getInherentBonus(bwl)||0)))}
      . ${bwl.type}.${bwl.hand}H
      ${bwl.speciality&&bwl.speciality!=='none'?'. '+bwl.speciality:''}
    </div>
    <div class="info-row">
      <span class="${getBowlerFavLabel(bwl).cls==='good'?'tag tag-green':getBowlerFavLabel(bwl).cls==='bad'?'tag tag-red':'tag tag-mid'}">${getBowlerFavLabel(bwl).label}</span>
      ${bwl.hand!==bat.hand?`<span class="tag tag-green">Arm angle</span>`:''}
      ${(getSpecialistBonus(bwl)+(getInherentBonus(bwl)||0))>0?`<span class="tag tag-gold">* In their element</span>`:''}
    </div>`:`<div style="font-size:13px;color:var(--mid)">No bowler selected</div>`}
    ${!isCpuBowling()?`<button class="btn btn-sm" style="margin-top:8px;width:100%" onclick="openBowlerScreen()">
      ${mustChange?'Select bowler ->':'Change bowler ->'}
    </button>`:`<div style="font-size:10px;color:var(--mid);font-style:italic;margin-top:6px">CPU is choosing the bowler</div>`}
  </div>
  <div class="card" style="flex:1;margin-bottom:0">
    <div class="card-title">Field${isCpuBowling()?` <span style="font-size:9px;color:var(--mid);font-weight:normal;letter-spacing:0">CPU</span>`:''}</div>
    <div style="display:flex;gap:4px;margin-bottom:4px">
      ${FIELD_OPTS.map(f=>`<button class="f-btn ${f.id}${st.field===f.id?' sel':''}" onclick="selectField('${f.id}')" ${st.done||st.pendingDismissal||isCpuBowling()?'disabled':''}>${f.label}</button>`).join('')}
    </div>
    ${isCpuBowling()?`<div style="font-size:10px;color:var(--mid);font-style:italic">CPU is setting the field</div>`:''}
  </div>
</div>`:''}

<!-- Over pips -->
<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
  <div style="font-size:13px;color:var(--mid)">Over ${Math.min(st.over,10)} -- ${6-st.ball} ball${6-st.ball!==1?'s':''} left</div>
  <div class="pips">
    ${Array.from({length:6},(_,i)=>{const p=st.overBalls[i];return`<div class="pip${p?(' '+(p.type==='wkt'?'wkt':p.type==='boundary'?'boundary':'done')):''}"></div>`;}).join('')}
  </div>
</div>
`;}

function getMediumFavLabel(){
  const isFinisher = st.bowler && getBowlersForInnings().find(b=>b.id===st.bowler)?.speciality==='finisher';
  if(st.weatherId==='damp') return {label:'Favourable', cls:'good'};
  if(st.over<=3) return {label:'Unfavourable', cls:'bad'};
  if(st.over>=9 && !isFinisher) return {label:'Unfavourable', cls:'bad'};
  if(st.over>=9 && isFinisher) return {label:'Favourable', cls:'good'};
  return {label:'Neutral', cls:'neutral'};
}

function getBowlerFavLabel(b){
  if(b.type==='medium'){
    const isFinisher=b.speciality==='finisher';
    if(st.weatherId==='damp') return {label:'Favourable', cls:'good'};
    if(st.over<=3) return {label:'Unfavourable', cls:'bad'};
    if(st.over>=9&&!isFinisher) return {label:'Unfavourable', cls:'bad'};
    if(st.over>=9&&isFinisher) return {label:'Favourable', cls:'good'};
    return {label:'Neutral', cls:'neutral'};
  }
  const ot=getOverType();
  if(b.type===ot) return {label:'Favourable', cls:'good'};
  return {label:'Unfavourable', cls:'bad'};
}

function renderBowlerScreen(){
  const bowlers=getBowlersForInnings();
  const ot=getOverType();
  const bat=st.batsmen[st.activeBat[0]];
  return`<div class="bowler-overlay">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <button class="btn btn-sm" onclick="closeBowlerScreen()"><- Back</button>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:600;flex:1">Choose Bowler</div>
      <div style="font-size:12px;color:var(--mid)">Over ${st.over} . ${ot} phase</div>
    </div>
    ${bowlers.map(b=>{
      const overs=st.bowlerOvers[b.id]||0;
      const stats=st.bowlStats[b.id]||{balls:0,runs:0,wkts:0};
      const used2=overs>=2;
      const isSel=st.bowler===b.id;
      const fav=getBowlerFavLabel(b);
      const specBonus=getSpecialistBonus(b);
      const inherBonus=getInherentBonus(b);
      const totalBonus=specBonus+inherBonus;
      const handAdv=b.hand!==bat.hand;
      return`<div class="bowler-card${isSel?' sel':''}${used2?' used':''}"
        onclick="${used2?'':'selectBowlerFromScreen(&apos;'+b.id+'&apos;)'}">
        <div class="bowler-card-name">${b.name}${b.emergency?' *':''}</div>
        <div class="bowler-card-detail">
          ${'*'.repeat(Math.min(5,b.stars+totalBonus))}${totalBonus>0?` (+${totalBonus}*)`:''}
          . ${b.type}.${b.hand}H
          ${b.speciality&&b.speciality!=='none'?`. ${b.speciality}`:''}
          <span class="bowler-fav ${fav.cls}">${fav.label}</span>
          ${handAdv?`<span class="bowler-fav good">Arm angle</span>`:''}
          ${used2?`<span class="bowler-fav bad">Used up</span>`:''}
        </div>
        <div class="bowler-card-stats">
          <div><div class="bowler-stat-val">${overs}/2</div><div class="bowler-stat-label">Overs</div></div>
          <div><div class="bowler-stat-val">${stats.balls}</div><div class="bowler-stat-label">Balls</div></div>
          <div><div class="bowler-stat-val">${stats.runs}</div><div class="bowler-stat-label">Runs</div></div>
          <div><div class="bowler-stat-val">${stats.wkts}</div><div class="bowler-stat-label">Wickets</div></div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function openBowlerScreen(){ bowlerScreenOpen=true; render(); }
function closeBowlerScreen(){ bowlerScreenOpen=false; render(); }
function selectBowlerFromScreen(id){
  selectBowler(id);
  bowlerScreenOpen=false;
  render();
}
function renderHistoryScreen(){
  const fmt=(iso)=>{
    const d=new Date(iso);
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  };
  const avgBy=(key,opts)=>opts.map(opt=>{
    const matches=matchHistory.filter(m=>m[key]===opt.id);
    if(!matches.length)return null;
    const avg1=Math.round(matches.reduce((s,m)=>s+m.inn1runs,0)/matches.length);
    const avg2=Math.round(matches.reduce((s,m)=>s+m.inn2runs,0)/matches.length);
    const avgWkt=Math.round(matches.reduce((s,m)=>s+(m.inn1wkts+m.inn2wkts)/2,0)/matches.length);
    return{label:opt.label,icon:opt.icon||'',count:matches.length,avg1,avg2,avgWkt,avgAll:Math.round((avg1+avg2)/2)};
  }).filter(Boolean);
  const pitchAvgs=avgBy('pitch',PITCH_OPTS);
  const weatherAvgs=avgBy('weather',WEATHER_OPTS);
  const overall=matchHistory.length>0?{
    avg1:Math.round(matchHistory.reduce((s,m)=>s+m.inn1runs,0)/matchHistory.length),
    avg2:Math.round(matchHistory.reduce((s,m)=>s+m.inn2runs,0)/matchHistory.length),
    wkt1:Math.round(matchHistory.reduce((s,m)=>s+m.inn1wkts,0)/matchHistory.length),
    wkt2:Math.round(matchHistory.reduce((s,m)=>s+m.inn2wkts,0)/matchHistory.length),
    t1wins: matchHistory.filter(m=>m.resultCls==='result-loss').length,
    t2wins: matchHistory.filter(m=>m.resultCls==='result-win').length,
    ties:   matchHistory.filter(m=>m.resultCls==='result-tie').length,
    avgMarginRuns: (()=>{
      const t1w=matchHistory.filter(m=>m.resultCls==='result-loss');
      if(!t1w.length) return null;
      return Math.round(t1w.reduce((s,m)=>s+(m.inn1runs-m.inn2runs),0)/t1w.length);
    })(),
    avgMarginWkts: (()=>{
      const t2w=matchHistory.filter(m=>m.resultCls==='result-win');
      if(!t2w.length) return null;
      return Math.round(t2w.reduce((s,m)=>s+(11-m.inn2wkts),0)/t2w.length);
    })(),
  }:null;

  return`<div class="te-overlay">
    <div class="te-header">
      <button class="btn btn-sm" onclick="closeHistory()"><- Back</button>
      <div class="te-title">Match History</div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:12px;color:var(--mid)">${matchHistory.length}/50</span>
        <button class="btn btn-sm btn-gold" onclick="exportStatsXlsx()" ${!matchHistory.length?'disabled':''}>v xlsx</button>
      </div>
    </div>
    ${matchHistory.length===0?`<div style="text-align:center;padding:40px;color:var(--mid);font-style:italic">No matches recorded yet</div>`:`
    ${overall?`<div class="card" style="margin-bottom:10px">
      <div class="card-title">Overall Averages (${matchHistory.length} matches)</div>
      <div style="display:flex;gap:20px">
        <div style="text-align:center"><div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:600">${overall.avg1}<span style="font-size:14px;opacity:.6">/${overall.wkt1}</span></div><div style="font-size:10px;color:var(--mid);text-transform:uppercase;letter-spacing:.08em">1st Innings</div></div>
        <div style="text-align:center"><div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:600">${overall.avg2}<span style="font-size:14px;opacity:.6">/${overall.wkt2}</span></div><div style="font-size:10px;color:var(--mid);text-transform:uppercase;letter-spacing:.08em">2nd Innings</div><div style="font-size:9px;color:var(--mid);font-style:italic;margin-top:2px">lower -- chases end early</div></div>
        <div style="text-align:center"><div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:600">${Math.round((overall.avg1+overall.avg2)/2)}</div><div style="font-size:10px;color:var(--mid);text-transform:uppercase;letter-spacing:.08em">Combined</div></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:10px 0">
      <div style="display:flex;gap:16px;align-items:center">
        <div style="flex:1;text-align:center">
          <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:600;color:var(--red)">${overall.t1wins}<span style="font-size:12px;font-weight:400;margin-left:2px">(${Math.round(overall.t1wins/matchHistory.length*100)}%)</span></div>
          <div style="font-size:10px;color:var(--mid);text-transform:uppercase;letter-spacing:.08em">Bat 1st wins</div>
          ${overall.avgMarginRuns!==null?`<div style="font-size:10px;color:var(--mid);margin-top:2px">avg by ${overall.avgMarginRuns} runs</div>`:''}
        </div>
        <div style="text-align:center;font-size:11px;color:var(--mid)">${overall.ties>0?`${overall.ties} tied`:'--'}</div>
        <div style="flex:1;text-align:center">
          <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:600;color:var(--green)">${overall.t2wins}<span style="font-size:12px;font-weight:400;margin-left:2px">(${Math.round(overall.t2wins/matchHistory.length*100)}%)</span></div>
          <div style="font-size:10px;color:var(--mid);text-transform:uppercase;letter-spacing:.08em">Bat 2nd wins</div>
          ${overall.avgMarginWkts!==null?`<div style="font-size:10px;color:var(--mid);margin-top:2px">avg by ${overall.avgMarginWkts} wkts</div>`:''}
        </div>
      </div>
    </div>`:''}
    ${pitchAvgs.length>0?`<div class="card" style="margin-bottom:10px">
      <div class="card-title">Average Score by Pitch</div>
      ${pitchAvgs.map(p=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="min-width:90px;font-size:13px">${p.label}</span>
        <div style="flex:1;background:var(--border);border-radius:2px;height:6px;overflow:hidden">
          <div style="width:${Math.min(100,p.avgAll/140*100)}%;height:100%;background:var(--dark);border-radius:2px"></div>
        </div>
        <span style="font-family:'Playfair Display',serif;font-size:14px;font-weight:600;min-width:50px;text-align:right">${p.avgAll}/${p.avgWkt}</span>
        <span style="font-size:11px;color:var(--mid)">(${p.count})</span>
      </div>`).join('')}
    </div>`:''}
    ${weatherAvgs.length>0?`<div class="card" style="margin-bottom:10px">
      <div class="card-title">Average Score by Weather</div>
      ${weatherAvgs.map(w=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="min-width:90px;font-size:13px">${w.icon} ${w.label}</span>
        <div style="flex:1;background:var(--border);border-radius:2px;height:6px;overflow:hidden">
          <div style="width:${Math.min(100,w.avgAll/140*100)}%;height:100%;background:var(--dark);border-radius:2px"></div>
        </div>
        <span style="font-family:'Playfair Display',serif;font-size:14px;font-weight:600;min-width:50px;text-align:right">${w.avgAll}/${w.avgWkt}</span>
        <span style="font-size:11px;color:var(--mid)">(${w.count})</span>
      </div>`).join('')}
    </div>`:''}
    <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--mid);margin-bottom:8px">All Matches</div>
    ${matchHistory.map(m=>`
    <div style="border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:8px;background:var(--parchment)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3px">
        <div style="font-family:'Playfair Display',serif;font-size:14px;font-weight:600">${m.team1} vs ${m.team2}</div>
        <div style="font-size:10px;color:var(--mid)">${fmt(m.date)}</div>
      </div>
      <div style="font-size:11px;color:var(--mid);margin-bottom:5px">
        ${PITCH_OPTS.find(p=>p.id===m.pitch)?.icon||''} ${PITCH_OPTS.find(p=>p.id===m.pitch)?.label||m.pitch}
        . ${WEATHER_OPTS.find(w=>w.id===m.weather)?.icon||''} ${WEATHER_OPTS.find(w=>w.id===m.weather)?.label||m.weather}
        . Profile ${m.profile1}/${m.profile2}
      </div>
      <div style="display:flex;gap:14px;margin-bottom:4px">
        <div style="font-size:13px"><span style="color:var(--mid)">1st:</span> <strong>${m.inn1runs}/${m.inn1wkts}</strong></div>
        <div style="font-size:13px"><span style="color:var(--mid)">2nd:</span> <strong>${m.inn2runs}/${m.inn2wkts}</strong></div>
      </div>
      <div style="font-size:12px;font-style:italic;color:var(--${m.resultCls==='result-win'?'green':m.resultCls==='result-loss'?'red':'blue'})">${m.result}</div>
    </div>`).join('')}
    <button class="btn btn-danger" style="width:100%;margin-top:6px" onclick="clearHistory()">Clear all history</button>
    `}
  </div>`;
}
function exportStatsXlsx(){
  if(!matchHistory.length){ showToast('No match history to export'); return; }
  const wb = XLSX.utils.book_new();

  // -- Sheet 1: Match List --
  const matchRows = matchHistory.map((m,i)=>({
    '#': matchHistory.length - i,
    'Date': new Date(m.date).toLocaleString('en-GB'),
    'Team 1': m.team1,
    'Team 2': m.team2,
    'Pitch': PITCH_OPTS.find(p=>p.id===m.pitch)?.label||m.pitch,
    'Weather': WEATHER_OPTS.find(w=>w.id===m.weather)?.label||m.weather,
    'Profile 1st': m.profile1,
    'Profile 2nd': m.profile2,
    '1st Inn Runs': m.inn1runs,
    '1st Inn Wkts': m.inn1wkts,
    '2nd Inn Runs': m.inn2runs,
    '2nd Inn Wkts': m.inn2wkts,
    'Result': m.result,
    'Simulated': m.simulated?'Yes':'No',
  }));
  const ws1 = XLSX.utils.json_to_sheet(matchRows);
  ws1['!cols'] = [4,12,16,16,12,12,10,10,12,12,12,12,36,10].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws1, 'Match List');

  // -- Sheet 2: Averages by Condition --
  const pitchLabels = PITCH_OPTS.map(p=>p.label);
  const weatherLabels = WEATHER_OPTS.map(w=>w.label);
  const condRows = [];
  // Header
  condRows.push(['Pitch \\ Weather', ...weatherLabels, 'Pitch Avg']);
  pitchLabels.forEach(pl=>{
    const row = [pl];
    let pitchTotal=0, pitchCount=0;
    weatherLabels.forEach(wl=>{
      const matches = matchHistory.filter(m=>
        (PITCH_OPTS.find(p=>p.id===m.pitch)?.label||m.pitch)===pl &&
        (WEATHER_OPTS.find(w=>w.id===m.weather)?.label||m.weather)===wl
      );
      if(matches.length){
        const avg = Math.round(matches.reduce((s,m)=>(s+(m.inn1runs+m.inn2runs)/2),0)/matches.length);
        row.push(avg);
        pitchTotal+=avg*matches.length; pitchCount+=matches.length;
      } else { row.push('--'); }
    });
    row.push(pitchCount>0?Math.round(pitchTotal/pitchCount):'--');
    condRows.push(row);
  });
  // Weather avg row
  const weatherAvgRow = ['Weather Avg'];
  weatherLabels.forEach(wl=>{
    const matches=matchHistory.filter(m=>(WEATHER_OPTS.find(w=>w.id===m.weather)?.label||m.weather)===wl);
    weatherAvgRow.push(matches.length?Math.round(matches.reduce((s,m)=>(s+(m.inn1runs+m.inn2runs)/2),0)/matches.length):'--');
  });
  const overall=matchHistory.length?Math.round(matchHistory.reduce((s,m)=>(s+(m.inn1runs+m.inn2runs)/2),0)/matchHistory.length):'--';
  weatherAvgRow.push(overall);
  condRows.push(weatherAvgRow);
  const ws2 = XLSX.utils.aoa_to_sheet(condRows);
  ws2['!cols'] = [16,...weatherLabels.map(()=>({wch:12})),{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Averages by Condition');

  // -- Sheet 3: Summary --
  const avg1=matchHistory.length?Math.round(matchHistory.reduce((s,m)=>s+m.inn1runs,0)/matchHistory.length):0;
  const avg2=matchHistory.length?Math.round(matchHistory.reduce((s,m)=>s+m.inn2runs,0)/matchHistory.length):0;
  const summaryRows=[
    ['Pub Cricket Captain -- Match Statistics'],
    ['Generated', new Date().toLocaleString('en-GB')],
    [''],
    ['Total Matches', matchHistory.length],
    ['Simulated', matchHistory.filter(m=>m.simulated).length],
    ['Played', matchHistory.filter(m=>!m.simulated).length],
    [''],
    ['Average 1st Innings', avg1],
    ['Average 2nd Innings', avg2],
    ['Combined Average', Math.round((avg1+avg2)/2)],
    [''],
    ['1st Inn Won', matchHistory.filter(m=>m.resultCls==='result-loss').length],
    ['2nd Inn Won', matchHistory.filter(m=>m.resultCls==='result-win').length],
    ['Tied', matchHistory.filter(m=>m.resultCls==='result-tie').length],
    [''],
    ['Highest 1st Inn', Math.max(...matchHistory.map(m=>m.inn1runs))],
    ['Lowest 1st Inn', Math.min(...matchHistory.map(m=>m.inn1runs))],
    ['Highest 2nd Inn', Math.max(...matchHistory.map(m=>m.inn2runs))],
    ['Lowest 2nd Inn', Math.min(...matchHistory.map(m=>m.inn2runs))],
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws3['!cols'] = [{wch:24},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws3, 'Summary');

  // Download
  XLSX.writeFile(wb, 'county-cricket-stats.xlsx');
  showToast('? Spreadsheet downloaded!');
}
window.exportStatsXlsx=exportStatsXlsx;

function openHistory(){ historyScreenOpen=true; render(); }
function closeHistory(){ historyScreenOpen=false; render(); }

// v8: profile selection removed -- single profile always used
function renderChooseProfile(inningsNum){ return ''; }

// -- Settings panel --
function renderSettings(){
  const p=profiles['A'];
  const pitchLabels=['Minefield','Good','Flat'];
  const weatherLabels=['Sunny','Overcast','Hot','Damp'];
  const starLabels=['*','**','***','****','*****'];

  // colour cell based on value
  function cellColor(v,isHowzat){
    if(isHowzat){
      if(v<=10)return'#C9D8B6';if(v<=25)return'#F5EDD6';if(v<=40)return'#F5E8E8';return'#E8B4A0';
    } else {
      if(v>=60)return'#C9D8B6';if(v>=35)return'#F5EDD6';if(v>=20)return'#F5E8E8';return'#E8B4A0';
    }
  }

  function gridHTML(tableKey, isHowzat){
    const data=p[tableKey];
    let h=`<table class="grid-table"><thead><tr><th class="row-label"></th>`;
    pitchLabels.forEach(pl=>{
      weatherLabels.forEach(wl=>{ h+=`<th style="font-size:7px">${pl.substring(0,3)}<br>${wl.substring(0,3)}</th>`; });
    });
    h+=`</tr></thead><tbody>`;
    starLabels.forEach((sl,si)=>{
      h+=`<tr><td class="row-label">${sl}</td>`;
      pitchLabels.forEach((_,pi)=>{
        weatherLabels.forEach((_,wi)=>{
          const v=data[si][pi][wi];
          h+=`<td><input class="grid-input" style="background:${cellColor(v,isHowzat)}" type="number" min="0" max="99" value="${v}" onchange="updateTable('A','${tableKey}',${si},${pi},${wi},this.value)"></td>`;
        });
      });
      h+=`</tr>`;
    });
    h+=`</tbody></table>`;
    return h;
  }

  const mods=profiles['A'].mods;
  const sliders=[
    {key:'dotBallPct',    label:'Dot ball howzat buff (% per dot)',  min:1, max:10},
    {key:'fastOverBonus', label:'Fast/spin in correct overs (% bonus)',min:0,max:30},
    {key:'wrongOverPen',  label:'Fast/spin in wrong overs (% penalty)',min:0,max:30},
    {key:'mediumPen',     label:'Medium pace penalty (%)',           min:0, max:30},
    {key:'handAngle',     label:'Opposite hand angle bonus (%)',     min:0, max:20},
    {key:'speciality',    label:'Opener/finisher speciality bonus (%)',min:0,max:25},
    {key:'hotFastBonus',  label:'Hot weather fast bowler bonus (%)', min:0, max:20},
    {key:'defFatigueThresh',label:'Defensive fatigue kicks in (balls)',min:1,max:20},
    {key:'defFatigueMod', label:'Defensive fatigue strength (%)',    min:0, max:30},
    {key:'attFatigueMod', label:'Attacking momentum strength (%)',   min:0, max:30},
  ];

  return`<div class="settings-overlay" onclick="closeSettingsIfBackground(event)">
  <div class="settings-panel" onclick="event.stopPropagation()">
    <div class="settings-title">?? Settings</div>
    <div class="settings-sub">Adjust engine tables and modifiers. Changes apply immediately and save automatically.</div>

    <div class="settings-section">Howzat % -- higher = bowlers more dangerous</div>
    <div style="font-size:9px;color:var(--mid);margin-bottom:6px">Rows: bowler quality *-***** . Columns: Pitch (Min/Good/Flat) ? Weather (Sun/Over/Hot/Damp)</div>
    ${gridHTML('howzat',true)}

    <div class="settings-section">Not Out % -- higher = batsmen harder to dismiss</div>
    <div style="font-size:9px;color:var(--mid);margin-bottom:6px">Rows: batsman quality *-***** . Same column order as above</div>
    ${gridHTML('notout',false)}

    <div class="settings-section">Modifiers</div>
    ${sliders.map(s=>`<div class="slider-row">
      <span class="slider-label">${s.label}</span>
      <input type="range" min="${s.min}" max="${s.max}" value="${mods[s.key]}" oninput="updateMod('A','${s.key}',this.value);this.nextElementSibling.textContent=this.value">
      <span class="slider-val">${mods[s.key]}</span>
    </div>`).join('')}

    <div class="settings-btns">
      <button class="btn btn-danger" onclick="resetProfile('A')">Reset to defaults</button>
      <button class="btn btn-gold" onclick="exportSettings()">Export</button>
      <button class="btn btn-primary" onclick="closeSettings()" style="flex:2">Done</button>
    </div>
  </div>
</div>`;
}

// -- Settings functions --
function openSettings(){settingsOpen=true;render();}
function closeSettings(){settingsOpen=false;render();}
function closeSettingsIfBackground(e){if(e.target===e.currentTarget){closeSettings();}}
function switchSettingsTab(k){} // v8: single profile, no tabs
function updateProfileName(k,v){} // v8: removed
function updateTable(profileKey,tableKey,si,pi,wi,v){
  profiles[profileKey][tableKey][si][pi][wi]=parseInt(v)||0;
  saveProfiles();
}
function updateMod(profileKey,key,v){
  profiles[profileKey].mods[key]=parseFloat(v);
  saveProfiles();
}
function copyProfile(fromKey,toKey){} // v8: removed
function resetProfile(k){
  profiles[k]=makeProfile(profiles[k].name,DEFAULT_HOWZAT,DEFAULT_NOTOUT,DEFAULT_MODS);
  saveProfiles();render();
}

function exportSettings(){
  const pitchLabels=['Minefield','Good','Flat'];
  const weatherLabels=['Sunny','Overcast','Hot','Damp'];
  const starLabels=['*','**','***','****','*****'];
  const modLabels={
    dotBallPct:    'Dot ball howzat buff (% per dot)',
    fastOverBonus: 'Fast/spin correct overs bonus (%)',
    wrongOverPen:  'Fast/spin wrong overs penalty (%)',
    mediumPen:     'Medium pace penalty (%)',
    handAngle:     'Opposite hand angle bonus (%)',
    speciality:    'Opener/finisher speciality bonus (%)',
    hotFastBonus:  'Hot weather fast bowler bonus (%)',
    defFatigueThresh: 'Defensive fatigue threshold (balls)',
    defFatigueMod: 'Defensive fatigue strength (%)',
    attFatigueMod: 'Attacking momentum strength (%)',
  };

  function tableText(tableKey, label, p){
    const data=p[tableKey];
    const header = '         ' + pitchLabels.map(pl=>weatherLabels.map(wl=>`${pl.substring(0,3)}/${wl.substring(0,3)}`).join('  ')).join('  ');
    const rows = starLabels.map((sl,si)=>{
      const vals = pitchLabels.map((_,pi)=>weatherLabels.map((_,wi)=>String(data[si][pi][wi]).padStart(3)).join(' ')).join('   ');
      return `  ${sl.padEnd(7)}${vals}`;
    });
    return `${label}:\n${header}\n${rows.join('\n')}`;
  }

  let out = `COUNTY CRICKET -- SETTINGS EXPORT\n${'='.repeat(48)}\n\n`;

  ['A'].forEach(k=>{
    const p=profiles[k];
    out+=`PROFILE ${k}: ${p.name}\n${'-'.repeat(40)}\n\n`;
    out+=tableText('howzat','HOWZAT %',p)+'\n\n';
    out+=tableText('notout','NOT OUT %',p)+'\n\n';
    out+='MODIFIERS:\n';
    Object.keys(modLabels).forEach(key=>{
      out+=`  ${modLabels[key].padEnd(42)} ${p.mods[key]}\n`;
    });
    out+='\n';
  });

  out+=`Generated: ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`;

  navigator.clipboard.writeText(out).then(()=>{
    showToast('Settings copied to clipboard!');
  }).catch(()=>{
    // Fallback -- show in a textarea
    showExportModal(out);
  });
}



function showExportModal(text){
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML=`<div style="background:var(--cream);border-radius:4px;padding:16px;max-width:500px;width:100%">
    <div style="font-family:Playfair Display,serif;font-size:16px;font-weight:600;margin-bottom:8px">Export Settings</div>
    <textarea readonly style="width:100%;height:260px;font-size:10px;font-family:monospace;border:1px solid var(--border);border-radius:4px;padding:8px;background:var(--parchment);resize:none">${text}</textarea>
    <div style="margin-top:10px;text-align:right"><button onclick="this.closest('div[style]').remove()" style="font-family:Source Serif 4,serif;padding:8px 18px;border:1px solid var(--border);border-radius:4px;background:var(--dark);color:var(--cream);cursor:pointer">Close</button></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('textarea').select();
}

// -- Team selection screen --
function renderSelectTeams(){
  const allTeams=[...STOCK_TEAMS,...customTeams];
  function teamPicker(slot, label){
    const current = matchTeams[slot];
    return`<div class="card" style="margin-bottom:10px">
      <div class="card-title">${label}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        ${(()=>{
          const left=allTeams.slice(0,4);
          const right=allTeams.slice(4,8);
          const makeCard=(t,i)=>{
            const sel=current&&current.name===t.name;
            const pColor=t.personality==='Chasing'?'#E8B4A0':t.personality==='Setting'?'#C9D8B6':'var(--border)';
            return '<div onclick="selectTeam(\"'+slot+'\",'+i+')" style="'
              +'padding:8px 6px;border:2px solid '+(sel?'var(--gold-light)':'var(--border)')+';'
              +'border-radius:var(--r);background:'+(sel?'var(--gold-pale)':'var(--parchment)')+';'
              +'cursor:pointer;text-align:center;">'
              +'<div style="font-size:11px;font-weight:600;line-height:1.2;margin-bottom:3px">'+t.name+'</div>'
              +'<div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:'+pColor+';font-weight:600">'+t.personality+'</div>'
              +'</div>';
          };
          let html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">';
          for(let i=0;i<Math.max(left.length,right.length);i++){
            html+=left[i]?makeCard(left[i],i):'<div></div>';
            html+=right[i]?makeCard(right[i],i+4):'<div></div>';
          }
          html+='</div>';
          return html;
        })()}
      </div>
      ${current?`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-family:'Playfair Display',serif;font-size:13px;font-weight:600">${current.name}</span>
        <span class="tag tag-mid">${current.personality||'Balanced'}</span>
      </div>
      <div style="font-size:11px;color:var(--mid)">
        ${current.players.map(p=>`${p.name}${p.isWk?'+':''}`).join(', ')}
      </div>`:'<div style="font-size:11px;color:var(--mid)">No team selected</div>'}
    </div>`;
  }
  return`<div>
    <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:600;margin-bottom:6px">Select Teams</div>
    <div style="font-size:12px;color:var(--mid);margin-bottom:14px;font-style:italic">Choose your squads or edit a custom team</div>
    ${teamPicker('t1','Team 1')}
    ${teamPicker('t2','Team 2')}
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button class="btn" style="flex:1" onclick="openTeamEditor(null)">+ New Team</button>
      ${customTeams.length>0?`<button class="btn" style="flex:1" onclick="openTeamEditorList()">Edit Teams</button>`:''}
    </div>
    <div style="border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:12px;background:var(--parchment)">
      <div class="card-title" style="margin-bottom:8px">Mode</div>
      <div style="display:flex;gap:6px">
        <button class="seg-btn${!st.cpuTeam?' active':''}" onclick="setCpuTeam(null);render()" style="flex:1">2 Players</button>
        <button class="seg-btn${st.cpuTeam==='t2'?' active':''}" onclick="setCpuTeam('t2');render()" style="flex:1">vs CPU</button>
        <button class="seg-btn${st.cpuTeam==='t1'?' active':''}" onclick="setCpuTeam('t1');render()" style="flex:1">CPU bats 1st</button>
      </div>
      ${st.cpuTeam==='t1'?`<div style="font-size:10px;color:var(--mid);margin-top:6px;font-style:italic">No toss -- CPU bats, you bowl</div>`:
        st.cpuTeam==='t2'?`<div style="font-size:10px;color:var(--mid);margin-top:6px;font-style:italic">Toss happens -- CPU plays Team 2</div>`:''}
    </div>
    <button class="btn btn-primary" style="width:100%" onclick="proceedToToss()" ${!matchTeams.t1||!matchTeams.t2?'disabled':''}>
      ${!matchTeams.t1||!matchTeams.t2?'Select both teams to continue':'Choose Conditions ->'}
    </button>

    <!-- Multiplayer -->
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
      <div class="card-title" style="margin-bottom:8px">[wifi] Online Multiplayer</div>
      ${mp&&mp.active?`
      <div style="padding:10px 12px;background:var(--green-pale);border:1px solid var(--green);border-radius:var(--r);margin-bottom:8px">
        <div style="font-size:12px;font-weight:600;color:var(--green)">Connected . ${mp.role==='host'?'You are hosting':'You joined'}</div>
        <div style="font-size:20px;font-weight:700;letter-spacing:.15em;text-align:center;margin:6px 0;font-family:'Playfair Display',serif">${mp.roomCode}</div>
        <div style="font-size:10px;color:var(--mid);text-align:center">${mp.role==='host'?'Share this code with your opponent':'Room code'}</div>
      </div>
      <button class="btn sec" style="width:100%;font-size:11px" onclick="mpLeave()">Leave room</button>
      `:`
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button class="btn" style="flex:1" onclick="mpCreateRoom()">Host game</button>
        <button class="btn" style="flex:1" onclick="mpShowJoin()">Join game</button>
      </div>
      <div id="mp-join-form" style="display:none">
        <input id="mp-code-input" type="text" maxlength="4" placeholder="ROOM CODE"
          style="width:100%;padding:10px;font-size:18px;letter-spacing:.2em;text-align:center;text-transform:uppercase;border:1px solid var(--border);border-radius:var(--r);font-family:'Playfair Display',serif;background:var(--cream);margin-bottom:6px">
        <button class="btn btn-primary" style="width:100%" onclick="mpJoinFromInput()">Join -></button>
      </div>
      <div style="font-size:10px;color:var(--mid);text-align:center">Host sees bowling screen . Guest sees batting screen</div>
      `}
    </div>
  </div>`;
}

function selectTeam(slot, idx){
  const allTeams=[...STOCK_TEAMS,...customTeams];
  matchTeams[slot]=allTeams[idx];
  render();
}

function setCpuTeam(slot){
  st.cpuTeam = slot;
  render();
}

function proceedToToss(){
  if(!matchTeams.t1||!matchTeams.t2)return;
  // Roll random conditions as default (player can change on conditions screen)
  const pitch=weightedRnd(PITCH_OPTS);
  const weather=weightedRnd(WEATHER_OPTS);
  st.pitchId=pitch.id;st.pitchIdx=pitch.idx;
  st.weatherId=weather.id;st.weatherIdx=weather.idx;
  st.phase='conditions';
  render();
}

function openTeamEditorList(){
  // Show list of custom teams to pick for editing
  teamEditorOpen='list';
  render();
}

function openTeamEditor(idx){
  if(idx===null){
    // New team
    teamEditorData={
      name:'New Team',
      players: Array.from({length:11},(_,i)=>makePlayer(i,`Player ${i+1}`,
        i<2?3:i<5?2:1,
        i<2?'Conservative':i<5?'Balanced':i<8?'Aggressive':'Slogger',
        i%2===0?'R':'L',
        i===3, // pos 4 is WK by default
        i>=6&&i<11, // last 5 are bowlers by default
        i>=6?Math.floor(18/5):1,
        i>=6?'fast':'fast',
        'none'
      )),
    };
    teamEditorIdx=null;
  } else {
    teamEditorData=JSON.parse(JSON.stringify(customTeams[idx]));
    teamEditorIdx=idx;
  }
  teamEditorOpen='editor';
  render();
}

function saveTeamEditor(){
  if(teamEditorIdx===null){
    customTeams.push(JSON.parse(JSON.stringify(teamEditorData)));
  } else {
    customTeams[teamEditorIdx]=JSON.parse(JSON.stringify(teamEditorData));
  }
  saveCustomTeams();
  teamEditorOpen=false;
  render();
}

function deleteCustomTeam(idx){
  if(confirm&&!confirm('Delete this team?'))return;
  customTeams.splice(idx,1);
  saveCustomTeams();
  teamEditorOpen=false;
  render();
}

function closeTeamEditor(){teamEditorOpen=false;render();}

// -- Drag to reorder --
function onDragStart(e,idx){
  dragSrc=idx;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed='move';
}
function onDragOver(e,idx){
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.player-card').forEach(c=>c.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}
function onDrop(e,idx){
  e.preventDefault();
  if(dragSrc===null||dragSrc===idx)return;
  const players=teamEditorData.players;
  const moved=players.splice(dragSrc,1)[0];
  players.splice(idx,0,moved);
  players.forEach((p,i)=>p.id=i);
  dragSrc=null;
  render();
}
function onDragEnd(e){
  e.target.classList.remove('dragging');
  document.querySelectorAll('.player-card').forEach(c=>c.classList.remove('drag-over'));
  dragSrc=null;
}

// -- Team editor render --
let teTab = 'batting'; // 'batting' | 'bowling'

function renderTeamEditor(){
  const p=teamEditorData;
  const batTotal=p.players.reduce((s,pl)=>s+pl.batStars,0);
  const bowlers=p.players.filter(pl=>pl.isBowler);
  const bowlTotal=bowlers.reduce((s,pl)=>s+(pl.bowlStars||1),0);
  const batOk=batTotal===29;
  const bowlOk=bowlTotal===18&&bowlers.length===5;
  const wkCount=p.players.filter(pl=>pl.isWk).length;
  const valid=batOk&&bowlOk&&wkCount===1;

  return`<div class="te-overlay">
    <div class="te-header">
      <button class="btn btn-sm" onclick="closeTeamEditor()"><- Back</button>
      <input class="player-name-input" style="font-family:'Playfair Display',serif;font-size:16px;font-weight:600"
        value="${p.name}" onchange="teamEditorData.name=this.value" placeholder="Team name">
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mid);margin-bottom:6px">Team Personality</div>
      <div style="display:flex;gap:6px">
        ${TEAM_PERSONALITIES.map(pers=>`<button class="seg-btn${(p.personality||'Balanced')===pers?' active':''}"
          onclick="teamEditorData.personality='${pers}';render()" style="flex:1;text-align:center">
          ${pers}
        </button>`).join('')}
      </div>
      <div style="font-size:10px;color:var(--mid);margin-top:4px">${TEAM_PERSONALITY_DESCS[p.personality||'Balanced']}</div>
    </div>

    <div class="te-counters">
      <div class="te-counter${batOk?' ok':batTotal>29?' warn':''}">
        <div class="te-counter-label">Bat *</div>
        <div class="te-counter-val">${batTotal}/29</div>
      </div>
      <div class="te-counter${bowlOk?' ok':bowlTotal>18?' warn':''}">
        <div class="te-counter-label">Bowl *</div>
        <div class="te-counter-val">${bowlTotal}/18</div>
      </div>
      <div class="te-counter${bowlers.length===5?' ok':' warn'}">
        <div class="te-counter-label">Bowlers</div>
        <div class="te-counter-val">${bowlers.length}/5</div>
      </div>
      <div class="te-counter${wkCount===1?' ok':' warn'}">
        <div class="te-counter-label">Keeper</div>
        <div class="te-counter-val">${wkCount}/1</div>
      </div>
    </div>

    <div class="profile-tabs" style="margin-bottom:12px">
      <div class="profile-tab${teTab==='batting'?' active':''}" onclick="switchTeTab('batting')">[bat] Batting Order</div>
      <div class="profile-tab${teTab==='bowling'?' active':''}" onclick="switchTeTab('bowling')">[tgt] Bowling</div>
    </div>

    ${teTab==='batting' ? renderBattingTab(p) : renderBowlingTab(p)}

    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary" onclick="saveTeamEditor()" ${!valid?'disabled':''} style="flex:2">
        ${valid?'Save Team':'Fix errors to save'}
      </button>
      ${teamEditorIdx!==null?`<button class="btn btn-danger" onclick="deleteCustomTeam(${teamEditorIdx})">Delete</button>`:''}
    </div>
    <div style="font-size:10px;color:var(--mid);margin-top:8px;text-align:center">
      ${teTab==='batting'?'Drag to reorder . + = Wicket Keeper':'5 bowlers . 18 stars total . 1 specialism each'}
    </div>
  </div>`;
}

function switchTeTab(tab){ teTab=tab; render(); }

function renderBattingTab(p){
  return p.players.map((pl,i)=>`
  <div class="player-card" draggable="true"
    ondragstart="onDragStart(event,${i})" ondragover="onDragOver(event,${i})"
    ondrop="onDrop(event,${i})" ondragend="onDragEnd(event)">
    <div class="player-card-header">
      <span class="drag-handle">?</span>
      <span class="player-pos">${i+1}</span>
      <input class="player-name-input" value="${pl.name}"
        onchange="teamEditorData.players[${i}].name=this.value" placeholder="Name">
      <button class="seg-btn${pl.isWk?' active':''}" onclick="setWK(${i})" title="Wicket Keeper">+</button>
    </div>
    <div class="player-row">
      <span class="player-label">Bat *</span>
      <div class="star-stepper">
        <button class="star-btn" onclick="adjStar(${i},'batStars',-1)">?</button>
        <span class="star-count">${pl.batStars}</span>
        <button class="star-btn" onclick="adjStar(${i},'batStars',1)">+</button>
      </div>
      <span style="font-size:10px;color:var(--gold-light);margin-left:6px">${'*'.repeat(pl.batStars)}</span>
    </div>
    <div class="player-row">
      <span class="player-label">Style</span>
      ${STYLE_LIST.map(s=>`<button class="seg-btn${pl.style===s?' active':''}"
        onclick="teamEditorData.players[${i}].style='${s}';render()">${s.substring(0,4)}</button>`).join('')}
    </div>
    <div class="player-row">
      <span class="player-label">Hand</span>
      ${['R','L'].map(h=>`<button class="seg-btn${pl.hand===h?' active':''}"
        onclick="teamEditorData.players[${i}].hand='${h}';render()">${h}</button>`).join('')}
    </div>
    ${i<6?`<div class="player-row" style="flex-wrap:wrap">
      <span class="player-label">Specialist</span>
      ${BAT_SPECIALISMS.map(s=>`<button class="seg-btn${(pl.batSpecialism||'none')===s?' active':''}"
        onclick="teamEditorData.players[${i}].batSpecialism='${s}';render()"
        style="margin-bottom:3px;font-size:9px">${BAT_SPECIALISM_SHORT[s]}</button>`).join('')}
    </div>`:'<div style="font-size:9px;color:var(--mid);margin-top:4px">Lower order -- no specialism</div>'}
  </div>`).join('');
}

function renderBowlingTab(p){
  const bowlers=p.players.filter(pl=>pl.isBowler);
  const nonBowlers=p.players.filter(pl=>!pl.isBowler);
  return`
  ${p.players.map((pl,i)=>{
    if(!pl.isBowler) return `
    <div class="player-card" style="opacity:.6">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="player-pos">${i+1}</span>
        <span style="flex:1;font-family:'Playfair Display',serif;font-size:13px">${pl.name}</span>
        <button class="seg-btn" onclick="toggleBowler(${i})">+ Make bowler</button>
      </div>
    </div>`;
    return`
    <div class="player-card">
      <div class="player-card-header">
        <span class="player-pos">${i+1}</span>
        <span style="flex:1;font-family:'Playfair Display',serif;font-size:13px;font-weight:600">${pl.name}</span>
        <button class="seg-btn active" onclick="toggleBowler(${i})">? Bowler</button>
      </div>
      <div class="player-row">
        <span class="player-label">Bowl *</span>
        <div class="star-stepper">
          <button class="star-btn" onclick="adjStar(${i},'bowlStars',-1)">?</button>
          <span class="star-count">${pl.bowlStars||1}</span>
          <button class="star-btn" onclick="adjStar(${i},'bowlStars',1)">+</button>
        </div>
        <span style="font-size:10px;color:var(--gold-light);margin-left:6px">${'*'.repeat(pl.bowlStars||1)}</span>
      </div>
      <div class="player-row">
        <span class="player-label">Type</span>
        ${BOWL_TYPES.map(t=>`<button class="seg-btn${pl.bowlType===t?' active':''}"
          onclick="teamEditorData.players[${i}].bowlType='${t}';render()">${t}</button>`).join('')}
      </div>
      <div class="player-row" style="flex-wrap:wrap">
        <span class="player-label">Specialist</span>
        ${SPECIALISMS.map(s=>`<button class="seg-btn${pl.specialism===s?' active':''}"
          onclick="teamEditorData.players[${i}].specialism='${s}';render()"
          style="margin-bottom:3px">${SPECIALISM_LABELS[s].split(' ')[0]}</button>`).join('')}
      </div>
    </div>`;
  }).join('')}`;
}

function setWK(idx){
  teamEditorData.players.forEach((p,i)=>p.isWk=i===idx);
  render();
}
function toggleBowler(idx){
  const p=teamEditorData.players[idx];
  p.isBowler=!p.isBowler;
  if(p.isBowler&&!p.bowlStars)p.bowlStars=1;
  if(p.isBowler&&!p.bowlType)p.bowlType='fast';
  if(p.isBowler&&!p.specialism)p.specialism='none';
  render();
}
function adjStar(idx,field,delta){
  const p=teamEditorData.players[idx];
  const min=1, max=field==='batStars'?5:5;
  p[field]=Math.max(min,Math.min(max,(p[field]||1)+delta));
  render();
}

function renderTeamEditorList(){
  return`<div class="te-overlay">
    <div class="te-header">
      <button class="btn btn-sm" onclick="closeTeamEditor()"><- Back</button>
      <div class="te-title">Saved Teams</div>
    </div>
    ${customTeams.length===0?`<div style="font-size:13px;color:var(--mid);padding:20px;text-align:center">No saved teams yet</div>`:''}
    ${customTeams.map((t,i)=>`<div class="card" style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <div style="flex:1">
        <div style="font-family:'Playfair Display',serif;font-size:14px;font-weight:600">${t.name}</div>
        <div style="font-size:10px;color:var(--mid)">${t.players.map(p=>p.name).slice(0,4).join(', ')}...</div>
      </div>
      <button class="btn btn-sm" onclick="openTeamEditor(${i})">Edit</button>
    </div>`).join('')}
    <button class="btn btn-primary" style="margin-top:8px" onclick="openTeamEditor(null)">+ New Team</button>
  </div>`;
}

// =======================================
// SIMULATION ENGINE
// =======================================
function simInnings(team, fieldingTeam, pitchIdx, weatherIdx, profileKey, targetScore){
  // Returns {runs, wickets}
  const profile = profiles[profileKey];
  const bowlers = fieldingTeam.players.filter(p=>p.isBowler).map(p=>({
    id:'b'+p.id, name:p.name, type:p.bowlType, hand:p.hand,
    speciality:p.specialism, stars:p.bowlStars,
  }));
  const nonBowlers = fieldingTeam.players.filter(p=>!p.isBowler).map(p=>({
    id:'e'+p.id, name:p.name, type:'medium', hand:p.hand,
    speciality:'none', stars:1, emergency:true,
  }));
  const allBowlers=[...bowlers,...nonBowlers];

  const batsmen = team.players.map(p=>({
    stars:p.batStars, style:p.style, hand:p.hand,
    vs_fast:STYLES[p.style]?.vs_fast||1.0,
    vs_spin:STYLES[p.style]?.vs_spin||1.0,
    runs:0, out:false,
  }));

  let runs=0, wickets=0, dotStreak=0, dotBuff=0;
  let bowlerOvers={}, fieldStreak={id:'balanced',count:0};
  let activeBat=0; // index of striker

  const getOverType=(over)=>over<=5?'fast':'spin';

  const simPickBowler=(over)=>{
    const ot=getOverType(over);
    const available=allBowlers.filter(b=>(bowlerOvers[b.id]||0)<2);
    if(!available.length) return allBowlers[0];
    const scored=available.map(b=>{
      let score=b.stars;
      if(b.type===ot) score+=2;
      if(b.speciality==='opener'&&over<=2) score+=2;
      if(b.speciality==='finisher'&&over>=9) score+=2;
      return{b,score};
    });
    scored.sort((a,b)=>b.score-a.score);
    return scored[0].b;
  };

  const simInherentBonus=(bwl,over,pitchId,weatherId)=>{
    let bonus=0;
    if(bwl.type==='spin'&&pitchId==='minefield') bonus+=1;
    if(bwl.type==='medium'){
      const isFinisher=bwl.speciality==='finisher';
      if(over<=3) bonus-=1;
      if(over>=9&&!isFinisher) bonus-=1;
      if(weatherId==='damp') bonus+=1;
    }
    return bonus;
  };

  const simSpecialistBonus=(bwl,over,pitchId,weatherId)=>{
    switch(bwl.speciality){
      case 'opener':   return over<=2?1:0;
      case 'finisher': return over>=9?1:0;
      case 'strike':   return weatherId==='hot'?1:0;
      case 'swing':    return weatherId==='overcast'?1:0;
      case 'seamer':   return pitchId==='minefield'?1:0;
      default: return 0;
    }
  };

  const pitchId = PITCH_OPTS.find(p=>p.idx===pitchIdx)?.id||'good';
  const weatherId = WEATHER_OPTS.find(w=>w.idx===weatherIdx)?.id||'sunny';

  let batConfidence=0;
  let currentField='balanced';

  for(let over=1;over<=10&&wickets<10;over++){
    const bwl=simPickBowler(over);
    bowlerOvers[bwl.id]=(bowlerOvers[bwl.id]||0)+1;

    // Bowling CPU -- same mission both innings: take wickets, dry up runs
    // No target awareness -- just read what's in front of them
    let newField='balanced';
    if(over<=2) newField='defensive';
    else if(wickets>=7) newField='attacking';
    else if(over>=9) newField='attacking';
    else if(over>=6&&wickets>=5) newField='attacking';
    else if(over>=6&&wickets<=2) newField='defensive';
    if(Math.random()<0.15) newField=['attacking','balanced','defensive'][Math.floor(Math.random()*3)];
    if(newField!==currentField){ currentField=newField; batConfidence=0; }

    for(let ball=0;ball<6&&wickets<10;ball++){
      if(targetScore!==null&&runs>targetScore) return{runs,wickets};
      const bat=batsmen[activeBat];
      const ot=getOverType(over);
      const fb=getMod('fastOverBonus')/100, wp=getMod('wrongOverPen')/100, ha=getMod('handAngle')/100;
      let wm=1.0;
      if(bwl.type==='fast'&&ot==='fast') wm*=1+fb;
      if(bwl.type==='spin'&&ot==='spin') wm*=1+fb;
      if(bwl.type==='fast'&&ot==='spin') wm*=1-wp;
      if(bwl.type==='spin'&&ot==='fast') wm*=1-wp;
      if(bwl.hand!==bat.hand) wm*=1+ha;
      const vm=bwl.type==='spin'?bat.vs_spin:bat.vs_fast;
      wm=Math.min(1.5,wm/vm);

      const specBonus=simSpecialistBonus(bwl,over,pitchId,weatherId);
      const inherBonus=simInherentBonus(bwl,over,pitchId,weatherId);
      const effStars=Math.min(5,Math.max(1,bwl.stars+specBonus+inherBonus));

      // Personality modifiers
      const batPers=team.personality||'Balanced';
      const bowlPers=fieldingTeam.personality||'Balanced';
      const isInn1=targetScore===null;
      const batPersMod = batPers==='Setting'?(isInn1?0.92:1.08):batPers==='Chasing'?(isInn1?1.08:0.92):1.0;
      const bowlPersMod = bowlPers==='Setting'?(isInn1?0.92:1.08):bowlPers==='Chasing'?(isInn1?1.08:0.92):1.0;
      const runPersMod = batPers==='Setting'?(isInn1?1.05:0.95):batPers==='Chasing'?(isInn1?0.95:1.05):1.0;

      let howzat=profile.howzat[effStars-1][pitchIdx][weatherIdx]*wm*batPersMod*bowlPersMod+dotBuff;
      howzat=Math.min(getHowzatCap(bat.stars),Math.max(2,howzat));

      // Confidence reduces howzat
      const confNotOut=Math.min(10,Math.floor(batConfidence/2));
      batConfidence=Math.min(20,batConfidence+1);

      if(Math.random()<howzat/100){
        // Apply not-out chance using bat stars + confidence
        const notOutChance=Math.min(95, profile.notout[bat.stars-1][pitchIdx][weatherIdx] + confNotOut);
        if(Math.random()<notOutChance/100){
          // Survived -- not out
          dotStreak=0; dotBuff=0;
        } else {
          wickets++;
          dotStreak=0; dotBuff=0; batConfidence=0;
          let next=-1;
          for(let i=activeBat+1;i<batsmen.length;i++){if(!batsmen[i].out){next=i;break;}}
          if(next===-1||wickets>=10) break;
          batsmen[activeBat].out=true;
          activeBat=next;
        }
      } else {
        // Score runs -- v8 engine: mentality x field run face matrix
        const confRunBonus=Math.floor(batConfidence/4);
        const simMentality='positive'; // CPU sim uses positive as baseline mentality
        const simFaceTable = bat.stars===1 ? TAIL_RUNS : (MENTALITY_RUNS[simMentality] || MENTALITY_RUNS.positive);
        const runFaces = simFaceTable[currentField] || simFaceTable.balanced;
        const face=runFaces[Math.floor(Math.random()*runFaces.length)];
        if(face===0){
          dotStreak++; dotBuff=Math.min(2,dotStreak)*getMod('dotBallPct');
        } else {
          dotStreak=0; dotBuff=0;
          let r=face;
          if(confRunBonus>0&&r>0) r=Math.min(6,r+Math.floor(confRunBonus/3));
          r=Math.min(6,r);
          runs+=r;
          bat.runs+=r;
        }
      }
    }
    const tmp=activeBat;
  }
  return{runs,wickets};
}

let simFixedOrder = false; // if true, Team 1 always bats first

function runSimulation(){
  if(!matchTeams.t1||!matchTeams.t2){showToast('Select both teams first');return;}
  const t1=matchTeams.t1, t2=matchTeams.t2;
  const profileKey='A'; // Use Profile A for all simulations
  let simCount=0;
  const toRun=50;

  for(let i=0;i<toRun;i++){
    // Random weighted conditions
    const pitch=weightedRnd(PITCH_OPTS);
    const weather=weightedRnd(WEATHER_OPTS);
    const pitchIdx=pitch.idx, weatherIdx=weather.idx;

    // Innings order: fixed or random
    let battingFirst, battingSecond;
    if(simFixedOrder){
      battingFirst=t1; battingSecond=t2;
    } else {
      battingFirst=Math.random()<0.5?t1:t2;
      battingSecond=battingFirst===t1?t2:t1;
    }

    // Innings 1
    const inn1=simInnings(battingFirst, battingSecond, pitchIdx, weatherIdx, profileKey, null);
    // Innings 2
    const inn2=simInnings(battingSecond, battingFirst, pitchIdx, weatherIdx, profileKey, inn1.runs);

    // Determine result
    let resultText, resultCls;
    if(inn2.runs>inn1.runs){ resultText=`${battingSecond.name} win by ${11-inn2.wickets} wickets`; resultCls='result-win'; }
    else if(inn2.runs===inn1.runs){ resultText='Match tied'; resultCls='result-tie'; }
    else { resultText=`${battingFirst.name} win by ${inn1.runs-inn2.runs} runs`; resultCls='result-loss'; }

    matchHistory.unshift({
      date:new Date().toISOString(),
      team1:battingFirst.name, team2:battingSecond.name,
      pitch:pitch.id, weather:weather.id,
      profile1:profileKey, profile2:profileKey,
      inn1runs:inn1.runs, inn1wkts:inn1.wickets,
      inn2runs:inn2.runs, inn2wkts:inn2.wickets,
      result:resultText, resultCls,
      simulated:true,
    });
    simCount++;
  }
  if(matchHistory.length>50) matchHistory=matchHistory.slice(0,50);
  saveHistory();

  const avg=Math.round(matchHistory.slice(0,simCount).reduce((s,m)=>s+(m.inn1runs+m.inn2runs)/2,0)/simCount);
  const avgWkt=Math.round(matchHistory.slice(0,simCount).reduce((s,m)=>s+(m.inn1wkts+m.inn2wkts)/2,0)/simCount);
  showToast(`[zap] ${simCount} matches simulated . avg ${avg}/${avgWkt}`);
  historyScreenOpen=true;
  render();
}

// -- Expose --
window.tossTheCoin=tossTheCoin;
window.chooseBatBowl=chooseBatBowl;
window.confirmProfile=confirmProfile;
window.confirmProfile2=confirmProfile2;
window.rollBat=rollBat;
window.selectBowler=selectBowler;
window.mpCreateRoom=mpCreateRoom;
window.mpJoinRoom=mpJoinRoom;
window.mpLeave=mpLeave;
window.mpAdvanceToConditions=mpAdvanceToConditions;
window.mpForfeit=mpForfeit;
window.mpEndWithoutPenalty=mpEndWithoutPenalty;
window.confirmNewGame=confirmNewGame;
window.mpAdvanceToTeams=mpAdvanceToTeams;
window.mpAdvanceToToss=mpAdvanceToToss;
window.mpSelectTeam=mpSelectTeam;
window.mpSelectTeamIdx=mpSelectTeamIdx;
window.mpCallToss=mpCallToss;
window.mpShowJoin=function(){
  const f=document.getElementById('mp-join-form');
  if(f){f.style.display=f.style.display==='none'?'block':'none';}
};
window.mpJoinFromInput=function(){
  const code=document.getElementById('mp-code-input')?.value||'';
  mpJoinRoom(code);
};
window.selectField=selectField;
window.acceptDismissal=acceptDismissal;
window.dismissNotOut=dismissNotOut;
window.callReview=callReview;
window.resetGame=resetGame;
window.startSecondInnings=startSecondInnings;
window.openSettings=openSettings;
window.closeSettings=closeSettings;
window.closeSettingsIfBackground=closeSettingsIfBackground;
window.switchSettingsTab=switchSettingsTab;
window.updateProfileName=updateProfileName;
window.updateTable=updateTable;
window.updateMod=updateMod;
window.copyProfile=copyProfile;
window.resetProfile=resetProfile;
window.exportSettings=exportSettings;
window.selectTeam=selectTeam;
window.setCpuTeam=setCpuTeam;
window.proceedToToss=proceedToToss;
window.openTeamEditor=openTeamEditor;
window.openTeamEditorList=openTeamEditorList;
window.closeTeamEditor=closeTeamEditor;
window.saveTeamEditor=saveTeamEditor;
window.deleteCustomTeam=deleteCustomTeam;
window.setWK=setWK;
window.toggleBowler=toggleBowler;
window.adjStar=adjStar;
window.runSimulation=runSimulation;
window.openHistory=openHistory;
window.closeHistory=closeHistory;
window.clearHistory=clearHistory;
window.setMentality=(idx,m)=>{
  const prev=st.mentalities[idx]||'positive';
  if(prev===m){render();return;}
  st.mentalities[idx]=m;
  const bat=st.batsmen?.[idx];
  const name=bat?bat.name:'Batsman';
  const icons={defensive:'[o]',rotation:'[rot]',positive:'[v]',aggressive:'[agg]'};
  addLog(`${name}: ${icons[prev]||prev} -> ${icons[m]||m} ${m}`,'');
  if(st.activeBat&&st.activeBat[0]===idx){
    st.consecutiveZeros=0;st.dotBallBuff=0;
  }
  render();
};
window.sendNextBatsman=sendNextBatsman;
window.sendBatsman=sendBatsman;
window.openBowlerScreen=openBowlerScreen;
window.closeBowlerScreen=closeBowlerScreen;
window.selectBowlerFromScreen=selectBowlerFromScreen;
window.switchTeTab=switchTeTab;
window.onDragStart=onDragStart;
window.onDragOver=onDragOver;
window.onDrop=onDrop;
window.onDragEnd=onDragEnd;

render();
