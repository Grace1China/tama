/**
 * AI 算力产业链泳道 YAML（与技术栈环节列表一致）
 */

import taxonomyYamlRaw from './ai_compute_taxonomy.yaml';

import type { AIIndustryTaxonomyFile } from './aiIndustryTaxonomy';
import { parseIndustryTaxonomyYaml } from './aiIndustryTaxonomy';

/** 运行时只读拓扑 */
export const AI_COMPUTE_TAXONOMY: AIIndustryTaxonomyFile =
  typeof taxonomyYamlRaw === 'string'
    ? parseIndustryTaxonomyYaml(taxonomyYamlRaw)
    : parseIndustryTaxonomyYaml(String(taxonomyYamlRaw));

export function countAIComputeSubLanes(): number {
  return AI_COMPUTE_TAXONOMY.lanes.reduce((n, lane) => n + lane.sub_lanes.length, 0);
}
