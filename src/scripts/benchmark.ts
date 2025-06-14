#!/usr/bin/env node
import { performance } from 'perf_hooks';
import { ICD10Database } from '../database/ICD10Database.js';

class ICD10Benchmark {
  private db: ICD10Database;

  constructor() {
    this.db = new ICD10Database();
  }

  private calculateStats(times: number[]) {
    times.sort((a, b) => a - b);
    const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
    const median = times[Math.floor(times.length / 2)];
    const min = times[0];
    const max = times[times.length - 1];
    const p95Index = Math.floor(times.length * 0.95);
    const p95 = times[p95Index];

    return { mean, median, min, max, p95 };
  }

  benchmarkExactLookup(iterations = 100) {
    const testCodes = ['E11.9', 'I10', 'J44.1', 'F32.9', 'Z51.11', 'E10.9', 'I11.0'];
    const times: number[] = [];

    console.log(`Benchmarking exact lookup (${iterations} iterations)...`);

    for (let i = 0; i < iterations; i++) {
      const code = testCodes[i % testCodes.length];
      
      const start = performance.now();
      this.db.getCode(code);
      const end = performance.now();

      times.push(end - start);
    }

    const stats = this.calculateStats(times);
    return {
      operation: 'exact_lookup',
      iterations,
      ...stats,
      target: 10
    };
  }

  benchmarkFuzzySearch(iterations = 50) {
    const testQueries = [
      'diabetes',
      'diabetes complications',
      'hypertension',
      'pneumonia',
      'depression',
      'chronic kidney disease',
      'heart failure',
      'respiratory infection'
    ];

    const times: number[] = [];

    console.log(`Benchmarking fuzzy search (${iterations} iterations)...`);

    for (let i = 0; i < iterations; i++) {
      const query = testQueries[i % testQueries.length];
      
      const start = performance.now();
      this.db.searchCodes(query, { limit: 20 });
      const end = performance.now();

      times.push(end - start);
    }

    const stats = this.calculateStats(times);
    return {
      operation: 'fuzzy_search',
      iterations,
      ...stats,
      target: 50
    };
  }

  benchmarkBulkValidation(iterations = 20) {
    const testCodesBatch = [
      'E11.9', 'I10', 'J44.1', 'F32.9', 'Z51.11',
      'E10.9', 'I11.0', 'INVALID1', 'E11.21', 'J44.0',
      'FAKE123', 'E11.22', 'F32', 'Z51', 'I11'
    ];

    // Repeat to get 105 codes
    const codes = Array(7).fill(testCodesBatch).flat();
    const times: number[] = [];

    console.log(`Benchmarking bulk validation (${iterations} iterations, ${codes.length} codes each)...`);

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      this.db.validateCodes(codes, true);
      const end = performance.now();

      times.push(end - start);
    }

    const stats = this.calculateStats(times);
    return {
      operation: 'bulk_validation',
      iterations,
      codes_per_batch: codes.length,
      ...stats,
      target: 100
    };
  }

  benchmarkHierarchyTraversal(iterations = 50) {
    const testCodes = ['E11', 'I11', 'J44', 'F32', 'Z51'];
    const directions: Array<'children' | 'parents' | 'siblings'> = ['children', 'parents', 'siblings'];

    const times: number[] = [];

    console.log(`Benchmarking hierarchy traversal (${iterations} iterations)...`);

    for (let i = 0; i < iterations; i++) {
      const code = testCodes[i % testCodes.length];
      const direction = directions[i % directions.length];
      
      const start = performance.now();
      this.db.getHierarchy(code, direction, 2);
      const end = performance.now();

      times.push(end - start);
    }

    const stats = this.calculateStats(times);
    return {
      operation: 'hierarchy_traversal',
      iterations,
      ...stats,
      target: 25
    };
  }

  benchmarkColdStart() {
    console.log('Benchmarking cold start...');
    
    // Close current database
    this.db.close();
    
    // Measure cold start
    const start = performance.now();
    this.db = new ICD10Database();
    
    // Perform a simple query to ensure everything is loaded
    this.db.getCode('E11.9');
    const end = performance.now();

    const coldStartTime = end - start;

    return {
      operation: 'cold_start',
      time: coldStartTime,
      target: 500
    };
  }

  runAllBenchmarks() {
    console.log('='.repeat(60));
    console.log('ICD-10 MCP Server Performance Benchmarks');
    console.log('='.repeat(60));

    // Get database stats first
    const stats = this.db.getStats();
    console.log(`Database contains ${stats.total_codes} codes (${stats.billable_codes} billable)`);
    console.log();

    const results: any = {
      database_stats: stats,
      benchmarks: {}
    };

    // Run benchmarks
    const benchmarks = [
      () => this.benchmarkColdStart(),
      () => this.benchmarkExactLookup(100),
      () => this.benchmarkFuzzySearch(50),
      () => this.benchmarkHierarchyTraversal(50),
      () => this.benchmarkBulkValidation(20)
    ];

    let allPassed = true;

    for (const benchmark of benchmarks) {
      const result = benchmark();
      results.benchmarks[result.operation] = result;

      // Print results
      if (result.operation === 'cold_start') {
        const coldStartResult = result as { operation: string; time: number; target: number; };
        const passed = coldStartResult.time < coldStartResult.target;
        const status = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${coldStartResult.operation.padEnd(20)} ${coldStartResult.time.toFixed(2)}ms (target: <${coldStartResult.target}ms) ${status}`);
        if (!passed) allPassed = false;
      } else {
        const benchResult = result as { operation: string; mean: number; p95: number; target: number; };
        const passed = benchResult.mean < benchResult.target;
        const status = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${benchResult.operation.padEnd(20)} ${benchResult.mean.toFixed(2)}ms avg, ${benchResult.p95.toFixed(2)}ms p95 (target: <${benchResult.target}ms) ${status}`);
        if (!passed) allPassed = false;
      }
    }

    console.log();

    // Overall assessment
    if (allPassed) {
      console.log('🎉 All performance targets met!');
    } else {
      console.log('⚠️  Some performance targets missed. Consider optimizations.');
    }

    return results;
  }

  close() {
    this.db.close();
  }
}

async function main() {
  // Check if data exists
  const tempDb = new ICD10Database();
  const stats = tempDb.getStats();
  tempDb.close();
  
  if (stats.total_codes === 0) {
    console.log('No data found, please run: npm run load-data');
    process.exit(1);
  }

  console.log();

  // Run benchmarks
  const benchmark = new ICD10Benchmark();

  try {
    const results = benchmark.runAllBenchmarks();
    
    // Save results (optional)
    // fs.writeFileSync('benchmark_results.json', JSON.stringify(results, null, 2));
    
  } finally {
    benchmark.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}