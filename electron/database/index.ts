import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

type BetterSqliteDatabase = InstanceType<typeof Database>;

let db: BetterSqliteDatabase;

const SCHEMA = `
-- Accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  phone_number TEXT UNIQUE NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'disconnected',
  proxy_host TEXT,
  proxy_port INTEGER,
  proxy_username TEXT,
  proxy_password TEXT,
  session_path TEXT,
  qr_code TEXT,
  pairing_code TEXT,
  last_seen DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  campaign_type TEXT DEFAULT 'message',
  status TEXT DEFAULT 'draft',
  min_delay INTEGER DEFAULT 30,
  max_delay INTEGER DEFAULT 60,
  max_messages_per_day INTEGER DEFAULT 100,
  start_hour INTEGER DEFAULT 9,
  end_hour INTEGER DEFAULT 18,
  media_path TEXT,
  media_type TEXT,
  media_caption TEXT,
  scheduled_start_datetime DATETIME,
  messages_before_break INTEGER,
  break_duration INTEGER,
  skip_recent_contacts BOOLEAN DEFAULT 0,
  skip_recent_days INTEGER DEFAULT 7,
  target_group_id TEXT,
  target_group_name TEXT,
  group_source_account_id TEXT,
  source_tag_ids TEXT,
  message_variants TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME
);

-- Campaign accounts (which accounts participate)
CREATE TABLE IF NOT EXISTS campaign_accounts (
  campaign_id TEXT,
  account_id TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, account_id)
);

-- Campaign contacts
CREATE TABLE IF NOT EXISTS campaign_contacts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  phone_number TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  sent_by_account_id TEXT,
  sent_at DATETIME,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  result_code TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (sent_by_account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

-- Group campaigns (recurring scheduled broadcasts to WhatsApp groups)
CREATE TABLE IF NOT EXISTS group_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_id TEXT NOT NULL,
  message TEXT,
  media_path TEXT,
  media_type TEXT,
  media_caption TEXT,
  days_of_week TEXT NOT NULL,
  send_hour INTEGER NOT NULL,
  send_minute INTEGER NOT NULL DEFAULT 0,
  min_delay INTEGER DEFAULT 20,
  max_delay INTEGER DEFAULT 60,
  status TEXT DEFAULT 'active',
  last_run_date TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_campaign_targets (
  campaign_id TEXT,
  group_id TEXT NOT NULL,
  group_name TEXT,
  PRIMARY KEY (campaign_id, group_id),
  FOREIGN KEY (campaign_id) REFERENCES group_campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_campaign_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  group_id TEXT NOT NULL,
  group_name TEXT,
  status TEXT NOT NULL,
  error TEXT,
  run_date TEXT NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES group_campaigns(id) ON DELETE CASCADE
);

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  phone_number TEXT UNIQUE NOT NULL,
  name TEXT,
  custom_fields TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Custom Fields table
CREATE TABLE IF NOT EXISTS custom_fields (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  type TEXT DEFAULT 'text',
  required BOOLEAN DEFAULT 0,
  field_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Contact tags
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT,
  is_system BOOLEAN DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id TEXT,
  tag_id TEXT,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, tag_id)
);

-- Messages/Inbox
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  chat_id TEXT NOT NULL,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  sender_name TEXT,
  message_text TEXT,
  message_type TEXT DEFAULT 'text',
  is_from_me BOOLEAN DEFAULT 0,
  is_handled BOOLEAN DEFAULT 0,
  timestamp DATETIME NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- Warm-up sessions
CREATE TABLE IF NOT EXISTS warmup_sessions (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'active',
  min_delay INTEGER DEFAULT 300,
  max_delay INTEGER DEFAULT 900,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  stopped_at DATETIME
);

CREATE TABLE IF NOT EXISTS warmup_accounts (
  session_id TEXT,
  account_id TEXT,
  FOREIGN KEY (session_id) REFERENCES warmup_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, account_id)
);

CREATE TABLE IF NOT EXISTS warmup_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  from_account_id TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  message_text TEXT,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES warmup_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (from_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (to_account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- Stats table for dashboard
CREATE TABLE IF NOT EXISTS stats (
  date DATE PRIMARY KEY,
  messages_sent INTEGER DEFAULT 0,
  accounts_active INTEGER DEFAULT 0
);

-- Message Templates
CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  media_path TEXT,
  media_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Automation Flows
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT 1,
  account_ids TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flow_nodes (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  type TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  data TEXT,
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flow_edges (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT,
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flow_executions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  trigger_message_id TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

-- Global key/value app settings (DuoPlus API key, tap calibration, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Software Chats table (Inbox)
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  status TEXT DEFAULT 'unhandled',
  photo TEXT,
  name TEXT,
  last_message_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  UNIQUE(phone_number, account_id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_account_id ON messages(account_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_chats_account_id ON chats(account_id);
CREATE INDEX IF NOT EXISTS idx_chats_contact_id ON chats(contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_id ON campaign_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(status);
CREATE INDEX IF NOT EXISTS idx_contact_tags_contact_id ON contact_tags(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag_id ON contact_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_flow_nodes_flow_id ON flow_nodes(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_edges_flow_id ON flow_edges(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_executions_flow_id ON flow_executions(flow_id);
CREATE INDEX IF NOT EXISTS idx_warmup_messages_session_id ON warmup_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_warmup_messages_from_account ON warmup_messages(from_account_id);
CREATE INDEX IF NOT EXISTS idx_warmup_messages_sent_at ON warmup_messages(sent_at);

`;

export async function initDatabase() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'leadsender.db');

  // Ensure the directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Wait for a lock instead of failing immediately. The database is opened from
  // more than one place (app, maintenance scripts), and without this a
  // concurrent write surfaces as SQLITE_BUSY mid-operation.
  db.pragma('busy_timeout = 5000');
  db.pragma('encoding = "UTF-8"'); // Ensure UTF-8 encoding for Hebrew/Arabic support

  // Run schema
  db.exec(SCHEMA);

  // Add new columns if they don't exist (for media support)
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN media_filename TEXT;`);
  } catch (e) {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN media_mimetype TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // Add warmup flag column
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN is_warmup BOOLEAN DEFAULT 0;`);
  } catch (e) {
    // Column already exists
  }

  // Add profile picture URL column
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN profile_picture_url TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // Add proxy type column
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN proxy_type TEXT DEFAULT 'http';`);
  } catch (e) {
    // Column already exists
  }
  
  // Update existing accounts to use http instead of socks5
  try {
    db.exec(`UPDATE accounts SET proxy_type = 'http' WHERE proxy_type = 'socks5' OR proxy_type IS NULL;`);
  } catch (e) {
    // Ignore
  }

  // Add is_system column to tags
  try {
    db.exec(`ALTER TABLE tags ADD COLUMN is_system BOOLEAN DEFAULT 0;`);
  } catch (e) {
    // Column already exists
  }

  // Add media support to campaigns
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN media_path TEXT;`);
  } catch (e) {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN media_type TEXT;`);
  } catch (e) {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN media_caption TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // Add scheduled start datetime for campaign scheduling
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN scheduled_start_datetime DATETIME;`);
  } catch (e) {
    // Column already exists
  }

  // Add break configuration columns
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN messages_before_break INTEGER;`);
  } catch (e) {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN break_duration INTEGER;`);
  } catch (e) {
    // Column already exists
  }

  // Add skip recent contacts columns
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN skip_recent_contacts BOOLEAN DEFAULT 0;`);
  } catch (e) {
    // Column already exists
  }
  
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN skip_recent_days INTEGER DEFAULT 7;`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN campaign_type TEXT DEFAULT 'message';`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN target_group_id TEXT;`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN target_group_name TEXT;`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN group_source_account_id TEXT;`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN source_tag_ids TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // Add message variants for random message selection at send time
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN message_variants TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // Add custom_fields column to contacts
  try {
    db.exec(`ALTER TABLE contacts ADD COLUMN custom_fields TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // Add retry_count column to campaign_contacts
  try {
    db.exec(`ALTER TABLE campaign_contacts ADD COLUMN retry_count INTEGER DEFAULT 0;`);
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE campaign_contacts ADD COLUMN result_code TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // Add software_chat_id column to messages
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN software_chat_id TEXT REFERENCES chats(id);`);
  } catch (e) {
    // Column already exists
  }

  // Add type column to messages
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text';`);
  } catch (e) {
    // Column already exists
  }

  // Add is_read column to messages
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN is_read BOOLEAN DEFAULT 0;`);
  } catch (e) {
    // Column already exists
  }

  // Create index on software_chat_id (after column exists)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_software_chat_id ON messages(software_chat_id);`);
  } catch (e) {
    // Index already exists or column not ready
  }

  // Add DuoPlus cloud-phone device id to accounts
  try {
    db.exec(`ALTER TABLE accounts ADD COLUMN duoplus_device_id TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // Add send_mode to campaigns ('web' = WhatsApp Web, 'cloud_phone' = DuoPlus cloud phone)
  try {
    db.exec(`ALTER TABLE campaigns ADD COLUMN send_mode TEXT DEFAULT 'web';`);
  } catch (e) {
    // Column already exists
  }

  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // One-time migration: Clear all messages
  try {
    const migrationId = 'clear_messages_2026_01_29';
    const checkMigration = db.prepare(`SELECT id FROM migrations WHERE id = ?`);
    const migrationExists = checkMigration.get(migrationId);
    
    if (!migrationExists) {
      console.log('🔄 Running one-time migration: clearing all messages...');
      db.exec(`DELETE FROM messages;`);
      
      // Mark migration as applied
      const markMigration = db.prepare(`INSERT INTO migrations (id) VALUES (?)`);
      markMigration.run(migrationId);
      
      console.log('✅ Migration completed: all messages cleared');
    }
  } catch (e) {
    console.log('ℹ️ Migration already applied or error:', e);
  }

  // One-time migration: Remove assigned_account_id if it exists
  try {
    const migrationId = 'remove_assigned_account_id_2026_01_29';
    const checkMigration = db.prepare(`SELECT id FROM migrations WHERE id = ?`);
    const migrationExists = checkMigration.get(migrationId);
    
    if (!migrationExists) {
      // Check if column exists
      const checkStmt = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='campaign_contacts'`);
      const tableInfo = checkStmt.get() as any;
      
      if (tableInfo?.sql?.includes('assigned_account_id')) {
        console.log('🔄 Running one-time migration: removing assigned_account_id column...');
        
        // SQLite doesn't support DROP COLUMN, so we need to recreate the table
        db.exec(`
          -- Create new table without assigned_account_id
          CREATE TABLE campaign_contacts_new (
            id TEXT PRIMARY KEY,
            campaign_id TEXT,
            phone_number TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            sent_by_account_id TEXT,
            sent_at DATETIME,
            error TEXT,
            retry_count INTEGER DEFAULT 0,
            result_code TEXT,
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
            FOREIGN KEY (sent_by_account_id) REFERENCES accounts(id) ON DELETE SET NULL
          );
          
          -- Copy data (excluding assigned_account_id)
          INSERT INTO campaign_contacts_new (id, campaign_id, phone_number, status, sent_by_account_id, sent_at, error, retry_count, result_code)
          SELECT id, campaign_id, phone_number, status, sent_by_account_id, sent_at, error, COALESCE(retry_count, 0), NULL
          FROM campaign_contacts;
          
          -- Drop old table
          DROP TABLE campaign_contacts;
          
          -- Rename new table
          ALTER TABLE campaign_contacts_new RENAME TO campaign_contacts;
          
          -- Recreate indexes
          CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_id ON campaign_contacts(campaign_id);
          CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(status);
        `);
        
        console.log('✅ Migration completed: assigned_account_id removed');
      }
      
      // Mark migration as applied
      const markMigration = db.prepare(`INSERT INTO migrations (id) VALUES (?)`);
      markMigration.run(migrationId);
    }
  } catch (e) {
    console.log('ℹ️ Migration already applied or not needed');
  }

  try {
    const migrationId = 'dedupe_campaign_contacts_2026_05_07';
    const checkMigration = db.prepare(`SELECT id FROM migrations WHERE id = ?`);
    const migrationExists = checkMigration.get(migrationId);

    if (!migrationExists) {
      const duplicateGroups = db.prepare(`
        SELECT campaign_id, phone_number
        FROM campaign_contacts
        GROUP BY campaign_id, phone_number
        HAVING COUNT(*) > 1
      `).all() as Array<{ campaign_id: string; phone_number: string }>;

      const selectDuplicatesStmt = db.prepare(`
        SELECT id, status, sent_at, retry_count
        FROM campaign_contacts
        WHERE campaign_id = ? AND phone_number = ?
        ORDER BY
          CASE status
            WHEN 'sent' THEN 4
            WHEN 'sending' THEN 3
            WHEN 'pending' THEN 2
            WHEN 'failed' THEN 1
            ELSE 0
          END DESC,
          CASE WHEN sent_at IS NULL THEN 0 ELSE 1 END DESC,
          sent_at DESC,
          retry_count DESC,
          id ASC
      `);
      const deleteDuplicateStmt = db.prepare(`DELETE FROM campaign_contacts WHERE id = ?`);

      const dedupeCampaignContacts = db.transaction((groups: Array<{ campaign_id: string; phone_number: string }>) => {
        for (const group of groups) {
          const rows = selectDuplicatesStmt.all(group.campaign_id, group.phone_number) as Array<{ id: string }>;
          const [, ...duplicates] = rows;

          for (const duplicate of duplicates) {
            deleteDuplicateStmt.run(duplicate.id);
          }
        }
      });

      dedupeCampaignContacts(duplicateGroups);
      db.prepare(`INSERT INTO migrations (id) VALUES (?)`).run(migrationId);
    }

    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_phone ON campaign_contacts(campaign_id, phone_number);`);
  } catch (e) {
    console.log('ℹ️ Campaign contacts dedupe/unique index migration already applied or not needed');
  }

  // ==================== AI Chatbot (מערך היח״ש) ====================
  // Separate from the campaign tables: the chatbot feature owns these and
  // nothing in the bulk-sending path reads or writes them.
  db.exec(`
    -- One row per active/closed conversation with a WhatsApp user
    CREATE TABLE IF NOT EXISTS chatbot_conversations (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      active_intent TEXT,
      active_workflow TEXT,
      collected_data TEXT DEFAULT '{}',
      conversation_context TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      last_message_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chatbot_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES chatbot_conversations(id) ON DELETE CASCADE
    );

    -- Editable data sources the AI may retrieve from. One table, many categories,
    -- so a new knowledge source is a new category rather than new plumbing.
    CREATE TABLE IF NOT EXISTS chatbot_knowledge (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Completed submissions forwarded to staff (vehicle entry, קול קורא, ...)
    CREATE TABLE IF NOT EXISTS chatbot_requests (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      phone_number TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      staff_phone TEXT,
      status TEXT DEFAULT 'pending',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Questions the bot could not answer and handed to a human
    CREATE TABLE IF NOT EXISTS chatbot_escalations (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      phone_number TEXT NOT NULL,
      question TEXT NOT NULL,
      summary TEXT,
      staff_phone TEXT,
      status TEXT DEFAULT 'pending',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chatbot_errors (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      phone_number TEXT,
      error TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chatbot_conv_phone ON chatbot_conversations(phone_number, account_id);
    CREATE INDEX IF NOT EXISTS idx_chatbot_conv_status ON chatbot_conversations(status);
    CREATE INDEX IF NOT EXISTS idx_chatbot_messages_conv ON chatbot_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_chatbot_knowledge_cat ON chatbot_knowledge(category, is_active);
    CREATE INDEX IF NOT EXISTS idx_chatbot_requests_phone ON chatbot_requests(phone_number);
  `);

  // Seed demo/placeholder knowledge once, so the feature is explorable before
  // real organizational data is entered. Marked clearly as demo content.
  try {
    const migrationId = 'chatbot_seed_placeholder_knowledge_v1';
    const exists = db.prepare(`SELECT id FROM migrations WHERE id = ?`).get(migrationId);
    if (!exists) {
      const { v4: uuidv4 } = require('uuid');
      const insert = db.prepare(`
        INSERT INTO chatbot_knowledge (id, category, title, content, metadata, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `);
      const seed: Array<[string, string, string, Record<string, unknown>]> = [
        ['general', '[דוגמה] שעות פעילות סגל היח״ש',
          'סגל היח״ש זמין בימים א׳-ה׳ בין 08:00 ל-16:00. יש להחליף תוכן זה במידע האמיתי.',
          { demo: true }],
        ['orders', '[דוגמה] פקודת אוקטובר',
          'פקודת אוקטובר — נתוני דוגמה. יש להחליף בנתוני הפקודות האמיתיים.',
          { demo: true, status: 'הופצה', distributed_at: '2026-10-01' }],
        ['replacements', '[דוגמה] החלפת אוקטובר',
          'מחזור החלפה לדוגמה. יש להחליף בלו״ז האמיתי.',
          { demo: true, entry_date: '2026-10-05', exit_date: '2026-10-19' }],
        ['development_tracks', '[דוגמה] מסלול פיתוח לנגדים',
          'מסלול לדוגמה לנגדים. יש להחליף בתנאי הקבלה והמסלולים האמיתיים.',
          { demo: true, audience: 'נגדים' }],
        ['open_calls', '[דוגמה] קול קורא לתפקיד',
          'קול קורא לדוגמה. יש להחליף בקולות הקוראים האמיתיים.',
          { demo: true, status: 'פתוח', deadline: '2026-12-31' }],
      ];
      const seedAll = db.transaction(() => {
        for (const [category, title, content, metadata] of seed) {
          insert.run(uuidv4(), category, title, content, JSON.stringify(metadata));
        }
        db.prepare(`INSERT INTO migrations (id) VALUES (?)`).run(migrationId);
      });
      seedAll();
      console.log('🤖 Chatbot placeholder knowledge seeded');
    }
  } catch (e) {
    console.log('ℹ️ Chatbot knowledge seed skipped:', e);
  }

  // Create activities table for Recent Activity
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      related_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp DESC);
  `);

  // Create system BlackList tag if it doesn't exist
  try {
    const checkBlacklistStmt = db.prepare(`SELECT id FROM tags WHERE name = 'BlackList'`);
    const blacklistExists = checkBlacklistStmt.get();
    
    if (!blacklistExists) {
      console.log('🏷️ Creating system BlackList tag...');
      const createBlacklistStmt = db.prepare(`
        INSERT INTO tags (id, name, color, is_system)
        VALUES (?, 'BlackList', '#000000', 1)
      `);
      const { v4: uuidv4 } = require('uuid');
      createBlacklistStmt.run(uuidv4());
      console.log('✅ BlackList tag created');
    } else {
      // Make sure existing BlackList is marked as system
      console.log('🏷️ Ensuring BlackList is marked as system tag...');
      const updateStmt = db.prepare(`UPDATE tags SET is_system = 1 WHERE name = 'BlackList'`);
      updateStmt.run();
    }
  } catch (e) {
    console.log('ℹ️ BlackList tag setup:', e);
  }

  // One-time migration: Create chats from existing messages
  try {
    const migrationId = 'create_chats_from_messages_2026_02_26';
    const checkMigration = db.prepare(`SELECT id FROM migrations WHERE id = ?`);
    const migrationExists = checkMigration.get(migrationId);
    
    if (!migrationExists) {
      console.log('🔄 Running one-time migration: creating chats from existing messages...');
      const { v4: uuidv4 } = require('uuid');
      
      // Get all unique chat_id + account_id combinations from messages
      const existingChats = db.prepare(`
        SELECT DISTINCT chat_id, account_id FROM messages 
        WHERE chat_id IS NOT NULL AND account_id IS NOT NULL
      `).all() as any[];
      
      let createdCount = 0;
      
      for (const chat of existingChats) {
        try {
          // Extract phone number from chat_id
          const phoneNumber = chat.chat_id.split('@')[0];
          if (!phoneNumber) continue;
          
          // Find or get name from messages
          const nameResult = db.prepare(`
            SELECT sender_name, from_number, to_number FROM messages 
            WHERE chat_id = ? AND account_id = ? AND sender_name IS NOT NULL AND is_from_me = 0
            ORDER BY timestamp DESC LIMIT 1
          `).get(chat.chat_id, chat.account_id) as any;
          
          const contactName = nameResult?.sender_name || null;
          
          // Determine the other person's phone number
          let otherNumber = phoneNumber;
          if (!nameResult) {
            const anyMsg = db.prepare(`
              SELECT from_number, to_number, is_from_me FROM messages 
              WHERE chat_id = ? AND account_id = ? 
              ORDER BY timestamp DESC LIMIT 1
            `).get(chat.chat_id, chat.account_id) as any;
            if (anyMsg) {
              otherNumber = anyMsg.is_from_me ? anyMsg.to_number : anyMsg.from_number;
            }
          } else {
            otherNumber = nameResult.from_number;
          }
          
          // Normalize phone number for contact search
          const digitsOnly = otherNumber.replace(/\D/g, '');
          
          // Find existing contact by phone number (try multiple formats)
          let contact = null;
          const variants = [otherNumber, digitsOnly];
          if (digitsOnly.startsWith('972') && digitsOnly.length >= 12) {
            variants.push('0' + digitsOnly.slice(3));
          }
          if (digitsOnly.length >= 9) {
            variants.push(digitsOnly.slice(-9));
          }
          
          for (const variant of variants) {
            contact = db.prepare(`SELECT id, name FROM contacts WHERE phone_number LIKE '%' || ? || '%'`).get(variant) as any;
            if (contact) break;
          }
          
          // Create contact if not found
          if (!contact) {
            const contactId = uuidv4();
            db.prepare(`INSERT INTO contacts (id, phone_number, name) VALUES (?, ?, ?)`).run(contactId, otherNumber, contactName);
            contact = { id: contactId, name: contactName };
          }
          
          // Get last message timestamp
          const lastMsg = db.prepare(`
            SELECT MAX(timestamp) as last_ts FROM messages WHERE chat_id = ? AND account_id = ?
          `).get(chat.chat_id, chat.account_id) as any;
          
          // Create the chat
          const chatId = uuidv4();
          const chatName = contact.name || contactName || null;
          
          db.prepare(`
            INSERT OR IGNORE INTO chats (id, contact_id, account_id, phone_number, status, name, last_message_at)
            VALUES (?, ?, ?, ?, 'unhandled', ?, ?)
          `).run(chatId, contact.id, chat.account_id, otherNumber, chatName, lastMsg?.last_ts || null);
          
          // Update all messages with this chat_id + account_id to point to the new software chat
          db.prepare(`
            UPDATE messages SET software_chat_id = ? WHERE chat_id = ? AND account_id = ?
          `).run(chatId, chat.chat_id, chat.account_id);
          
          createdCount++;
        } catch (chatError) {
          console.log('⚠️ Error creating chat for:', chat.chat_id, chatError);
        }
      }
      
      // Mark migration as applied
      db.prepare(`INSERT INTO migrations (id) VALUES (?)`).run(migrationId);
      console.log(`✅ Migration completed: ${createdCount} chats created from existing messages`);
    }
  } catch (e) {
    console.log('ℹ️ Chat migration error:', e);
  }

  console.log('Database initialized at:', dbPath);
}

export function getDatabase(): BetterSqliteDatabase {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export { Database };
