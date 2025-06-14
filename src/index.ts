#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ICD10Database } from './database/ICD10Database.js';
import type {
  LookupResponse,
  SearchResponse,
  ValidationResponse,
  HierarchyResponse,
} from './types/icd10.js';

const server = new Server(
  {
    name: 'icd10-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Initialize database
const db = new ICD10Database();

// Validation schemas
const LookupSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  include_hierarchy: z.boolean().optional().default(false),
  effective_date: z.string().optional(),
});

const SearchSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  limit: z.number().int().min(1).max(100).optional().default(20),
  category_filter: z.array(z.string()).optional(),
  billable_only: z.boolean().optional().default(false),
  effective_date: z.string().optional(),
});

const ValidateBatchSchema = z.object({
  codes: z.array(z.string()).min(1, 'At least one code is required'),
  check_billable: z.boolean().optional().default(false),
  effective_date: z.string().optional(),
});

const HierarchySchema = z.object({
  code: z.string().min(1, 'Code is required'),
  direction: z.enum(['children', 'parents', 'siblings']).optional().default('children'),
  max_depth: z.number().int().min(1).max(5).optional().default(2),
});

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'icd10_lookup',
        description: 'Exact ICD-10 code lookup with optional hierarchy',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'ICD-10 code to lookup (e.g., "E11.9")',
            },
            include_hierarchy: {
              type: 'boolean',
              default: false,
              description: 'Include parent/child codes in response',
            },
            effective_date: {
              type: 'string',
              description: 'Effective date filter (YYYY-MM-DD format)',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'icd10_search',
        description: 'Fuzzy/semantic search for ICD-10 codes',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (e.g., "diabetes complications")',
            },
            limit: {
              type: 'integer',
              default: 20,
              minimum: 1,
              maximum: 100,
              description: 'Maximum number of results',
            },
            category_filter: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by categories (e.g., ["E10-E14"])',
            },
            billable_only: {
              type: 'boolean',
              default: false,
              description: 'Return only billable codes',
            },
            effective_date: {
              type: 'string',
              description: 'Effective date filter (YYYY-MM-DD format)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'icd10_validate_batch',
        description: 'Bulk validation of ICD-10 codes',
        inputSchema: {
          type: 'object',
          properties: {
            codes: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of ICD-10 codes to validate',
              minItems: 1,
            },
            check_billable: {
              type: 'boolean',
              default: false,
              description: 'Check if codes are billable',
            },
            effective_date: {
              type: 'string',
              description: 'Effective date filter (YYYY-MM-DD format)',
            },
          },
          required: ['codes'],
        },
      },
      {
        name: 'icd10_hierarchy',
        description: 'Navigate ICD-10 code hierarchy relationships',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'ICD-10 code for hierarchy navigation',
            },
            direction: {
              type: 'string',
              enum: ['children', 'parents', 'siblings'],
              default: 'children',
              description: 'Direction to navigate',
            },
            max_depth: {
              type: 'integer',
              default: 2,
              minimum: 1,
              maximum: 5,
              description: 'Maximum hierarchy depth',
            },
          },
          required: ['code'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'icd10_lookup':
        return await handleLookup(args);
      case 'icd10_search':
        return await handleSearch(args);
      case 'icd10_validate_batch':
        return await handleValidateBatch(args);
      case 'icd10_hierarchy':
        return await handleHierarchy(args);
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    
    console.error(`Error in tool ${name}:`, error);
    throw new McpError(
      ErrorCode.InternalError,
      `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

async function handleLookup(args: unknown) {
  const { code, include_hierarchy, effective_date } = LookupSchema.parse(args);

  const result = db.getCode(code, effective_date);

  if (!result) {
    const response: LookupResponse = {
      found: false,
      error: 'Code not found',
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  const response: LookupResponse = {
    found: true,
    code: result,
  };

  if (include_hierarchy) {
    response.hierarchy = {
      parents: db.getHierarchy(code, 'parents', 3),
      children: db.getHierarchy(code, 'children', 2),
      siblings: db.getHierarchy(code, 'siblings').slice(0, 10),
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}

async function handleSearch(args: unknown) {
  const { query, limit, category_filter, billable_only, effective_date } = SearchSchema.parse(args);

  const results = db.searchCodes(query, {
    limit,
    category_filter,
    billable_only,
    effective_date,
  });

  const response: SearchResponse = {
    query,
    total_results: results.length,
    results,
    filters: {
      category_filter,
      billable_only,
      effective_date,
    },
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}

async function handleValidateBatch(args: unknown) {
  const { codes, check_billable, effective_date } = ValidateBatchSchema.parse(args);

  const validationResults = db.validateCodes(codes, check_billable, effective_date);

  // Summary statistics
  const validCount = Object.values(validationResults).filter(r => r.valid).length;
  const billableCount = Object.values(validationResults).filter(r => r.billable).length;

  const response: ValidationResponse = {
    total_codes: codes.length,
    valid_codes: validCount,
    billable_codes: billableCount,
    invalid_codes: codes.length - validCount,
    validation_results: validationResults,
    effective_date,
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}

async function handleHierarchy(args: unknown) {
  const { code, direction, max_depth } = HierarchySchema.parse(args);

  const hierarchyResults = db.getHierarchy(code, direction, max_depth);

  // For base code, try to get it from database, or create a placeholder
  let baseCode = db.getCode(code);
  if (!baseCode && hierarchyResults.length > 0) {
    // Create a virtual base code from the first result's category info
    const firstResult = hierarchyResults[0];
    baseCode = {
      code: code,
      description: `${code} category codes`,
      category: code.length >= 3 ? code.substring(0, 3) : code,
      subcategory: code,
      chapter_code: firstResult.chapter_code || '',
      chapter_name: firstResult.chapter_name || '',
      is_billable: false,
      is_valid_primary: true,
      effective_date: firstResult.effective_date,
      revision_year: firstResult.revision_year || 2024
    };
  } else if (!baseCode) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `No codes found for '${code}' and no hierarchy available`
    );
  }

  const response: HierarchyResponse = {
    base_code: baseCode,
    direction,
    max_depth,
    total_results: hierarchyResults.length,
    results: hierarchyResults,
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    db.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});