export interface ICD10Code {
  code: string;
  description: string;
  category: string;
  subcategory?: string;
  chapter_code: string;
  chapter_name: string;
  is_billable: boolean;
  is_valid_primary: boolean;
  effective_date?: string;
  end_date?: string;
  revision_year: number;
  created_at?: string;
  updated_at?: string;
}

export interface SearchOptions {
  limit?: number;
  category_filter?: string[];
  billable_only?: boolean;
  effective_date?: string;
}

export interface ValidationResult {
  valid: boolean;
  billable: boolean;
  description?: string;
  effective_date?: string;
  end_date?: string;
  warning?: string;
  error?: string;
}

export interface HierarchyDirection {
  children: 'children';
  parents: 'parents';
  siblings: 'siblings';
}

export interface DatabaseStats {
  total_codes: number;
  billable_codes: number;
  chapters: number;
  latest_revision: number;
}

export interface LookupResponse {
  found: boolean;
  code?: ICD10Code;
  hierarchy?: {
    parents: ICD10Code[];
    children: ICD10Code[];
    siblings: ICD10Code[];
  };
  error?: string;
}

export interface SearchResponse {
  query: string;
  total_results: number;
  results: ICD10Code[];
  filters: {
    category_filter?: string[];
    billable_only: boolean;
    effective_date?: string;
  };
}

export interface ValidationResponse {
  total_codes: number;
  valid_codes: number;
  billable_codes: number;
  invalid_codes: number;
  validation_results: Record<string, ValidationResult>;
  effective_date?: string;
}

export interface HierarchyResponse {
  base_code: ICD10Code;
  direction: keyof HierarchyDirection;
  max_depth: number;
  total_results: number;
  results: ICD10Code[];
}