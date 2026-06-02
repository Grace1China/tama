/** 各产业链 preset 对应的 YAML 文件名（位于 app/industryLink/） */
export const TAXONOMY_YAML_BY_PRESET = {
  lithium: 'lithium_industry_taxonomy.yaml',
  ai: 'ai_industry_taxonomy.yaml',
  ai_compute: 'ai_compute_taxonomy.yaml',
  tao: 'tao_industry_taxonomy.yaml',
  sc_quantum: 'sc_quantum_industry_taxonomy.yaml',
  commercial_space: 'commercial_space_industry_taxonomy.yaml',
} as const;

export type TaxonomyYamlPreset = keyof typeof TAXONOMY_YAML_BY_PRESET;

export function isTaxonomyYamlPreset(v: string): v is TaxonomyYamlPreset {
  return v in TAXONOMY_YAML_BY_PRESET;
}
