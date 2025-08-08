require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false
  }
});

// Supabase connection for user management and learner tracking

const supabasePool = new Pool({
  host: process.env.SUPABASE_HOST,
  port: process.env.SUPABASE_PORT || 5432,
  database: process.env.SUPABASE_DB,
  user: process.env.SUPABASE_USER,
  password: process.env.SUPABASE_PASSWORD,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err);
  } else {
    console.log('Connected to PostgreSQL database');
    release();
  }
});

// Test Supabase connection
app.get('/api/test-supabase', async (req, res) => {
  try {
    const result = await supabasePool.query('SELECT NOW()');
    res.json({ 
      success: true, 
      message: 'Supabase connection working!',
      time: result.rows[0].now
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Middleware
app.use(cors());
app.use(express.json());

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend server is working with PostgreSQL!' });
});

// Database tables endpoint
app.get('/api/tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name as name 
      FROM information_schema.tables 
      WHERE table_schema = 'dbo' 
      ORDER BY table_name
    `);
    res.json({ tables: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute SQL query endpoint  
app.post('/api/query', async (req, res) => {
  const { sql } = req.body;
  
  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  // Only allow SELECT queries for safety
  if (!sql.trim().toLowerCase().startsWith('select')) {
    return res.status(400).json({ error: 'Only SELECT queries are allowed' });
  }

  try {
    const result = await pool.query(sql);
    res.json({ 
      success: true, 
      data: result.rows,
      rowCount: result.rowCount 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get table schema endpoint - ADD THIS NEW ENDPOINT
app.get('/api/schema/:tableName', async (req, res) => {
  const { tableName } = req.params;
  
  try {
    // Get column information
    const columnsResult = await pool.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = $1 
      AND table_schema = 'dbo'
      ORDER BY ordinal_position
    `, [tableName]);

    // Get primary key information
    const primaryKeysResult = await pool.query(`
      SELECT column_name
      FROM information_schema.key_column_usage
      WHERE table_name = $1 
      AND table_schema = 'dbo'
      AND constraint_name IN (
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = $1 
        AND table_schema = 'dbo'
        AND constraint_type = 'PRIMARY KEY'
      )
    `, [tableName]);

    const primaryKeys = primaryKeysResult.rows.map(row => row.column_name);
    
    const columns = columnsResult.rows.map(col => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === 'YES',
      default: col.column_default,
      isPrimaryKey: primaryKeys.includes(col.column_name)
    }));

    res.json({ 
      success: true, 
      tableName,
      columns 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User registration endpoint
app.post('/api/signup', async (req, res) => {
  const { loginId, password, fullName } = req.body;
  
  try {
    // Check if user already exists
    const existingUser = await supabasePool.query(
      'SELECT login_id FROM sql_playground.users WHERE login_id = $1', 
      [loginId]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Create new user
    const result = await supabasePool.query(
      'INSERT INTO sql_playground.users (login_id, password, full_name) VALUES ($1, $2, $3) RETURNING id, login_id, full_name',
      [loginId, password, fullName]
    );
    
    res.json({ 
      success: true, 
      message: 'User created successfully',
      user: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User login endpoint
app.post('/api/login', async (req, res) => {
  const { loginId, password } = req.body;
  
  try {
    const result = await supabasePool.query(
      'SELECT id, login_id, full_name FROM sql_playground.users WHERE login_id = $1 AND password = $2',
      [loginId, password]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    res.json({ 
      success: true, 
      message: 'Login successful',
      user: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activity logging endpoint
app.post('/api/log-activity', async (req, res) => {
  const { loginId, sqlQuery, executionResult, success } = req.body;
  
  try {
    const result = await supabasePool.query(
      'INSERT INTO sql_playground.learner_activity (login_id, sql_query, execution_result, success) VALUES ($1, $2, $3, $4) RETURNING *',
      [loginId, sqlQuery, JSON.stringify(executionResult), success]
    );
    
    res.json({ 
      success: true, 
      message: 'Activity logged successfully',
      activity: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});