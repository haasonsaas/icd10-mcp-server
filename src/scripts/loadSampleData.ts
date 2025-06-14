#!/usr/bin/env node
import { ICD10Database } from '../database/ICD10Database.js';
import type { ICD10Code } from '../types/icd10.js';

const sampleCodes: Partial<ICD10Code>[] = [
  // Diabetes codes (E10-E14)
  {
    code: 'E10',
    description: 'Type 1 diabetes mellitus',
    category: 'E10',
    subcategory: 'E10',
    chapter_code: 'E00-E89',
    chapter_name: 'Endocrine, nutritional and metabolic diseases',
    is_billable: false,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'E10.9',
    description: 'Type 1 diabetes mellitus without complications',
    category: 'E10',
    subcategory: 'E10.9',
    chapter_code: 'E00-E89',
    chapter_name: 'Endocrine, nutritional and metabolic diseases',
    is_billable: true,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'E11',
    description: 'Type 2 diabetes mellitus',
    category: 'E11',
    subcategory: 'E11',
    chapter_code: 'E00-E89',
    chapter_name: 'Endocrine, nutritional and metabolic diseases',
    is_billable: false,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'E11.9',
    description: 'Type 2 diabetes mellitus without complications',
    category: 'E11',
    subcategory: 'E11.9',
    chapter_code: 'E00-E89',
    chapter_name: 'Endocrine, nutritional and metabolic diseases',
    is_billable: true,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'E11.21',
    description: 'Type 2 diabetes mellitus with diabetic nephropathy',
    category: 'E11',
    subcategory: 'E11.21',
    chapter_code: 'E00-E89',
    chapter_name: 'Endocrine, nutritional and metabolic diseases',
    is_billable: true,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'E11.22',
    description: 'Type 2 diabetes mellitus with diabetic chronic kidney disease',
    category: 'E11',
    subcategory: 'E11.22',
    chapter_code: 'E00-E89',
    chapter_name: 'Endocrine, nutritional and metabolic diseases',
    is_billable: true,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },

  // Hypertension codes (I10-I16)
  {
    code: 'I10',
    description: 'Essential (primary) hypertension',
    category: 'I10',
    subcategory: 'I10',
    chapter_code: 'I00-I99',
    chapter_name: 'Diseases of the circulatory system',
    is_billable: true,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'I11',
    description: 'Hypertensive heart disease',
    category: 'I11',
    subcategory: 'I11',
    chapter_code: 'I00-I99',
    chapter_name: 'Diseases of the circulatory system',
    is_billable: false,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'I11.0',
    description: 'Hypertensive heart disease with heart failure',
    category: 'I11',
    subcategory: 'I11.0',
    chapter_code: 'I00-I99',
    chapter_name: 'Diseases of the circulatory system',
    is_billable: true,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },

  // Respiratory codes (J00-J99)
  {
    code: 'J44',
    description: 'Other chronic obstructive pulmonary disease',
    category: 'J44',
    subcategory: 'J44',
    chapter_code: 'J00-J99',
    chapter_name: 'Diseases of the respiratory system',
    is_billable: false,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'J44.0',
    description: 'Chronic obstructive pulmonary disease with acute lower respiratory infection',
    category: 'J44',
    subcategory: 'J44.0',
    chapter_code: 'J00-J99',
    chapter_name: 'Diseases of the respiratory system',
    is_billable: true,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'J44.1',
    description: 'Chronic obstructive pulmonary disease with acute exacerbation',
    category: 'J44',
    subcategory: 'J44.1',
    chapter_code: 'J00-J99',
    chapter_name: 'Diseases of the respiratory system',
    is_billable: true,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },

  // Mental health codes (F01-F99)
  {
    code: 'F32',
    description: 'Major depressive disorder, single episode',
    category: 'F32',
    subcategory: 'F32',
    chapter_code: 'F01-F99',
    chapter_name: 'Mental, Behavioral and Neurodevelopmental disorders',
    is_billable: false,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'F32.9',
    description: 'Major depressive disorder, single episode, unspecified',
    category: 'F32',
    subcategory: 'F32.9',
    chapter_code: 'F01-F99',
    chapter_name: 'Mental, Behavioral and Neurodevelopmental disorders',
    is_billable: true,
    is_valid_primary: true,
    effective_date: '2024-10-01',
    revision_year: 2024
  },

  // Z codes (factors influencing health status)
  {
    code: 'Z51',
    description: 'Encounter for other aftercare and medical care',
    category: 'Z51',
    subcategory: 'Z51',
    chapter_code: 'Z00-Z99',
    chapter_name: 'Factors influencing health status and contact with health services',
    is_billable: false,
    is_valid_primary: false,
    effective_date: '2024-10-01',
    revision_year: 2024
  },
  {
    code: 'Z51.11',
    description: 'Encounter for antineoplastic chemotherapy',
    category: 'Z51',
    subcategory: 'Z51.11',
    chapter_code: 'Z00-Z99',
    chapter_name: 'Factors influencing health status and contact with health services',
    is_billable: true,
    is_valid_primary: false,
    effective_date: '2024-10-01',
    revision_year: 2024
  }
];

function loadSampleData(): void {
  console.log('Loading sample ICD-10 data...');
  
  const db = new ICD10Database();
  
  try {
    let loadedCount = 0;
    
    for (const codeData of sampleCodes) {
      if (db.insertCode(codeData)) {
        loadedCount++;
      }
    }
    
    console.log(`✅ Loaded ${loadedCount} sample codes`);
    
    // Show stats
    const stats = db.getStats();
    console.log('Database stats:', stats);
    
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadSampleData();
}