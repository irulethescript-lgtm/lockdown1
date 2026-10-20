const express = require('express');
const session = require('express-session');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { getUser, run: dbRun, all: dbAll } = require('./middleware/db');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.locals.avatarImages = require('./middleware/avatardata').avatarImages;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.locals.formatCash = (n) => {
  if (n >= 1e9) return (n/1e9).toFixed(2)+' Bil';
  if (n >= 1e6) return (n/1e6).toFixed(2)+' Mil';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'k';
  return Number(n).toLocaleString();
};
app.locals.timeAgo = (ts) => {
  const d = Math.floor(Date.now()/1000) - ts;
  if (d < 60) return d+'s ago';
  if (d < 3600) return Math.floor(d/60)+'m ago';
  if (d < 86400) return Math.floor(d/3600)+'h ago';
  return Math.floor(d/86400)+'d ago';
};

// Sessions stored in memory (no SQLite needed)
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'lockdown-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// Layout wrapper
app.use((req, res, next) => {
  const origRender = res.render.bind(res);
  res.render = (view, locals, cb) => {
    origRender(view, locals, (err, body) => {
      if (err) return next(err);
      if (['login','register'].includes(view)) return res.send(body);
      origRender('layout', { ...locals, body }, (err2, html) => {
        if (err2) return next(err2);
        res.send(html);
      });
    });
  };
  next();
});

app.use(require('./middleware/city').cityRoutes);
app.use(require('./routes/auth'));
app.use(require('./middleware/travel').travelGate({ withTransaction: require('./middleware/db').withTransaction }));
app.use(require('./routes/gangs'));
app.use(require('./routes/game'));

// Socket.IO shoutbox
const onlineUsers = new Map();
io.on('connection', (socket) => {
  socket.on('auth', async () => {
    try {
      const userId = socket.request.session?.userId;
      if (!userId) return;
      const user = await getUser(userId);
      if (!user || !socket.connected) return;
      onlineUsers.set(socket.id, { userId: user.id, username: user.username });
      io.emit('online_count', onlineUsers.size);
    } catch (err) {
      console.error('[chat] Authentication failed:', err.message);
    }
  });
  socket.on('shout', async (data) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    const msg = String(data?.message || '').trim().slice(0, 200);
    if (!msg) return;
    const now = Date.now();
    if (socket._lastShout && now - socket._lastShout < 3000) return;
    socket._lastShout = now;
    try {
      const current = await getUser(user.userId);
      if (!current) return;
      await dbRun('INSERT INTO shoutbox (user_id,username,message) VALUES (?,?,?)', [user.userId, current.username, msg]);
      io.emit('shout', { username: current.username, level: current.level, message: msg, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) });
    } catch (err) {
      console.error('[chat] Message failed:', err.message);
      socket.emit('shout_error', 'Your message could not be sent. Try again.');
    }
  });
  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('online_count', onlineUsers.size);
  });
});

app.get('/api/online', (req, res) => res.json({ count: onlineUsers.size }));

// ── AUTO JOB PAY — runs every 10 minutes, pays anyone whose 24h is up ──
const { JOBS } = require('./middleware/gamedata');

async function processJobPayouts() {
  const now = Math.floor(Date.now()/1000);
  try {
    const workers = await dbAll(
      `SELECT * FROM users WHERE job_key IS NOT NULL AND job_prison_id IS NOT NULL
       AND (last_daily_pay IS NULL OR last_daily_pay <= ?)`,
      [now - 86400]
    );
    for (const user of workers) {
      if (user.job_prison_id !== user.prison_id) continue; // transferred
      const prisonJobs = JOBS[user.prison_id] || [];
      const job = prisonJobs.find(j => j.key === user.job_key);
      if (!job) continue;
      const bonus = Math.floor(((user.defense||0) + (user.strength||0)) / 20) * 10;
      const pay   = job.base_pay + bonus;
      const xp    = job.xp_per_day;
      await dbRun('UPDATE users SET cash=cash+?, xp=xp+?, last_daily_pay=? WHERE id=?',
        [pay, xp, now, user.id]);
      // Log it
      await dbRun(
        `INSERT INTO transaction_logs (type,to_id,to_name,cash_amount,note) VALUES ('job_pay',?,?,?,?)`,
        [user.id, user.username, pay, `Job pay: ${job.name} ($${job.base_pay} + $${bonus} stat bonus)`]
      ).catch(()=>{});
      // Notify player
      await dbRun(
        `INSERT INTO events (user_id,type,message) VALUES (?,'job_pay',?)`,
        [user.id, `💰 Job pay deposited: +$${pay} (+${xp} XP) from ${job.name}.`]
      ).catch(()=>{});
    }
    if (workers.length > 0) console.log(`[AUTO-PAY] Paid ${workers.length} workers`);
  } catch(e) {
    console.error('[AUTO-PAY] Error:', e.message);
  }
}

// Run on startup and every 10 minutes
processJobPayouts();
setInterval(processJobPayouts, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n🔒 LOCKDOWN running at http://localhost:${PORT}\n`);
});
// Property expiry/upkeep, stock dividends and company closings use UTC clocks.
let economyTickRunning=false;
async function processEconomy(){
 if(economyTickRunning)return;
 economyTickRunning=true;
 try{await require('./middleware/db').withTransaction(tx=>require('./middleware/economy-clock').tick(tx));}
 catch(error){console.error('[ECONOMY]',error.message);}
 finally{economyTickRunning=false;}
}
processEconomy();
setInterval(processEconomy,60000);
