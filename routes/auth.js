const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../middleware/db');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/city');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.render('login', { error: 'Fill in all fields.' });
  const user = await get('SELECT * FROM users WHERE username=?', [username.trim()]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.render('login', { error: 'Invalid username or password.' });
  req.session.userId = user.id;
  res.redirect('/city');
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/city');
  res.render('register', { error: null });
});

router.post('/register', async (req, res) => {
  const { username, password, confirm } = req.body;
  if (!username || !password) return res.render('register', { error: 'Fill in all fields.' });
  if (username.length < 3 || username.length > 20) return res.render('register', { error: 'Username must be 3-20 characters.' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.render('register', { error: 'Letters, numbers, underscores only.' });
  if (password.length < 4) return res.render('register', { error: 'Password must be at least 4 characters.' });
  if (password !== confirm) return res.render('register', { error: 'Passwords do not match.' });
  const existing = await get('SELECT id FROM users WHERE username=?', [username.trim()]);
  if (existing) return res.render('register', { error: 'Username already taken.' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = await run('INSERT INTO users (username, password, avatar) VALUES (?,?,?)', [username.trim(), hash, JSON.stringify(require('../middleware/avatardata').DEFAULT_AVATAR)]);
    req.session.userId = result.lastID;
    res.redirect('/city');
  } catch(e) {
    res.render('register', { error: 'Could not create account. Try again.' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
