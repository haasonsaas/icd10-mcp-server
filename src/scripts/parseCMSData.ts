#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ICD10Database } from '../database/ICD10Database.js';
import type { ICD10Code } from '../types/icd10.js';

// ICD-10 chapter mappings
const ICD10_CHAPTERS = {
  'A00-B99': 'Certain infectious and parasitic diseases',
  'C00-D49': 'Neoplasms',
  'D50-D89': 'Diseases of the blood and blood-forming organs and certain disorders involving the immune mechanism',
  'E00-E89': 'Endocrine, nutritional and metabolic diseases',
  'F01-F99': 'Mental, Behavioral and Neurodevelopmental disorders',
  'G00-G99': 'Diseases of the nervous system',
  'H00-H59': 'Diseases of the eye and adnexa',
  'H60-H95': 'Diseases of the ear and mastoid process',
  'I00-I99': 'Diseases of the circulatory system',
  'J00-J99': 'Diseases of the respiratory system',
  'K00-K95': 'Diseases of the digestive system',
  'L00-L99': 'Diseases of the skin and subcutaneous tissue',
  'M00-M99': 'Diseases of the musculoskeletal system and connective tissue',
  'N00-N99': 'Diseases of the genitourinary system',
  'O00-O9A': 'Pregnancy, childbirth and the puerperium',
  'P00-P96': 'Certain conditions originating in the perinatal period',
  'Q00-Q99': 'Congenital malformations, deformations and chromosomal abnormalities',
  'R00-R99': 'Symptoms, signs and abnormal clinical and laboratory findings, not elsewhere classified',
  'S00-T88': 'Injury, poisoning and certain other consequences of external causes',
  'V00-Y99': 'External causes of morbidity',
  'Z00-Z99': 'Factors influencing health status and contact with health services'
};

export class CMSDataParser {
  private db: ICD10Database;

  constructor(dbPath?: string) {
    this.db = new ICD10Database(dbPath);
  }

  private getChapterForCode(code: string): { chapter_code: string; chapter_name: string } {
    const firstChar = code.charAt(0);
    const numericPart = code.match(/\d+/)?.[0];
    
    if (!numericPart) {
      return { chapter_code: '', chapter_name: '' };
    }

    const num = parseInt(numericPart);

    // Map based on first character and numeric range
    for (const [range, name] of Object.entries(ICD10_CHAPTERS)) {
      const [start, end] = range.split('-');
      
      if (this.codeInRange(code, start, end)) {
        return { chapter_code: range, chapter_name: name };
      }
    }

    return { chapter_code: '', chapter_name: '' };
  }

  private codeInRange(code: string, start: string, end: string): boolean {
    const codeChar = code.charAt(0);
    const startChar = start.charAt(0);
    const endChar = end.charAt(0);

    // Check character range
    if (codeChar < startChar || codeChar > endChar) {
      return false;
    }

    // If same character, check numeric range
    if (codeChar === startChar && codeChar === endChar) {
      const codeNum = parseInt(code.match(/\d+/)?.[0] || '0');
      const startNum = parseInt(start.match(/\d+/)?.[0] || '0');
      const endNum = parseInt(end.match(/\d+/)?.[0] || '999');
      
      return codeNum >= startNum && codeNum <= endNum;
    }

    return true;
  }

  private getCategory(code: string): string {
    // Category is typically the first 3 characters
    return code.substring(0, 3);
  }

  private getSubcategory(code: string): string {
    // Subcategory includes the decimal portion
    return code.includes('.') ? code : code.substring(0, 4);
  }

  private isBillableCode(code: string, description: string): boolean {
    // Updated heuristics for CMS ICD-10-CM codes
    
    // Codes ending in 'X' or 'A' are often placeholder/non-billable
    if (code.endsWith('X') || code.endsWith('x')) {
      return false;
    }

    // 3-character codes are category-level and typically not billable
    if (code.length === 3) {
      return false;
    }

    // Codes with decimal points are usually billable
    if (code.includes('.')) {
      return true;
    }

    // 4+ character codes are typically subcategory level and billable
    if (code.length >= 4) {
      return true;
    }

    return false;
  }

  private isHeaderLine(line: string): boolean {
    const upperLine = line.toUpperCase();
    const headerIndicators = [
      'CHAPTER',
      'BLOCK',
      'CATEGORY',
      'EXCLUDES',
      'INCLUDES',
      'NOTE:',
      'CODE FIRST',
      'USE ADDITIONAL',
      'TABULAR LIST',
      '(CONTINUED)'
    ];

    return headerIndicators.some(indicator => upperLine.includes(indicator));
  }

  private parseCodeLine(line: string, year: number): Partial<ICD10Code> | null {
    // Remove any leading/trailing whitespace
    line = line.trim();
    
    if (!line || this.isHeaderLine(line)) {
      return null;
    }

    // Pattern for CMS format: CODE followed by spaces, then description
    // Example: "A000    Cholera due to Vibrio cholerae 01, biovar cholerae"
    const match = line.match(/^([A-Z]\d{2,3}(?:\d+)?(?:\.[A-Z0-9]+)?)\s+(.+)$/);
    
    if (match) {
      const [, code, description] = match;
      
      if (code && description && description.trim().length > 3) {
        const cleanCode = code.trim().toUpperCase();
        const cleanDescription = description.trim();
        
        // Skip if description looks like a header
        if (this.isHeaderLine(cleanDescription)) {
          return null;
        }

        const chapter = this.getChapterForCode(cleanCode);
        
        return {
          code: cleanCode,
          description: cleanDescription,
          category: this.getCategory(cleanCode),
          subcategory: this.getSubcategory(cleanCode),
          chapter_code: chapter.chapter_code,
          chapter_name: chapter.chapter_name,
          is_billable: this.isBillableCode(cleanCode, cleanDescription),
          is_valid_primary: true,
          effective_date: `${year}-10-01`, // ICD-10 updates on October 1st
          revision_year: year
        };
      }
    }

    return null;
  }

  private findTabularFile(extractDir: string): string {
    const searchPatterns = [
      /icd10cm.*tabular.*order/i,
      /icd.*10.*cm.*tabular/i,
      /tabular.*order/i,
      /icd10cm.*codes/i,
      /order.*tabular/i
    ];

    const findInDirectory = (dir: string): string | null => {
      try {
        const files = readdirSync(dir);
        
        for (const file of files) {
          const fullPath = join(dir, file);
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            const found = findInDirectory(fullPath);
            if (found) return found;
          } else if (file.toLowerCase().endsWith('.txt') || file.toLowerCase().endsWith('.dat')) {
            for (const pattern of searchPatterns) {
              if (pattern.test(file)) {
                return fullPath;
              }
            }
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not read directory ${dir}:`, error);
      }
      
      return null;
    };

    const found = findInDirectory(extractDir);
    if (!found) {
      // List available files to help debug
      console.log('Available files in extract directory:');
      try {
        const listFiles = (dir: string, indent = '') => {
          const files = readdirSync(dir);
          for (const file of files.slice(0, 20)) { // Limit output
            const fullPath = join(dir, file);
            console.log(`${indent}${file}`);
            if (statSync(fullPath).isDirectory() && indent.length < 6) {
              listFiles(fullPath, indent + '  ');
            }
          }
        };
        listFiles(extractDir);
      } catch (error) {
        console.log('Error listing files:', error);
      }
      
      throw new Error('Could not find ICD-10-CM tabular order file');
    }

    return found;
  }

  async parseAndLoad(extractDir: string, year: number): Promise<number> {
    console.log(`📖 Parsing CMS ICD-10-CM data for year ${year}...`);
    console.log(`📁 Extract directory: ${extractDir}`);

    // Find the tabular order file
    const tabularFile = this.findTabularFile(extractDir);
    console.log(`📄 Found tabular file: ${tabularFile}`);

    // Read and parse the file
    const content = readFileSync(tabularFile, 'utf-8');
    const lines = content.split('\n');
    
    console.log(`📝 Processing ${lines.length} lines...`);

    let loadedCount = 0;
    let skippedCount = 0;
    
    for (const [index, line] of lines.entries()) {
      if (index > 0 && index % 1000 === 0) {
        console.log(`   Processed ${index}/${lines.length} lines (${loadedCount} codes loaded)`);
      }

      const codeData = this.parseCodeLine(line, year);
      if (codeData && codeData.code) {
        if (this.db.insertCode(codeData)) {
          loadedCount++;
        }
      } else {
        skippedCount++;
      }
    }

    console.log(`✅ Successfully loaded ${loadedCount} ICD-10 codes`);
    console.log(`⏭️  Skipped ${skippedCount} non-code lines`);
    
    return loadedCount;
  }

  getStats() {
    return this.db.getStats();
  }

  close() {
    this.db.close();
  }
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  let year = 2024;
  let extractDir = '';

  // Parse command line arguments
  for (const arg of args) {
    if (arg.startsWith('--year=')) {
      year = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--dir=')) {
      extractDir = arg.split('=')[1];
    } else if (!extractDir) {
      extractDir = arg;
    }
  }

  if (!extractDir) {
    extractDir = join(process.cwd(), 'cms_data', `cms_icd10_${year}`);
  }

  console.log('🏥 CMS ICD-10-CM Data Parser');
  console.log('=' .repeat(50));
  console.log(`📅 Year: ${year}`);
  console.log(`📁 Directory: ${extractDir}`);
  console.log('');

  try {
    const parser = new CMSDataParser();
    const loadedCount = await parser.parseAndLoad(extractDir, year);
    
    // Show final statistics
    const stats = parser.getStats();
    console.log('');
    console.log('📊 Final Database Statistics:');
    console.log(`   Total codes: ${stats.total_codes}`);
    console.log(`   Billable codes: ${stats.billable_codes}`);
    console.log(`   Chapters: ${stats.chapters}`);
    console.log(`   Latest revision: ${stats.latest_revision}`);
    
    parser.close();
    
    console.log('');
    console.log('🎉 Parsing completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('  npm run benchmark');
    
  } catch (error) {
    console.error('❌ Parsing failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}