/**
 * 商业航天产业链泳道 YAML
 */

import taxonomyYamlRaw from './commercial_space_industry_taxonomy.yaml';

import type { AIIndustryTaxonomyFile } from './aiIndustryTaxonomy';
import { parseIndustryTaxonomyYaml } from './aiIndustryTaxonomy';

/** 运行时只读拓扑 */
export const COMMERCIAL_SPACE_INDUSTRY_TAXONOMY: AIIndustryTaxonomyFile =
  typeof taxonomyYamlRaw === 'string'
    ? parseIndustryTaxonomyYaml(taxonomyYamlRaw)
    : parseIndustryTaxonomyYaml(String(taxonomyYamlRaw));

export function countCommercialSpaceSubLanes(): number {
  return COMMERCIAL_SPACE_INDUSTRY_TAXONOMY.lanes.reduce((n, lane) => n + lane.sub_lanes.length, 0);
}
