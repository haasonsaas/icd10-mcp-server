import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import type {
  ICD10Code,
  SearchOptions,
  ValidationResult,
  DatabaseStats,
  HierarchyDirection
} from '../types/icd10.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ICD10Database {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    if (!dbPath) {
      const dataDir = join(__dirname, '../../data');
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      dbPath = join(dataDir, 'icd10.db');
    }
    
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    
    // Enable WAL mode and optimizations
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    
    this.initializeSchema();
    this.createIndexes();
  }

  private initializeSchema(): void {
    // Main ICD-10 codes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS icd10_codes (
        code TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        category TEXT,
        subcategory TEXT,
        chapter_code TEXT,
        chapter_name TEXT,
        is_billable BOOLEAN DEFAULT 0,
        is_valid_primary BOOLEAN DEFAULT 1,
        effective_date DATE,
        end_date DATE,
        revision_year INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // FTS5 virtual table for fast text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS icd10_fts USING fts5(
        code,
        description,
        category,
        chapter_name,
        content='icd10_codes',
        content_rowid='rowid'
      )
    `);

    // Medical terminology synonyms table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS medical_synonyms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term TEXT NOT NULL,
        synonym TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        context TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for synonym lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_synonym_term ON medical_synonyms(term);
      CREATE INDEX IF NOT EXISTS idx_synonym_synonym ON medical_synonyms(synonym);
    `);

    // Common search patterns table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        expansion TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Initialize with common medical terminology if empty
    this.initializeMedicalSynonyms();

    // Triggers to keep FTS5 in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS icd10_fts_insert AFTER INSERT ON icd10_codes
      BEGIN
        INSERT INTO icd10_fts(rowid, code, description, category, chapter_name)
        VALUES (new.rowid, new.code, new.description, new.category, new.chapter_name);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS icd10_fts_delete AFTER DELETE ON icd10_codes
      BEGIN
        INSERT INTO icd10_fts(icd10_fts, rowid, code, description, category, chapter_name)
        VALUES ('delete', old.rowid, old.code, old.description, old.category, old.chapter_name);
      END
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS icd10_fts_update AFTER UPDATE ON icd10_codes
      BEGIN
        INSERT INTO icd10_fts(icd10_fts, rowid, code, description, category, chapter_name)
        VALUES ('delete', old.rowid, old.code, old.description, old.category, old.chapter_name);
        INSERT INTO icd10_fts(rowid, code, description, category, chapter_name)
        VALUES (new.rowid, new.code, new.description, new.category, new.chapter_name);
      END
    `);
  }

  private createIndexes(): void {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_code_prefix ON icd10_codes(substr(code, 1, 3))',
      'CREATE INDEX IF NOT EXISTS idx_billable ON icd10_codes(is_billable) WHERE is_billable = 1',
      'CREATE INDEX IF NOT EXISTS idx_chapter ON icd10_codes(chapter_code)',
      'CREATE INDEX IF NOT EXISTS idx_category ON icd10_codes(category)',
      'CREATE INDEX IF NOT EXISTS idx_effective_date ON icd10_codes(effective_date)',
      'CREATE INDEX IF NOT EXISTS idx_revision_year ON icd10_codes(revision_year)',
    ];

    for (const indexSql of indexes) {
      this.db.exec(indexSql);
    }
  }

  getCode(code: string, effectiveDate?: string): ICD10Code | null {
    let query = 'SELECT * FROM icd10_codes WHERE code = ?';
    const params: any[] = [code.toUpperCase()];

    if (effectiveDate) {
      query += ' AND (effective_date IS NULL OR effective_date <= ?) AND (end_date IS NULL OR end_date > ?)';
      params.push(effectiveDate, effectiveDate);
    }

    const stmt = this.db.prepare(query);
    const result = stmt.get(...params) as ICD10Code | undefined;
    
    return result || null;
  }

  searchCodes(query: string, options: SearchOptions = {}): ICD10Code[] {
    const {
      limit = 20,
      category_filter,
      billable_only = false,
      effective_date
    } = options;

    // Enhanced query processing for common medical terms
    const enhancedQuery = this.enhanceSearchQuery(query);

    // Build FTS query with enhanced terms
    const ftsQuery = `
      SELECT rowid, rank FROM icd10_fts 
      WHERE icd10_fts MATCH ? 
      ORDER BY rank 
      LIMIT ?
    `;

    // Join with main table for filtering
    let sql = `
      SELECT c.* FROM icd10_codes c
      INNER JOIN (${ftsQuery}) fts ON c.rowid = fts.rowid
      WHERE 1=1
    `;

    const params: any[] = [enhancedQuery, limit * 2]; // Get more results to filter

    if (category_filter && category_filter.length > 0) {
      const placeholders = category_filter.map(() => '?').join(',');
      sql += ` AND c.category IN (${placeholders})`;
      params.push(...category_filter);
    }

    if (billable_only) {
      sql += ' AND c.is_billable = 1';
    }

    if (effective_date) {
      sql += ' AND (c.effective_date IS NULL OR c.effective_date <= ?) AND (c.end_date IS NULL OR c.end_date > ?)';
      params.push(effective_date, effective_date);
    }

    sql += ` ORDER BY fts.rank LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as ICD10Code[];
  }

  validateCodes(codes: string[], checkBillable = false, effectiveDate?: string): Record<string, ValidationResult> {
    if (codes.length === 0) {
      return {};
    }

    // Normalize codes
    const normalizedCodes = codes.map(code => code.toUpperCase());
    const placeholders = normalizedCodes.map(() => '?').join(',');

    let query = `
      SELECT code, description, is_billable, effective_date, end_date 
      FROM icd10_codes 
      WHERE code IN (${placeholders})
    `;

    const params: any[] = [...normalizedCodes];

    if (effectiveDate) {
      query += ' AND (effective_date IS NULL OR effective_date <= ?) AND (end_date IS NULL OR end_date > ?)';
      params.push(effectiveDate, effectiveDate);
    }

    const stmt = this.db.prepare(query);
    const foundCodes = stmt.all(...params) as ICD10Code[];
    const foundCodeMap = new Map(foundCodes.map(code => [code.code, code]));

    // Build result with validation status
    const result: Record<string, ValidationResult> = {};
    
    for (const code of normalizedCodes) {
      const codeData = foundCodeMap.get(code);
      
      if (codeData) {
        result[code] = {
          valid: true,
          billable: Boolean(codeData.is_billable),
          description: codeData.description,
          effective_date: codeData.effective_date,
          end_date: codeData.end_date
        };

        if (checkBillable && !codeData.is_billable) {
          result[code].warning = 'Code exists but is not billable';
        }
      } else {
        result[code] = {
          valid: false,
          billable: false,
          error: 'Code not found'
        };
      }
    }

    return result;
  }

  getHierarchy(code: string, direction: keyof HierarchyDirection = 'children', maxDepth = 2): ICD10Code[] {
    const normalizedCode = code.toUpperCase();
    
    if (direction === 'children') {
      // Find child codes (more specific)
      const stmt = this.db.prepare(`
        SELECT * FROM icd10_codes 
        WHERE code LIKE ? AND code != ? 
        ORDER BY code
      `);
      return stmt.all(`${normalizedCode}%`, normalizedCode) as ICD10Code[];
      
    } else if (direction === 'parents') {
      // Find parent codes (less specific)
      const parents: ICD10Code[] = [];
      let current = normalizedCode;
      
      while (current.length > 1 && parents.length < maxDepth) {
        if (current.endsWith('.')) {
          current = current.slice(0, -1);
        } else if (current.includes('.')) {
          const lastDotIndex = current.lastIndexOf('.');
          current = current.substring(0, lastDotIndex);
        } else {
          current = current.slice(0, -1);
        }
        
        if (current) {
          const stmt = this.db.prepare('SELECT * FROM icd10_codes WHERE code = ?');
          const parent = stmt.get(current) as ICD10Code | undefined;
          if (parent) {
            parents.push(parent);
          }
        }
      }
      
      return parents;
      
    } else if (direction === 'siblings') {
      // Find sibling codes (same level)
      let stmt;
      let params: any[];
      
      if (normalizedCode.includes('.')) {
        const parent = normalizedCode.substring(0, normalizedCode.lastIndexOf('.'));
        stmt = this.db.prepare(`
          SELECT * FROM icd10_codes 
          WHERE code LIKE ? AND code != ? 
          ORDER BY code
        `);
        params = [`${parent}.%`, normalizedCode];
      } else {
        const parent = normalizedCode.length > 1 ? normalizedCode.slice(0, -1) : normalizedCode;
        stmt = this.db.prepare(`
          SELECT * FROM icd10_codes 
          WHERE code LIKE ? AND LENGTH(code) = ? AND code != ? 
          ORDER BY code
        `);
        params = [`${parent}%`, normalizedCode.length, normalizedCode];
      }
      
      return stmt.all(...params) as ICD10Code[];
    }
    
    return [];
  }

  insertCode(codeData: Partial<ICD10Code>): boolean {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO icd10_codes (
        code, description, category, subcategory, chapter_code, chapter_name,
        is_billable, is_valid_primary, effective_date, end_date, revision_year
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        codeData.code?.toUpperCase() || '',
        codeData.description || '',
        codeData.category || '',
        codeData.subcategory || '',
        codeData.chapter_code || '',
        codeData.chapter_name || '',
        codeData.is_billable ? 1 : 0,
        codeData.is_valid_primary ? 1 : 0,
        codeData.effective_date,
        codeData.end_date,
        codeData.revision_year
      );
      return true;
    } catch (error) {
      console.error('Error inserting code:', error);
      return false;
    }
  }

  getStats(): DatabaseStats {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as total FROM icd10_codes');
    const billableStmt = this.db.prepare('SELECT COUNT(*) as billable FROM icd10_codes WHERE is_billable = 1');
    const chaptersStmt = this.db.prepare('SELECT COUNT(DISTINCT chapter_code) as chapters FROM icd10_codes');
    const revisionStmt = this.db.prepare('SELECT MAX(revision_year) as latest_year FROM icd10_codes');

    const total = (totalStmt.get() as any).total;
    const billable = (billableStmt.get() as any).billable;
    const chapters = (chaptersStmt.get() as any).chapters;
    const latest_revision = (revisionStmt.get() as any).latest_year;

    return {
      total_codes: total,
      billable_codes: billable,
      chapters: chapters,
      latest_revision: latest_revision
    };
  }

  private initializeMedicalSynonyms(): void {
    // Check if synonyms already exist
    const count = this.db.prepare('SELECT COUNT(*) as count FROM medical_synonyms').get() as { count: number };
    if (count.count > 0) return;

    // Insert common medical synonyms
    const insertSynonym = this.db.prepare(`
      INSERT INTO medical_synonyms (term, synonym, weight, context) 
      VALUES (?, ?, ?, ?)
    `);

    const synonymData = [
      // Colloquial to medical mappings
      ['broken', 'fracture', 1.0, 'injury'],
      ['broken', 'fractured', 0.9, 'injury'],
      ['heart attack', 'myocardial infarction', 1.0, 'cardiac'],
      ['heart attack', 'MI', 0.8, 'cardiac'],
      ['heart attack', 'cardiac arrest', 0.7, 'cardiac'],
      ['stroke', 'cerebrovascular accident', 1.0, 'neurological'],
      ['stroke', 'CVA', 0.9, 'neurological'],
      ['high blood pressure', 'hypertension', 1.0, 'cardiovascular'],
      ['low blood pressure', 'hypotension', 1.0, 'cardiovascular'],
      ['sugar', 'diabetes', 0.8, 'endocrine'],
      ['sugar', 'glucose', 0.7, 'endocrine'],
      
      // Body part synonyms
      ['kidney', 'renal', 1.0, 'anatomy'],
      ['kidney', 'nephro', 0.9, 'anatomy'],
      ['liver', 'hepatic', 1.0, 'anatomy'],
      ['liver', 'hepato', 0.9, 'anatomy'],
      ['lung', 'pulmonary', 1.0, 'anatomy'],
      ['lung', 'pneumo', 0.9, 'anatomy'],
      ['brain', 'cerebral', 1.0, 'anatomy'],
      ['brain', 'cranial', 0.9, 'anatomy'],
      ['stomach', 'gastric', 1.0, 'anatomy'],
      ['stomach', 'gastro', 0.9, 'anatomy'],
      
      // Symptom synonyms
      ['pain', 'algia', 0.9, 'symptom'],
      ['pain', 'ache', 0.8, 'symptom'],
      ['fever', 'pyrexia', 1.0, 'symptom'],
      ['fever', 'febrile', 0.9, 'symptom'],
      ['headache', 'cephalgia', 1.0, 'symptom'],
      ['headache', 'migraine', 0.7, 'symptom'],
      ['throwing up', 'vomiting', 1.0, 'symptom'],
      ['throwing up', 'emesis', 0.9, 'symptom'],
      
      // Common conditions
      ['cancer', 'malignant', 0.9, 'condition'],
      ['cancer', 'neoplasm', 1.0, 'condition'],
      ['cancer', 'tumor', 0.8, 'condition'],
      ['cancer', 'carcinoma', 0.9, 'condition'],
      ['infection', 'infectious', 0.9, 'condition'],
      ['infection', 'sepsis', 0.7, 'condition'],
      ['inflammation', 'inflammatory', 1.0, 'condition'],
      ['inflammation', 'itis', 0.8, 'condition']
    ];

    const transaction = this.db.transaction(() => {
      for (const [term, synonym, weight, context] of synonymData) {
        insertSynonym.run(term, synonym, weight, context);
      }
    });
    
    transaction();

    // Insert common search patterns
    const insertPattern = this.db.prepare(`
      INSERT INTO search_patterns (pattern, expansion, priority) 
      VALUES (?, ?, ?)
    `);

    const patterns = [
      ['broken {BODYPART}', 'fracture {BODYPART}', 10],
      ['{BODYPART} fracture', 'fracture {BODYPART}', 9],
      ['pain in {BODYPART}', '{BODYPART} pain OR {BODYPART} algia', 8],
      ['{BODYPART} pain', '{BODYPART} algia OR painful {BODYPART}', 8],
      ['can\'t breathe', 'dyspnea OR respiratory distress OR shortness of breath', 10],
      ['trouble breathing', 'dyspnea OR respiratory distress', 9],
      ['chest pain', 'angina OR thoracic pain OR cardiac pain', 9]
    ];

    const patternTransaction = this.db.transaction(() => {
      for (const [pattern, expansion, priority] of patterns) {
        insertPattern.run(pattern, expansion, priority);
      }
    });
    
    patternTransaction();
  }

  private enhanceSearchQuery(query: string): string {
    const lowerQuery = query.toLowerCase().trim();
    
    // First, check for exact pattern matches
    const patternStmt = this.db.prepare(`
      SELECT pattern, expansion FROM search_patterns 
      ORDER BY priority DESC
    `);
    const patterns = patternStmt.all() as Array<{ pattern: string; expansion: string }>;
    
    for (const { pattern, expansion } of patterns) {
      // Simple pattern matching (could be enhanced with regex)
      const bodyParts = ['arm', 'leg', 'bone', 'head', 'chest', 'back', 'neck', 'shoulder', 'knee', 'hip', 'ankle', 'wrist', 'elbow'];
      
      for (const bodyPart of bodyParts) {
        const concretePattern = pattern.replace('{BODYPART}', bodyPart);
        if (lowerQuery.includes(concretePattern.toLowerCase())) {
          return expansion.replace('{BODYPART}', bodyPart);
        }
      }
      
      // Check for non-parameterized patterns
      if (!pattern.includes('{') && lowerQuery.includes(pattern.toLowerCase())) {
        return expansion;
      }
    }
    
    // If no pattern matches, expand individual terms using synonyms
    const words = lowerQuery.split(/\s+/);
    const expandedTerms = new Set<string>();
    
    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '');
      if (cleanWord.length < 3) continue;
      
      expandedTerms.add(cleanWord);
      
      // Look up synonyms
      const synonymStmt = this.db.prepare(`
        SELECT synonym, weight FROM medical_synonyms 
        WHERE term = ? 
        ORDER BY weight DESC
      `);
      const synonyms = synonymStmt.all(cleanWord) as Array<{ synonym: string; weight: number }>;
      
      for (const { synonym } of synonyms) {
        expandedTerms.add(synonym);
      }
    }
    
    return Array.from(expandedTerms).join(' OR ');
  }

  addMedicalSynonym(term: string, synonym: string, weight = 1.0, context?: string): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO medical_synonyms (term, synonym, weight, context) 
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(term.toLowerCase(), synonym.toLowerCase(), weight, context);
      return true;
    } catch (error) {
      console.error('Error adding synonym:', error);
      return false;
    }
  }

  addSearchPattern(pattern: string, expansion: string, priority = 0): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO search_patterns (pattern, expansion, priority) 
        VALUES (?, ?, ?)
      `);
      stmt.run(pattern.toLowerCase(), expansion, priority);
      return true;
    } catch (error) {
      console.error('Error adding search pattern:', error);
      return false;
    }
  }

  close(): void {
    this.db.close();
  }
}