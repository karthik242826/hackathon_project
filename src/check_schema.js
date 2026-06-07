const db = require('better-sqlite3')('hms.db');
const tables = db.prepare("SELECT sql FROM sqlite_master WHERE type='table'").all();
tables.forEach(t => console.log(t.sql));
