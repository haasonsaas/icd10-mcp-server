#!/usr/bin/env node
import { createWriteStream, createReadStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { Extract } from 'unzipper';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CMSDataSource {
  year: number;
  url: string;
  description: string;
}

// CMS ICD-10-CM data sources
const CMS_DATA_SOURCES: CMSDataSource[] = [
  {
    year: 2024,
    url: 'https://www.cms.gov/files/zip/2024-code-descriptions-tabular-order.zip',
    description: '2024 ICD-10-CM Tabular Order'
  },
  {
    year: 2023,
    url: 'https://www.cms.gov/files/zip/2023-code-descriptions-tabular-order.zip',
    description: '2023 ICD-10-CM Tabular Order'
  }
];

export class CMSDataDownloader {
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || join(__dirname, '../../cms_data');
    
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async downloadYear(year: number): Promise<string> {
    const source = CMS_DATA_SOURCES.find(s => s.year === year);
    if (!source) {
      throw new Error(`No data source found for year ${year}`);
    }

    console.log(`📥 Downloading ${source.description}...`);
    console.log(`📍 URL: ${source.url}`);

    const zipPath = join(this.dataDir, `cms_icd10_${year}.zip`);
    const extractDir = join(this.dataDir, `cms_icd10_${year}`);

    // Download the file
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    // Save to file
    const fileStream = createWriteStream(zipPath);
    await pipeline(response.body as any, fileStream);

    console.log(`✅ Downloaded: ${zipPath}`);
    console.log(`📂 Extracting to: ${extractDir}`);

    // Extract the ZIP file
    if (!existsSync(extractDir)) {
      mkdirSync(extractDir, { recursive: true });
    }

    await new Promise<void>((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(Extract({ path: extractDir }))
        .on('close', resolve)
        .on('error', reject);
    });

    console.log(`✅ Extracted successfully`);
    return extractDir;
  }

  async downloadLatest(): Promise<string> {
    // Download the most recent year (2024)
    return await this.downloadYear(2024);
  }

  getAvailableYears(): number[] {
    return CMS_DATA_SOURCES.map(s => s.year);
  }
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  const year = args[0] ? parseInt(args[0]) : 2024;

  console.log('🏥 CMS ICD-10-CM Data Downloader');
  console.log('=' .repeat(50));

  try {
    const downloader = new CMSDataDownloader();
    const extractPath = await downloader.downloadYear(year);
    
    console.log('');
    console.log('🎉 Download completed successfully!');
    console.log(`📁 Data extracted to: ${extractPath}`);
    console.log('');
    console.log('Next steps:');
    console.log('  npm run parse-cms -- --year=' + year);
    
  } catch (error) {
    console.error('❌ Download failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}