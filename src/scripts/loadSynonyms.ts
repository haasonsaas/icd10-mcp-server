#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ICD10Database } from '../database/ICD10Database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SynonymConfig {
  synonyms: {
    [category: string]: {
      [term: string]: string[];
    };
  };
  patterns: Array<{
    pattern: string;
    expansion: string;
    priority: number;
  }>;
  body_parts_list?: string[];
  actions_list?: string[];
}

async function loadSynonymsFromConfig(configPath?: string) {
  const db = new ICD10Database();
  
  try {
    // Use provided path or default
    const synonymPath = configPath || join(__dirname, '../config/medical-synonyms.json');
    console.log(`📚 Loading synonyms from: ${synonymPath}`);
    
    const configData = readFileSync(synonymPath, 'utf-8');
    const config: SynonymConfig = JSON.parse(configData);
    
    let synonymCount = 0;
    let patternCount = 0;
    
    // Load synonyms by category
    for (const [category, terms] of Object.entries(config.synonyms)) {
      console.log(`\n📁 Processing category: ${category}`);
      
      for (const [term, synonyms] of Object.entries(terms)) {
        for (let i = 0; i < synonyms.length; i++) {
          const synonym = synonyms[i];
          const weight = 1.0 - (i * 0.1); // Decrease weight for later synonyms
          
          if (db.addMedicalSynonym(term, synonym, weight, category)) {
            synonymCount++;
            console.log(`  ✅ Added: ${term} → ${synonym} (weight: ${weight})`);
          }
        }
      }
    }
    
    // Load search patterns
    console.log('\n🔍 Loading search patterns...');
    for (const pattern of config.patterns) {
      if (db.addSearchPattern(pattern.pattern, pattern.expansion, pattern.priority)) {
        patternCount++;
        console.log(`  ✅ Added pattern: "${pattern.pattern}" → "${pattern.expansion}"`);
      }
    }
    
    console.log('\n📊 Summary:');
    console.log(`  Total synonyms loaded: ${synonymCount}`);
    console.log(`  Total patterns loaded: ${patternCount}`);
    console.log('\n✨ Synonym loading completed successfully!');
    
  } catch (error) {
    console.error('❌ Error loading synonyms:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const configPath = process.argv[2];
  loadSynonymsFromConfig(configPath);
}