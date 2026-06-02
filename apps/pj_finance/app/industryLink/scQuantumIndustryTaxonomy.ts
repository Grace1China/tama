/**
 * 超导量子计算产业链泳道 YAML
 */

import taxonomyYamlRaw from './sc_quantum_industry_taxonomy.yaml';

import type { AIIndustryTaxonomyFile } from './aiIndustryTaxonomy';
import { parseIndustryTaxonomyYaml } from './aiIndustryTaxonomy';

/** 运行时只读拓扑 */
export const SC_QUANTUM_INDUSTRY_TAXONOMY: AIIndustryTaxonomyFile =
  typeof taxonomyYamlRaw === 'string'
    ? parseIndustryTaxonomyYaml(taxonomyYamlRaw)
    : parseIndustryTaxonomyYaml(String(taxonomyYamlRaw));

export function countScQuantumSubLanes(): number {
  return SC_QUANTUM_INDUSTRY_TAXONOMY.lanes.reduce((n, lane) => n + lane.sub_lanes.length, 0);
}
