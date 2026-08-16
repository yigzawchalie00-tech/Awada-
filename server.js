require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { pool, initDB } = require('./db');
const { generateToken, requireAuth, seedSuperAdmin } = require('./auth');
const { upload, cloudinary } = require('./upload');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting on login to prevent brute force
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// ─── AUTH ────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  try {
    const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    const admin = result.rows[0];
    if (!admin) return res.status(401).json({ error: 'Incorrect username or password.' });
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect username or password.' });
    const token = generateToken(admin);
    res.json({ token, role: admin.role, fullName: admin.full_name, username: admin.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

app.get('/api/auth/me', requireAuth(), (req, res) => {
  res.json(req.admin);
});

// ─── ADMINS (super_admin only) ───────────────────────────────────────────────

app.get('/api/admins', requireAuth(['super_admin']), async (req, res) => {
  const result = await pool.query('SELECT id, username, role, full_name, created_at FROM admins ORDER BY created_at');
  res.json(result.rows);
});

app.post('/api/admins', requireAuth(['super_admin']), async (req, res) => {
  const { username, password, role, full_name } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Username, password, and role required.' });
  if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'Role must be admin or viewer.' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO admins (username, password_hash, role, full_name) VALUES ($1, $2, $3, $4) RETURNING id, username, role, full_name',
      [username, hash, role, full_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already exists.' });
    res.status(500).json({ error: 'Server error.' });
  }
});

app.delete('/api/admins/:id', requireAuth(['super_admin']), async (req, res) => {
  await pool.query('DELETE FROM admins WHERE id = $1 AND role != $2', [req.params.id, 'super_admin']);
  res.json({ ok: true });
});

// ─── MEMBERS ─────────────────────────────────────────────────────────────────

// List/search members
app.get('/api/members', requireAuth(), async (req, res) => {
  try {
    const { search, status, gubae_department, batch, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        first_name ILIKE $${params.length} OR
        father_name ILIKE $${params.length} OR
        grandfather_name ILIKE $${params.length} OR
        baptism_name ILIKE $${params.length} OR
        phone ILIKE $${params.length} OR
        email ILIKE $${params.length}
      )`);
    }
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (gubae_department) { params.push(gubae_department); conditions.push(`gubae_department = $${params.length}`); }
    if (batch) { params.push(batch); conditions.push(`batch = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM members ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit), parseInt(offset));
    const result = await pool.query(
      `SELECT id, title, first_name, father_name, grandfather_name, gender, baptism_name,
              university_department, batch, section, phone, email, gubae_department,
              joining_date, status, graduation_year, photo_url, created_at
       FROM members ${where}
       ORDER BY first_name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ members: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Get single member
app.get('/api/members/:id', requireAuth(), async (req, res) => {
  const result = await pool.query('SELECT * FROM members WHERE id = $1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Member not found.' });
  res.json(result.rows[0]);
});

// Add member
app.post('/api/members', requireAuth(['super_admin', 'admin']), upload.single('photo'), async (req, res) => {
  try {
    const f = req.body;
    const photoUrl = req.file?.path || null;
    const photoPublicId = req.file?.filename || null;

    const result = await pool.query(`
      INSERT INTO members (
        title, first_name, father_name, grandfather_name, date_of_birth, gender,
        region, zone, woreda, center,
        baptism_name, confession_father,
        university_department, batch, section,
        email, phone,
        gubae_department, joining_date, status, graduation_year, notes,
        photo_url, photo_public_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      ) RETURNING *`,
      [
        f.title, f.first_name, f.father_name, f.grandfather_name,
        f.date_of_birth || null, f.gender,
        f.region, f.zone, f.woreda, f.center,
        f.baptism_name, f.confession_father,
        f.university_department, f.batch, f.section,
        f.email, f.phone,
        f.gubae_department, f.joining_date || null,
        f.status || 'active', f.graduation_year || null, f.notes || null,
        photoUrl, photoPublicId
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add member.' });
  }
});

// Update member
app.put('/api/members/:id', requireAuth(['super_admin', 'admin']), upload.single('photo'), async (req, res) => {
  try {
    const f = req.body;
    const existing = await pool.query('SELECT photo_public_id FROM members WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Member not found.' });

    let photoUrl = f.existing_photo_url || null;
    let photoPublicId = existing.rows[0].photo_public_id;

    if (req.file) {
      // Delete old photo from Cloudinary
      if (photoPublicId) {
        await cloudinary.uploader.destroy(photoPublicId).catch(() => {});
      }
      photoUrl = req.file.path;
      photoPublicId = req.file.filename;
    }

    const result = await pool.query(`
      UPDATE members SET
        title=$1, first_name=$2, father_name=$3, grandfather_name=$4,
        date_of_birth=$5, gender=$6,
        region=$7, zone=$8, woreda=$9, center=$10,
        baptism_name=$11, confession_father=$12,
        university_department=$13, batch=$14, section=$15,
        email=$16, phone=$17,
        gubae_department=$18, joining_date=$19, status=$20,
        graduation_year=$21, notes=$22,
        photo_url=$23, photo_public_id=$24,
        updated_at=NOW()
      WHERE id=$25 RETURNING *`,
      [
        f.title, f.first_name, f.father_name, f.grandfather_name,
        f.date_of_birth || null, f.gender,
        f.region, f.zone, f.woreda, f.center,
        f.baptism_name, f.confession_father,
        f.university_department, f.batch, f.section,
        f.email, f.phone,
        f.gubae_department, f.joining_date || null, f.status,
        f.graduation_year || null, f.notes || null,
        photoUrl, photoPublicId,
        req.params.id
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update member.' });
  }
});

// Delete member (super_admin only)
app.delete('/api/members/:id', requireAuth(['super_admin']), async (req, res) => {
  try {
    const existing = await pool.query('SELECT photo_public_id FROM members WHERE id = $1', [req.params.id]);
    if (existing.rows[0]?.photo_public_id) {
      await cloudinary.uploader.destroy(existing.rows[0].photo_public_id).catch(() => {});
    }
    await pool.query('DELETE FROM members WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete member.' });
  }
});

// ─── BULK IMPORT ─────────────────────────────────────────────────────────────

app.post('/api/members/import', requireAuth(['super_admin', 'admin']), async (req, res) => {
  const { members } = req.body;
  if (!Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: 'No members provided.' });
  }

  let imported = 0;
  let failed = 0;
  const errors = [];

  for (const m of members) {
    try {
      if (!m.first_name || !m.father_name) { failed++; errors.push(`Row missing ስም/የአባት ስም`); continue; }
      await pool.query(`
        INSERT INTO members (
          title, first_name, father_name, grandfather_name, date_of_birth, gender,
          region, zone, woreda, center,
          baptism_name, confession_father,
          university_department, batch, section,
          email, phone,
          gubae_department, joining_date, status, graduation_year, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      `, [
        m.title || null, m.first_name, m.father_name, m.grandfather_name || null,
        m.date_of_birth || null, m.gender || null,
        m.region || null, m.zone || null, m.woreda || null, m.center || null,
        m.baptism_name || null, m.confession_father || null,
        m.university_department || null, m.batch || null, m.section || null,
        m.email || null, m.phone || null,
        m.gubae_department || null, m.joining_date || null,
        m.status || 'active', m.graduation_year || null, m.notes || null,
      ]);
      imported++;
    } catch (err) {
      failed++;
      errors.push(`${m.first_name} ${m.father_name}: ${err.message}`);
    }
  }

  res.json({ imported, failed, errors });
});

app.get('/api/stats', requireAuth(), async (req, res) => {
  try {
    const [total, active, graduated, byDept, byBatch] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM members'),
      pool.query("SELECT COUNT(*) FROM members WHERE status = 'active'"),
      pool.query("SELECT COUNT(*) FROM members WHERE status = 'graduated'"),
      pool.query(`SELECT gubae_department, COUNT(*) as count FROM members
                  WHERE gubae_department IS NOT NULL AND gubae_department != ''
                  GROUP BY gubae_department ORDER BY count DESC`),
      pool.query(`SELECT batch, COUNT(*) as count FROM members
                  WHERE batch IS NOT NULL AND batch != ''
                  GROUP BY batch ORDER BY batch DESC LIMIT 10`),
    ]);
    res.json({
      total: parseInt(total.rows[0].count),
      active: parseInt(active.rows[0].count),
      graduated: parseInt(graduated.rows[0].count),
      byDepartment: byDept.rows,
      byBatch: byBatch.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── EXPORT ──────────────────────────────────────────────────────────────────

app.get('/api/export', requireAuth(['super_admin', 'admin']), async (req, res) => {
  try {
    const { status, gubae_department, batch } = req.query;
    const conditions = [];
    const params = [];

    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (gubae_department) { params.push(gubae_department); conditions.push(`gubae_department = $${params.length}`); }
    if (batch) { params.push(batch); conditions.push(`batch = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(`SELECT * FROM members ${where} ORDER BY first_name ASC`, params);

    // Return JSON; the frontend will convert to Excel using SheetJS
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Export failed.' });
  }
});

// ─── START ───────────────────────────────────────────────────────────────────

async function start() {
  await initDB();
  await seedSuperAdmin();
  app.listen(PORT, () => console.log(`አዋዳ ግቢ ጉባኤ system running on port ${PORT}`));
}

start().catch(console.error);
