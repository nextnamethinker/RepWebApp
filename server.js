const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL接続プール
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// テーブル作成（PostgreSQL構文）
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS problems (
        problem_id TEXT PRIMARY KEY,
        company_name TEXT,
        strategy_text TEXT,
        sustainability_text TEXT,
        date TEXT,
        usage_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT now()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS judgments (
        id SERIAL PRIMARY KEY,
        userName TEXT,
        strategyText TEXT,
        sustainabilityText TEXT,
        problem_id TEXT,
        score INTEGER,
        timestamp TEXT,
        created_at TIMESTAMP DEFAULT now()
      );
    `);
    console.log('テーブル作成/確認完了');
  } catch (err) {
    console.error('テーブル作成エラー:', err);
  }
}

// 問題取得API（例：usage_countが少ない順、未回答、最大15問、1社のみ）
app.get('/api/problems', async (req, res) => {
  const { userName, limit = 15 } = req.query;
  try {
    const result = await pool.query(`
      SELECT * FROM problems
      WHERE usage_count < 3
        AND problem_id NOT IN (
          SELECT problem_id FROM judgments WHERE userName = $1
        )
      ORDER BY usage_count ASC, created_at ASC
    `, [userName]);
    const rows = result.rows;

    // 会社ごとにグループ化
    const companyGroups = {};
    rows.forEach(row => {
      if (!companyGroups[row.company_name]) companyGroups[row.company_name] = [];
      companyGroups[row.company_name].push(row);
    });

    // usage_count合計が最も少ない会社を選ぶ
    let selectedCompany = null;
    let minUsage = Infinity;
    for (const company in companyGroups) {
      const usageSum = companyGroups[company].reduce((sum, r) => sum + (r.usage_count || 0), 0);
      if (usageSum < minUsage) {
        minUsage = usageSum;
        selectedCompany = company;
      }
    }

    let problems = [];
    if (selectedCompany) {
      problems = companyGroups[selectedCompany].slice(0, parseInt(limit));
    }
    res.json(problems);
  } catch (err) {
    console.error('問題取得エラー:', err);
    res.status(500).json({ error: 'DBエラー' });
  }
});

// 判定結果保存API
app.post('/api/judgments', async (req, res) => {
  const { userName, strategyText, sustainabilityText, problem_id, score, timestamp } = req.body;
  try {
    await pool.query(
      `INSERT INTO judgments (userName, strategyText, sustainabilityText, problem_id, score, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userName, strategyText, sustainabilityText, problem_id, score, timestamp]
    );
    // usage_countをインクリメント
    await pool.query(
      `UPDATE problems SET usage_count = usage_count + 1 WHERE problem_id = $1`,
      [problem_id]
    );
    res.json({ message: '判定結果保存完了' });
  } catch (err) {
    console.error('判定結果保存エラー:', err);
    res.status(500).json({ error: 'DBエラー' });
  }
});

// サーバー起動時にテーブル作成
createTables().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});